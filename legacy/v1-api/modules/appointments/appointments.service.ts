import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema, nullableText } from '../../common/validate';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import {
  type Appointment,
  type DoctorForBooking,
  AppointmentsRepository,
} from './appointments.repository';
import { type AppointmentStatus, canTransition, roleMayMarkStatus, sessionSlots, weekdayOf } from './slots';

/** A slot can still be booked for a few minutes after it started, for patients who are already at the desk. */
const LATE_BOOKING_GRACE_MS = 10 * 60 * 1000;

const statusSchema = z.enum(['booked', 'arrived', 'in_consult', 'done', 'cancelled', 'no_show']);

export const createAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  reason: nullableText(300),
});
export const walkinSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  reason: nullableText(300),
});
export const rescheduleSchema = z.object({ startsAt: z.string().datetime({ offset: true }) });
export const statusChangeSchema = z.object({ status: statusSchema });
export const listAppointmentsSchema = z.object({
  date: dateSchema.optional(),
  doctorId: z.string().uuid().optional(),
  status: statusSchema.optional(),
});
export const queueSchema = z.object({ doctorId: z.string().uuid().optional() });
export const slotsQuerySchema = z.object({ date: dateSchema });

export interface SlotsResult {
  date: string;
  onLeave: boolean;
  slotMinutes: number;
  slots: { startsAt: Date; available: boolean }[];
}

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AppointmentsRepository) private readonly repo: AppointmentsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async slots(ctx: ReqCtx, doctorId: string, date: string): Promise<SlotsResult> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const doctor = await this.repo.getDoctor(tx, doctorId);
      if (doctor === null) throw notFound('This doctor');
      const timezone = await this.repo.clinicTimezone(tx);
      if (!doctor.active) return { date, onLeave: false, slotMinutes: doctor.slotMinutes, slots: [] };
      if (await this.repo.isOnLeave(tx, doctorId, date)) {
        return { date, onLeave: true, slotMinutes: doctor.slotMinutes, slots: [] };
      }

      const sessions = await this.repo.sessionsOn(tx, doctorId, weekdayOf(date));
      const localTimes = sessionSlots(sessions, doctor.slotMinutes).map((time) => `${date} ${time}`);
      if (localTimes.length === 0) return { date, onLeave: false, slotMinutes: doctor.slotMinutes, slots: [] };

      const instants = await this.repo.localToInstants(tx, localTimes, timezone);
      const booked = new Set((await this.repo.bookedStarts(tx, doctorId, date, timezone)).map((row) => row.startsAt.getTime()));
      const earliest = Date.now() - LATE_BOOKING_GRACE_MS;
      return {
        date,
        onLeave: false,
        slotMinutes: doctor.slotMinutes,
        slots: instants.map((row) => ({
          startsAt: row.at,
          available: !booked.has(row.at.getTime()) && row.at.getTime() >= earliest,
        })),
      };
    });
  }

  async book(ctx: ReqCtx, input: z.output<typeof createAppointmentSchema>): Promise<Appointment> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const doctor = await this.requireActiveDoctor(tx, input.doctorId, true);
      if (!(await this.repo.patientExists(tx, input.patientId))) throw notFound('This patient');
      await this.assertBookableSlot(tx, doctor, input.startsAt);

      // The database refuses overlapping bookings for one doctor, so two people booking the same
      // slot at the same moment cannot both succeed. The loser receives a "slot_taken" conflict.
      const id = await this.repo.insertBooked(tx, {
        clinicId: ctx.user.clinicId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        startsAt: input.startsAt,
        slotMinutes: doctor.slotMinutes,
        reason: input.reason ?? null,
        createdBy: ctx.user.id,
      });
      await this.audit.record(tx, ctx, { action: 'appointment.booked', entity: 'appointment', entityId: id });
      return this.requireAppointment(tx, id);
    });
  }

  async walkin(ctx: ReqCtx, input: z.output<typeof walkinSchema>): Promise<Appointment> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const doctor = await this.requireActiveDoctor(tx, input.doctorId, true);
      if (!(await this.repo.patientExists(tx, input.patientId))) throw notFound('This patient');
      const timezone = await this.repo.clinicTimezone(tx);
      const id = await this.repo.insertWalkin(tx, {
        clinicId: ctx.user.clinicId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        slotMinutes: doctor.slotMinutes,
        reason: input.reason ?? null,
        createdBy: ctx.user.id,
        timezone,
      });
      await this.audit.record(tx, ctx, { action: 'appointment.walkin', entity: 'appointment', entityId: id });
      return this.requireAppointment(tx, id);
    });
  }

  list(ctx: ReqCtx, query: z.output<typeof listAppointmentsSchema>): Promise<Appointment[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      this.repo.listDay(tx, query.date, query.doctorId, query.status),
    );
  }

  queue(ctx: ReqCtx, doctorId: string | undefined): Promise<Appointment[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) => this.repo.queue(tx, doctorId));
  }

  async changeStatus(ctx: ReqCtx, id: string, status: AppointmentStatus): Promise<Appointment> {
    if (!roleMayMarkStatus(ctx.user.role, status)) throw forbidden();
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const current = await this.repo.lockById(tx, id);
      if (current === null) throw notFound('This appointment');
      if (!canTransition(current.status, status)) {
        throw conflict('invalid_status_change', `An appointment that is ${current.status.replace('_', ' ')} cannot become ${status.replace('_', ' ')}.`);
      }
      await this.repo.setStatus(tx, id, status);
      await this.audit.record(tx, ctx, {
        action: 'appointment.status_changed',
        entity: 'appointment',
        entityId: id,
        meta: { from: current.status, to: status },
      });
      return this.requireAppointment(tx, id);
    });
  }

  async reschedule(ctx: ReqCtx, id: string, startsAt: string): Promise<Appointment> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const current = await this.repo.lockById(tx, id);
      if (current === null) throw notFound('This appointment');
      if (current.kind !== 'appointment' || current.status !== 'booked') {
        throw conflict('cannot_reschedule', 'Only a booked appointment can be moved.');
      }
      const doctor = await this.requireActiveDoctor(tx, current.doctorId, true);
      await this.assertBookableSlot(tx, doctor, startsAt);
      await this.repo.reschedule(tx, id, startsAt, doctor.slotMinutes);
      await this.audit.record(tx, ctx, { action: 'appointment.rescheduled', entity: 'appointment', entityId: id });
      return this.requireAppointment(tx, id);
    });
  }

  private async requireActiveDoctor(tx: Tx, doctorId: string, lock: boolean): Promise<DoctorForBooking> {
    const doctor = lock ? await this.repo.lockDoctor(tx, doctorId) : await this.repo.getDoctor(tx, doctorId);
    if (doctor === null) throw notFound('This doctor');
    if (!doctor.active) throw badRequest('doctor_inactive', 'This doctor is not taking appointments.');
    return doctor;
  }

  private async requireAppointment(tx: Tx, id: string): Promise<Appointment> {
    const appointment = await this.repo.byId(tx, id);
    if (appointment === null) throw notFound('This appointment');
    return appointment;
  }

  /** The time must be a real slot in the doctor's schedule, on a working day, and not in the past. */
  private async assertBookableSlot(tx: Tx, doctor: DoctorForBooking, startsAt: string): Promise<void> {
    const timezone = await this.repo.clinicTimezone(tx);
    const local = await this.repo.localTime(tx, startsAt, timezone);
    if (local.hasSeconds) throw badRequest('not_a_slot', 'Choose one of the listed times.');
    if (await this.repo.isOnLeave(tx, doctor.id, local.day)) {
      throw badRequest('doctor_on_leave', 'The doctor is on leave that day.');
    }
    const sessions = await this.repo.sessionsOn(tx, doctor.id, weekdayOf(local.day));
    if (!sessionSlots(sessions, doctor.slotMinutes).includes(local.time)) {
      throw badRequest('not_a_slot', 'That time is outside the doctor\'s working hours. Choose one of the listed times.');
    }
    if (new Date(startsAt).getTime() < Date.now() - LATE_BOOKING_GRACE_MS) {
      throw badRequest('in_the_past', 'That time has already passed.');
    }
  }
}
