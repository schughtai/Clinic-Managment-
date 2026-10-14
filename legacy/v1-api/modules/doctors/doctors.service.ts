import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { badRequest, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema, nullableText } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { buildSet } from '../../db/sql';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the 24-hour format HH:MM.');

export const createDoctorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  specialty: nullableText(80),
  defaultFee: z.number().int().min(0).max(10_000_000).default(0),
  slotMinutes: z.number().int().min(5).max(120).default(15),
});
export const updateDoctorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  specialty: nullableText(80),
  defaultFee: z.number().int().min(0).max(10_000_000).optional(),
  slotMinutes: z.number().int().min(5).max(120).optional(),
  active: z.boolean().optional(),
});
export const scheduleSchema = z.object({
  sessions: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start: timeSchema,
        end: timeSchema,
      }),
    )
    .max(28),
});
export const leaveSchema = z.object({ date: dateSchema, note: nullableText(200) });

export type CreateDoctor = z.output<typeof createDoctorSchema>;
export type UpdateDoctor = z.output<typeof updateDoctorSchema>;
export type ScheduleSession = z.output<typeof scheduleSchema>['sessions'][number];

export interface Doctor {
  id: string;
  userId: string | null;
  name: string;
  specialty: string | null;
  defaultFee: number;
  slotMinutes: number;
  active: boolean;
  schedule: ScheduleSession[];
}

export interface Leave {
  date: string;
  note: string | null;
}

const DOCTOR_SELECT = `
  select d.id, d.user_id as "userId", d.name, d.specialty,
         d.default_fee as "defaultFee", d.slot_minutes as "slotMinutes", d.active,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'weekday', s.weekday,
                    'start', to_char(s.start_time, 'HH24:MI'),
                    'end', to_char(s.end_time, 'HH24:MI'))
                  order by s.weekday, s.start_time)
             from doctor_schedules s where s.doctor_id = d.id
         ), '[]'::jsonb) as schedule
    from doctors d`;

/** Sessions on the same weekday must not overlap. Times are HH:MM so string comparison is correct. */
export function findOverlap(sessions: readonly ScheduleSession[]): ScheduleSession | null {
  const sorted = [...sessions].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && previous.weekday === current.weekday && current.start < previous.end) {
      return current;
    }
  }
  return null;
}

@Injectable()
export class DoctorsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(ctx: ReqCtx, includeInactive: boolean): Promise<Doctor[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.many<Doctor>(`${DOCTOR_SELECT} where ($1::boolean or d.active) order by d.active desc, d.name`, [
        includeInactive,
      ]),
    );
  }

  async create(ctx: ReqCtx, input: CreateDoctor): Promise<Doctor> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const created = await tx.one<{ id: string }>(
        `insert into doctors (clinic_id, name, specialty, default_fee, slot_minutes)
         values ($1, $2, $3, $4, $5) returning id`,
        [ctx.user.clinicId, input.name, input.specialty ?? null, input.defaultFee, input.slotMinutes],
      );
      await this.audit.record(tx, ctx, { action: 'doctor.created', entity: 'doctor', entityId: created.id });
      return tx.one<Doctor>(`${DOCTOR_SELECT} where d.id = $1`, [created.id]);
    });
  }

  async update(ctx: ReqCtx, id: string, patch: UpdateDoctor): Promise<Doctor> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const set = buildSet(
        {
          name: patch.name,
          specialty: patch.specialty,
          default_fee: patch.defaultFee,
          slot_minutes: patch.slotMinutes,
          active: patch.active,
        },
        2,
      );
      if (set !== null) {
        const updated = await tx.execute(`update doctors set ${set.sql} where id = $1`, [id, ...set.values]);
        if (updated === 0) throw notFound('This doctor');
        await this.audit.record(tx, ctx, {
          action: 'doctor.updated',
          entity: 'doctor',
          entityId: id,
          meta: { fields: Object.keys(patch).join(',') },
        });
      }
      const doctor = await tx.maybeOne<Doctor>(`${DOCTOR_SELECT} where d.id = $1`, [id]);
      if (doctor === null) throw notFound('This doctor');
      return doctor;
    });
  }

  /** Replaces the whole weekly schedule in one transaction. */
  async setSchedule(ctx: ReqCtx, id: string, sessions: readonly ScheduleSession[]): Promise<Doctor> {
    for (const session of sessions) {
      if (session.end <= session.start) {
        throw badRequest('invalid_schedule', 'Each session must end after it starts.');
      }
    }
    if (findOverlap(sessions) !== null) {
      throw badRequest('invalid_schedule', 'Sessions on the same day must not overlap.');
    }
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const exists = await tx.maybeOne<{ id: string }>('select id from doctors where id = $1 for update', [id]);
      if (exists === null) throw notFound('This doctor');
      await tx.execute('delete from doctor_schedules where doctor_id = $1', [id]);
      for (const session of sessions) {
        await tx.execute(
          'insert into doctor_schedules (clinic_id, doctor_id, weekday, start_time, end_time) values ($1, $2, $3, $4, $5)',
          [ctx.user.clinicId, id, session.weekday, session.start, session.end],
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'doctor.schedule_changed',
        entity: 'doctor',
        entityId: id,
        meta: { sessions: sessions.length },
      });
      return tx.one<Doctor>(`${DOCTOR_SELECT} where d.id = $1`, [id]);
    });
  }

  listLeaves(ctx: ReqCtx, id: string): Promise<Leave[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.many<Leave>(
        `select to_char(leave_date, 'YYYY-MM-DD') as date, note
           from doctor_leaves where doctor_id = $1 and leave_date >= current_date - 1
          order by leave_date`,
        [id],
      ),
    );
  }

  async addLeave(ctx: ReqCtx, id: string, date: string, note: string | null | undefined): Promise<Leave> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const exists = await tx.maybeOne<{ id: string }>('select id from doctors where id = $1', [id]);
      if (exists === null) throw notFound('This doctor');
      await tx.execute('insert into doctor_leaves (clinic_id, doctor_id, leave_date, note) values ($1, $2, $3, $4)', [
        ctx.user.clinicId,
        id,
        date,
        note ?? null,
      ]);
      await this.audit.record(tx, ctx, { action: 'doctor.leave_added', entity: 'doctor', entityId: id, meta: { date } });
      return { date, note: note ?? null };
    });
  }

  async removeLeave(ctx: ReqCtx, id: string, date: string): Promise<void> {
    await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const removed = await tx.execute('delete from doctor_leaves where doctor_id = $1 and leave_date = $2', [id, date]);
      if (removed === 0) throw notFound('This leave day');
      await this.audit.record(tx, ctx, {
        action: 'doctor.leave_removed',
        entity: 'doctor',
        entityId: id,
        meta: { date },
      });
    });
  }
}
