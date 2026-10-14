import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';

export const QUEUE_STATUSES = ['waiting', 'called', 'in_consultation', 'completed', 'missed'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const NEXT: Record<QueueStatus, readonly QueueStatus[]> = {
  waiting: ['called', 'missed'],
  called: ['in_consultation', 'missed', 'waiting'],
  in_consultation: ['completed'],
  completed: [],
  missed: ['waiting'],
};

export function canQueueMove(from: QueueStatus, to: QueueStatus): boolean {
  return NEXT[from].includes(to);
}

/**
 * Queue tickets (FR-016). Numbers restart per practitioner, facility and day, and are issued under a
 * row lock so two check-ins can never receive the same number.
 */
@Injectable()
export class QueueService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async issue(ctx: ReqCtx, input: { facilityId: string; practitionerId: string; patientId: string; appointmentId: string | null }) {
    this.assertGranted(ctx, input.facilityId);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const day = await this.serviceDay(tx, input.facilityId);
      const key = `queue:${input.practitionerId}:${day}`;
      // Atomic increment: concurrent check-ins are serialised on this row.
      const counter = await tx.one<{ value: string }>(
        `insert into facility_sequences (organization_id, facility_id, key, value)
         values ($1, $2, $3, 1)
         on conflict (facility_id, key) do update set value = facility_sequences.value + 1
         returning value::text`,
        [orgOf(ctx).id, input.facilityId, key],
      );
      const number = Number(counter.value);
      const row = await tx.one<{ id: string }>(
        `insert into queue_tickets (organization_id, facility_id, practitioner_id, patient_id, appointment_id, service_day, number, created_by)
         values ($1, $2, $3, $4, $5, $6::date, $7, $8) returning id`,
        [orgOf(ctx).id, input.facilityId, input.practitionerId, input.patientId, input.appointmentId, day, number, ctx.person.id],
      );
      await tx.execute(
        `insert into queue_events (organization_id, ticket_id, from_status, to_status, actor_id) values ($1, $2, null, 'waiting', $3)`,
        [orgOf(ctx).id, row.id, ctx.person.id],
      );
      await this.audit.org(tx, ctx, 'queue.ticket_issued', { type: 'queue_ticket', id: row.id, facilityId: input.facilityId });
      return { id: row.id, number, serviceDay: day };
    });
  }

  async transition(ctx: ReqCtx, ticketId: string, to: QueueStatus) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const ticket = await tx.maybeOne<{ status: QueueStatus; facility_id: string }>(
        'select status, facility_id from queue_tickets where id = $1 for update',
        [ticketId],
      );
      if (ticket === null) throw notFound('Queue ticket');
      this.assertGranted(ctx, ticket.facility_id);
      if (!canQueueMove(ticket.status, to)) {
        throw new AppError(409, 'invalid_transition', `A ticket that is ${ticket.status.replace('_', ' ')} cannot become ${to.replace('_', ' ')}.`);
      }
      const stamp = to === 'called' ? ', called_at = now()' : to === 'completed' ? ', completed_at = now()' : '';
      await tx.execute(`update queue_tickets set status = $1${stamp} where id = $2`, [to, ticketId]);
      await tx.execute(
        `insert into queue_events (organization_id, ticket_id, from_status, to_status, actor_id) values ($1, $2, $3, $4, $5)`,
        [orgOf(ctx).id, ticketId, ticket.status, to, ctx.person.id],
      );
      await this.audit.org(tx, ctx, `queue.${to}`, { type: 'queue_ticket', id: ticketId, facilityId: ticket.facility_id });
      return { id: ticketId, status: to };
    });
  }

  /** Today's queue for a facility. Full names are shown only when the organization allows it. */
  list(ctx: ReqCtx, facilityId: string, day: string, display: boolean) {
    this.assertGranted(ctx, facilityId);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const showNames = !display || (await tx.one<{ first: boolean }>('select first_names_on_display as first from organization_settings_billing where organization_id = $1', [orgOf(ctx).id]).then((r) => r.first).catch(() => false));
      return tx.many(
        `select t.id, t.number, t.status, t.practitioner_id as "practitionerId", t.checked_in_at as "checkedInAt",
                ${showNames ? 'p.name_en' : 'null::text'} as "patientName"
         from queue_tickets t join patients p on p.id = t.patient_id
         where t.facility_id = $1 and t.service_day = $2::date
         order by t.checked_in_at`,
        [facilityId, day],
      );
    });
  }

  private async serviceDay(tx: Tx, facilityId: string): Promise<string> {
    const row = await tx.one<{ day: string }>(
      `select (now() at time zone coalesce(f.timezone, o.timezone))::date::text as day
       from facilities f join organizations o on o.id = f.organization_id where f.id = $1`,
      [facilityId],
    );
    return row.day;
  }

  private assertGranted(ctx: ReqCtx, facilityId: string): void {
    const granted = orgOf(ctx).facilityIds;
    if (granted !== '*' && !granted.includes(facilityId)) throw notFound('Branch');
  }
}
