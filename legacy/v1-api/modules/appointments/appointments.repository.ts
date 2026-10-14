import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/tx';
import type { AppointmentStatus } from './slots';

export interface Appointment {
  id: string;
  kind: 'appointment' | 'walkin';
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  tokenNo: number | null;
  reason: string | null;
  patientId: string;
  patientName: string;
  patientNo: number;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
}

export interface DoctorForBooking {
  id: string;
  name: string;
  slotMinutes: number;
  active: boolean;
}

const SELECT = `
  select a.id, a.kind, a.status, a.starts_at as "startsAt", a.ends_at as "endsAt",
         a.token_no as "tokenNo", a.reason,
         a.patient_id as "patientId", p.name as "patientName", p.patient_no as "patientNo", p.phone as "patientPhone",
         a.doctor_id as "doctorId", d.name as "doctorName"
    from appointments a
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join clinics c on c.id = a.clinic_id`;

const DAY_RANGE = `
  a.starts_at >= (coalesce($1::date, (now() at time zone c.timezone)::date)::timestamp at time zone c.timezone)
  and a.starts_at < ((coalesce($1::date, (now() at time zone c.timezone)::date) + 1)::timestamp at time zone c.timezone)`;

export interface LocalTime {
  day: string;
  time: string;
  hasSeconds: boolean;
}

@Injectable()
export class AppointmentsRepository {
  clinicTimezone(tx: Tx): Promise<string> {
    return tx.one<{ timezone: string }>('select timezone from clinics limit 1').then((row) => row.timezone);
  }

  /** Locks the doctor row so token numbers and slot checks for one doctor happen one at a time. */
  lockDoctor(tx: Tx, doctorId: string): Promise<DoctorForBooking | null> {
    return tx.maybeOne<DoctorForBooking>(
      'select id, name, slot_minutes as "slotMinutes", active from doctors where id = $1 for update',
      [doctorId],
    );
  }

  getDoctor(tx: Tx, doctorId: string): Promise<DoctorForBooking | null> {
    return tx.maybeOne<DoctorForBooking>(
      'select id, name, slot_minutes as "slotMinutes", active from doctors where id = $1',
      [doctorId],
    );
  }

  patientExists(tx: Tx, patientId: string): Promise<boolean> {
    return tx.maybeOne<{ id: string }>('select id from patients where id = $1', [patientId]).then((row) => row !== null);
  }

  /** The doctor's local calendar day and clock time for an instant, in the clinic's time zone. */
  localTime(tx: Tx, instant: string, timezone: string): Promise<LocalTime> {
    return tx.one<LocalTime>(
      `select to_char($1::timestamptz at time zone $2, 'YYYY-MM-DD') as day,
              to_char($1::timestamptz at time zone $2, 'HH24:MI') as time,
              (extract(second from $1::timestamptz) <> 0) as "hasSeconds"`,
      [instant, timezone],
    );
  }

  sessionsOn(tx: Tx, doctorId: string, weekday: number): Promise<{ start: string; end: string }[]> {
    return tx.many(
      `select to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end"
         from doctor_schedules where doctor_id = $1 and weekday = $2 order by start_time`,
      [doctorId, weekday],
    );
  }

  async isOnLeave(tx: Tx, doctorId: string, day: string): Promise<boolean> {
    const row = await tx.maybeOne<{ id: string }>(
      'select id from doctor_leaves where doctor_id = $1 and leave_date = $2',
      [doctorId, day],
    );
    return row !== null;
  }

  /** Converts local "YYYY-MM-DD HH:MM" strings to exact instants using the clinic's time zone. */
  localToInstants(tx: Tx, localTimes: string[], timezone: string): Promise<{ at: Date }[]> {
    return tx.many<{ at: Date }>(
      'select (t::timestamp at time zone $2) as at from unnest($1::text[]) with ordinality as u(t, n) order by n',
      [localTimes, timezone],
    );
  }

  bookedStarts(tx: Tx, doctorId: string, day: string, timezone: string): Promise<{ startsAt: Date }[]> {
    return tx.many<{ startsAt: Date }>(
      `select starts_at as "startsAt" from appointments
        where doctor_id = $1 and kind = 'appointment' and status in ('booked', 'arrived', 'in_consult')
          and starts_at >= ($2::date::timestamp at time zone $3)
          and starts_at < (($2::date + 1)::timestamp at time zone $3)`,
      [doctorId, day, timezone],
    );
  }

  async insertBooked(
    tx: Tx,
    input: { clinicId: string; patientId: string; doctorId: string; startsAt: string; slotMinutes: number; reason: string | null; createdBy: string },
  ): Promise<string> {
    const row = await tx.one<{ id: string }>(
      `insert into appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at, kind, status, reason, created_by)
       values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), 'appointment', 'booked', $6, $7)
       returning id`,
      [input.clinicId, input.patientId, input.doctorId, input.startsAt, input.slotMinutes, input.reason, input.createdBy],
    );
    return row.id;
  }

  async insertWalkin(
    tx: Tx,
    input: { clinicId: string; patientId: string; doctorId: string; slotMinutes: number; reason: string | null; createdBy: string; timezone: string },
  ): Promise<string> {
    const row = await tx.one<{ id: string }>(
      `with today as (select (now() at time zone $7)::date as day),
            next as (select coalesce(max(token_no), 0) + 1 as token
                       from appointments, today
                      where doctor_id = $3 and token_date = today.day)
       insert into appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at, kind, status,
                                 token_date, token_no, reason, created_by)
       select $1, $2, $3, now(), now() + make_interval(mins => $4), 'walkin', 'arrived',
              today.day, next.token, $5, $6
         from today, next
       returning id`,
      [input.clinicId, input.patientId, input.doctorId, input.slotMinutes, input.reason, input.createdBy, input.timezone],
    );
    return row.id;
  }

  byId(tx: Tx, id: string): Promise<Appointment | null> {
    return tx.maybeOne<Appointment>(`${SELECT} where a.id = $1`, [id]);
  }

  lockById(tx: Tx, id: string): Promise<{ id: string; status: AppointmentStatus; kind: 'appointment' | 'walkin'; doctorId: string } | null> {
    return tx.maybeOne(
      'select id, status, kind, doctor_id as "doctorId" from appointments where id = $1 for update',
      [id],
    );
  }

  listDay(tx: Tx, date: string | undefined, doctorId: string | undefined, status: string | undefined): Promise<Appointment[]> {
    return tx.many<Appointment>(
      `${SELECT}
        where ${DAY_RANGE}
          and ($2::uuid is null or a.doctor_id = $2)
          and ($3::text is null or a.status = $3)
        order by a.starts_at, a.token_no nulls first`,
      [date ?? null, doctorId ?? null, status ?? null],
    );
  }

  queue(tx: Tx, doctorId: string | undefined): Promise<Appointment[]> {
    return tx.many<Appointment>(
      `${SELECT}
        where ${DAY_RANGE}
          and a.status in ('booked', 'arrived', 'in_consult')
          and ($2::uuid is null or a.doctor_id = $2)
        order by case a.status when 'in_consult' then 0 when 'arrived' then 1 else 2 end, a.starts_at`,
      [null, doctorId ?? null],
    );
  }

  setStatus(tx: Tx, id: string, status: AppointmentStatus): Promise<number> {
    return tx.execute('update appointments set status = $2 where id = $1', [id, status]);
  }

  reschedule(tx: Tx, id: string, startsAt: string, slotMinutes: number): Promise<number> {
    return tx.execute(
      `update appointments set starts_at = $2::timestamptz, ends_at = $2::timestamptz + make_interval(mins => $3)
        where id = $1`,
      [id, startsAt, slotMinutes],
    );
  }
}
