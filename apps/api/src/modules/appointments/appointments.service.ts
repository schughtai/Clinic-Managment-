import { Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { AuditService } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { ScheduleService } from '../schedule/schedule.service';
import { storedRange } from '../schedule/slots';
import { assertTransition, type AppointmentStatus, TransitionError } from './transitions';

export interface BookInput {
  facilityId: string;
  practitionerId: string;
  patientId: string;
  typeId: string;
  startsAt: string;
}

interface Booking {
  id: string;
  status: AppointmentStatus;
  starts_at: Date;
  ends_at: Date;
  facility_id: string;
  practitioner_id: string;
  patient_id: string;
}

/** Bookings, reschedules, cancellations and status changes (FR-015). Double booking is refused by the database. */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ScheduleService) private readonly schedule: ScheduleService,
  ) {}

  async book(ctx: ReqCtx, input: BookInput) {
    this.assertFacilityGranted(ctx, input.facilityId);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const type = await tx.maybeOne<{ duration_minutes: number; buffer_minutes: number }>(
        'select duration_minutes, buffer_minutes from appointment_types where id = $1 and active',
        [input.typeId],
      );
      if (type === null) throw notFound('Appointment type');
      const start = Date.parse(input.startsAt);
      if (Number.isNaN(start)) throw new AppError(400, 'validation_failed', 'Choose a valid start time.');
      if (start < Date.now() - 60_000) throw new AppError(400, 'validation_failed', 'Choose a time in the future.');
      const range = storedRange(start, type.duration_minutes, type.buffer_minutes);
      const id = await this.insertBooking(tx, ctx, input, start, start + type.duration_minutes * 60_000, range);
      await this.audit.org(tx, ctx, 'appointment.booked', { type: 'appointment', id, facilityId: input.facilityId });
      return { id };
    }).catch((error: unknown) => {
      // The database exclusion constraint is the final guard against double booking.
      if (error instanceof DatabaseError && error.constraint === 'appointments_no_overlap') {
        throw new AppError(409, 'slot_taken', 'That time is no longer available for this practitioner.');
      }
      throw error;
    });
  }

  /** Keeps the old appointment in the record as cancelled (reason: rescheduled) and books the new time. */
  async reschedule(ctx: ReqCtx, id: string, startsAt: string) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const old = await this.load(tx, id);
      assertTransition(old.status, 'cancelled');
      await tx.execute(`update appointments set status = 'cancelled', cancel_reason = 'rescheduled' where id = $1`, [id]);
      await this.recordEvent(tx, ctx, id, old.status, 'cancelled', 'rescheduled');
      const type = await tx.one<{ duration_minutes: number; buffer_minutes: number }>(
        `select t.duration_minutes, t.buffer_minutes from appointment_types t join appointments a on a.appointment_type_id = t.id where a.id = $1`,
        [id],
      );
      const start = Date.parse(startsAt);
      if (Number.isNaN(start)) throw new AppError(400, 'validation_failed', 'Choose a valid start time.');
      const range = storedRange(start, type.duration_minutes, type.buffer_minutes);
      const newId = await this.insertBooking(
        tx,
        ctx,
        { facilityId: old.facility_id, practitionerId: old.practitioner_id, patientId: old.patient_id, typeId: '', startsAt },
        start,
        start + type.duration_minutes * 60_000,
        range,
        id,
      );
      await this.audit.org(tx, ctx, 'appointment.rescheduled', { type: 'appointment', id: newId, facilityId: old.facility_id });
      return { id: newId, previousId: id };
    }).catch((error: unknown) => {
      if (error instanceof DatabaseError && error.constraint === 'appointments_no_overlap') {
        throw new AppError(409, 'slot_taken', 'That time is no longer available for this practitioner.');
      }
      throw error;
    });
  }

  async cancel(ctx: ReqCtx, id: string, reason: string) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const current = await this.load(tx, id);
      this.assertGranted(ctx, current.facility_id);
      assertTransition(current.status, 'cancelled');
      await tx.execute(`update appointments set status = 'cancelled', cancel_reason = $1 where id = $2`, [reason, id]);
      await this.recordEvent(tx, ctx, id, current.status, 'cancelled', reason);
      await this.audit.org(tx, ctx, 'appointment.cancelled', { type: 'appointment', id, facilityId: current.facility_id });
    });
  }

  async setStatus(ctx: ReqCtx, id: string, to: AppointmentStatus) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const current = await this.load(tx, id);
      this.assertGranted(ctx, current.facility_id);
      assertTransition(current.status, to);
      await tx.execute('update appointments set status = $1 where id = $2', [to, id]);
      await this.recordEvent(tx, ctx, id, current.status, to, null);
      await this.audit.org(tx, ctx, `appointment.${to}`, { type: 'appointment', id, facilityId: current.facility_id });
      return { id, status: to };
    }).catch((error: unknown) => {
      if (error instanceof TransitionError) throw new AppError(409, 'invalid_transition', error.message);
      throw error;
    });
  }

  list(ctx: ReqCtx, facilityId: string, date: string, practitionerId?: string) {
    this.assertFacilityGranted(ctx, facilityId);
    return this.db.withContext(orgDb(ctx), (tx) =>
      tx.many(
        `select a.id, a.status, a.starts_at as "startsAt", a.ends_at as "endsAt", a.practitioner_id as "practitionerId",
                p.patient_number as "patientNumber", p.name_en as "patientName", a.cancel_reason as "cancelReason"
         from appointments a join patients p on p.id = a.patient_id
         where a.facility_id = $1 and (a.starts_at at time zone 'UTC')::date = $2::date
           and ($3::uuid is null or a.practitioner_id = $3)
         order by a.starts_at`,
        [facilityId, date, practitionerId ?? null],
      ),
    );
  }

  // ------------------------------------------------------------ helpers

  private async insertBooking(
    tx: Tx,
    ctx: ReqCtx,
    input: BookInput,
    start: number,
    end: number,
    range: { start: number; end: number },
    rescheduledFrom: string | null = null,
  ): Promise<string> {
    const row = await tx.one<{ id: string }>(
      `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, appointment_type_id,
                                 status, starts_at, ends_at, during, rescheduled_from, created_by)
       values ($1, $2, $3, $4, nullif($5, '')::uuid, 'booked', to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0),
               tstzrange(to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0)), $10, $11)
       returning id`,
      [
        orgOf(ctx).id,
        input.facilityId,
        input.practitionerId,
        input.patientId,
        input.typeId,
        start,
        end,
        range.start,
        range.end,
        rescheduledFrom,
        ctx.person.id,
      ],
    );
    await this.recordEvent(tx, ctx, row.id, null, 'booked', null);
    return row.id;
  }

  private async recordEvent(tx: Tx, ctx: ReqCtx, appointmentId: string, from: string | null, to: string, reason: string | null): Promise<void> {
    await tx.execute(
      `insert into appointment_events (organization_id, appointment_id, from_status, to_status, actor_id, reason) values ($1, $2, $3, $4, $5, $6)`,
      [orgOf(ctx).id, appointmentId, from, to, ctx.person.id, reason],
    );
  }

  private async load(tx: Tx, id: string): Promise<Booking> {
    const row = await tx.maybeOne<Booking>(
      `select id, status, starts_at, ends_at, facility_id, practitioner_id, patient_id from appointments where id = $1`,
      [id],
    );
    if (row === null) throw notFound('Appointment');
    return row;
  }

  private assertFacilityGranted(ctx: ReqCtx, facilityId: string): void {
    const granted = orgOf(ctx).facilityIds;
    if (granted !== '*' && !granted.includes(facilityId)) throw notFound('Branch');
  }

  private assertGranted(ctx: ReqCtx, facilityId: string): void {
    this.assertFacilityGranted(ctx, facilityId);
  }
}
