import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { freeSlots, zonedToUtc, type Range, type WorkingRange } from './slots';

export interface PractitionerInput {
  name: string;
  specialty: string | null;
  registrationNo: string | null;
  facilityIds: string[];
  active: boolean;
}

export interface AppointmentTypeInput {
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  defaultFeeMinor: number;
  currency: string;
  active: boolean;
}

interface FacilityRow {
  id: string;
  timezone: string | null;
  org_timezone: string;
}

const dayRange = (date: string, timezone: string): Range => ({
  start: zonedToUtc(date, '00:00', timezone),
  end: zonedToUtc(date, '00:00', timezone) + 24 * 3_600_000,
});

/** Schedules, leave, holidays and the slot finder for organization staff. */
@Injectable()
export class ScheduleService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ practitioners

  list(ctx: ReqCtx) {
    return this.db.withContext(orgDb(ctx), (tx) =>
      tx.many(
        `select p.id, p.name, p.specialty, p.registration_no as "registrationNo", p.active, p.person_id as "personId",
                coalesce(array_agg(pf.facility_id) filter (where pf.facility_id is not null), '{}') as "facilityIds"
         from practitioners p left join practitioner_facilities pf on pf.practitioner_id = p.id
         group by p.id order by p.name`,
      ),
    );
  }

  async create(ctx: ReqCtx, input: PractitionerInput) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertFacilities(tx, input.facilityIds);
      const row = await tx.one<{ id: string }>(
        `insert into practitioners (organization_id, name, specialty, registration_no, active)
         values ($1, $2, $3, $4, $5) returning id`,
        [orgOf(ctx).id, input.name, input.specialty, input.registrationNo, input.active],
      );
      await this.linkFacilities(tx, orgOf(ctx).id, row.id, input.facilityIds);
      await this.audit.org(tx, ctx, 'practitioner.created', { type: 'practitioner', id: row.id });
      return { id: row.id };
    });
  }

  async update(ctx: ReqCtx, id: string, input: PractitionerInput) {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertFacilities(tx, input.facilityIds);
      const updated = await tx.execute(
        `update practitioners set name = $1, specialty = $2, registration_no = $3, active = $4 where id = $5`,
        [input.name, input.specialty, input.registrationNo, input.active, id],
      );
      if (updated === 0) throw notFound('Practitioner');
      await tx.execute('delete from practitioner_facilities where practitioner_id = $1', [id]);
      await this.linkFacilities(tx, orgOf(ctx).id, id, input.facilityIds);
      await this.audit.org(tx, ctx, 'practitioner.updated', { type: 'practitioner', id });
    });
  }

  /** Replaces one practitioner's weekly hours at one facility. Overlapping ranges are refused. */
  async setHours(ctx: ReqCtx, practitionerId: string, facilityId: string, ranges: WorkingRange[]) {
    assertNoOverlap(ranges);
    await this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertPractitioner(tx, practitionerId);
      await this.assertFacility(tx, facilityId);
      await tx.execute('delete from working_hours where practitioner_id = $1 and facility_id = $2', [practitionerId, facilityId]);
      for (const range of ranges) {
        await tx.execute(
          `insert into working_hours (organization_id, facility_id, practitioner_id, day, opens, closes) values ($1, $2, $3, $4, $5, $6)`,
          [orgOf(ctx).id, facilityId, practitionerId, range.day, range.opens, range.closes],
        );
      }
      await this.audit.org(tx, ctx, 'schedule.hours_changed', { type: 'practitioner', id: practitionerId, facilityId });
    });
  }

  async hours(ctx: ReqCtx, practitionerId: string, facilityId: string) {
    return this.db.withContext(orgDb(ctx), (tx) =>
      tx.many<{ day: number; opens: string; closes: string }>(
        `select day, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
         from working_hours where practitioner_id = $1 and facility_id = $2 order by day, opens`,
        [practitionerId, facilityId],
      ),
    );
  }

  async addLeave(ctx: ReqCtx, practitionerId: string, startsAt: string, endsAt: string, reason: string | null) {
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new AppError(400, 'validation_failed', 'The leave must end after it starts.');
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertPractitioner(tx, practitionerId);
      const overlapping = await tx.one<{ n: number }>(
        `select count(*)::int as n from leave_periods where practitioner_id = $1 and tstzrange(starts_at, ends_at) && tstzrange($2, $3)`,
        [practitionerId, startsAt, endsAt],
      );
      if (overlapping.n > 0) throw new AppError(409, 'leave_overlaps', 'This practitioner already has leave in that period.');
      const row = await tx.one<{ id: string }>(
        'insert into leave_periods (organization_id, practitioner_id, starts_at, ends_at, reason) values ($1, $2, $3, $4, $5) returning id',
        [orgOf(ctx).id, practitionerId, startsAt, endsAt, reason],
      );
      // Bookings inside the leave are returned for rescheduling; they are not cancelled automatically.
      const affected = await tx.many<{ id: string; starts_at: Date }>(
        `select id, starts_at from appointments where practitioner_id = $1 and status in ('booked','confirmed')
           and during && tstzrange($2, $3)`,
        [practitionerId, startsAt, endsAt],
      );
      await this.audit.org(tx, ctx, 'schedule.leave_added', { type: 'practitioner', id: practitionerId });
      return { id: row.id, affectedAppointments: affected.map((a) => ({ id: a.id, startsAt: a.starts_at.toISOString() })) };
    });
  }

  async deleteLeave(ctx: ReqCtx, leaveId: string) {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      const deleted = await tx.execute('delete from leave_periods where id = $1', [leaveId]);
      if (deleted === 0) throw notFound('Leave');
      await this.audit.org(tx, ctx, 'schedule.leave_removed', { type: 'leave', id: leaveId });
    });
  }

  async addHoliday(ctx: ReqCtx, facilityId: string, onDate: string, name: string) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertFacility(tx, facilityId);
      const row = await tx.one<{ id: string }>(
        'insert into facility_holidays (organization_id, facility_id, on_date, name) values ($1, $2, $3, $4) returning id',
        [orgOf(ctx).id, facilityId, onDate, name],
      );
      await this.audit.org(tx, ctx, 'schedule.holiday_added', { type: 'facility', id: facilityId, facilityId });
      return { id: row.id };
    });
  }

  // ------------------------------------------------------------ appointment types

  listTypes(ctx: ReqCtx) {
    return this.db.withContext(orgDb(ctx), (tx) =>
      tx.many(
        `select id, name, duration_minutes as "durationMinutes", buffer_minutes as "bufferMinutes",
                default_fee_minor::text as "defaultFeeMinor", currency, active
         from appointment_types order by name`,
      ),
    );
  }

  async createType(ctx: ReqCtx, input: AppointmentTypeInput) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const row = await tx.one<{ id: string }>(
        `insert into appointment_types (organization_id, name, duration_minutes, buffer_minutes, default_fee_minor, currency, active)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [orgOf(ctx).id, input.name, input.durationMinutes, input.bufferMinutes, input.defaultFeeMinor, input.currency, input.active],
      );
      await this.audit.org(tx, ctx, 'appointment_type.created', { type: 'appointment_type', id: row.id });
      return { id: row.id };
    });
  }

  // ------------------------------------------------------------ slots

  /** Free starts for a practitioner at a facility on a local date (FR-014, SC-002). */
  async slots(ctx: ReqCtx, facilityId: string, practitionerId: string, typeId: string, date: string) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const facility = await tx.maybeOne<FacilityRow>(
        `select f.id, f.timezone, o.timezone as org_timezone from facilities f join organizations o on o.id = f.organization_id where f.id = $1`,
        [facilityId],
      );
      if (facility === null) throw notFound('Branch');
      const timezone = facility.timezone ?? facility.org_timezone;
      const type = await tx.maybeOne<{ duration_minutes: number; buffer_minutes: number }>(
        'select duration_minutes, buffer_minutes from appointment_types where id = $1 and active',
        [typeId],
      );
      if (type === null) throw notFound('Appointment type');
      const hours = await tx.many<{ day: number; opens: string; closes: string }>(
        `select day, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
         from working_hours where practitioner_id = $1 and facility_id = $2`,
        [practitionerId, facilityId],
      );
      const window = dayRange(date, timezone);
      const leave = await tx.many<{ starts_at: Date; ends_at: Date }>(
        'select starts_at, ends_at from leave_periods where practitioner_id = $1 and tstzrange(starts_at, ends_at) && tstzrange($2, $3)',
        [practitionerId, new Date(window.start).toISOString(), new Date(window.end).toISOString()],
      );
      const holiday = await tx.maybeOne<{ n: number }>(
        'select 1 as n from facility_holidays where facility_id = $1 and on_date = $2::date',
        [facilityId, date],
      );
      const booked = await tx.many<{ during: string }>(
        `select during::text from appointments where practitioner_id = $1 and status in ('booked','confirmed','checked_in','in_progress')
           and during && tstzrange($2, $3)`,
        [practitionerId, new Date(window.start).toISOString(), new Date(window.end).toISOString()],
      );
      const blocked: Range[] = leave.map((l) => ({ start: l.starts_at.getTime(), end: l.ends_at.getTime() }));
      if (holiday !== null) blocked.push(window);
      const bookedRanges = booked.map((row) => parseRange(row.during)).filter((r): r is Range => r !== null);
      const now = Date.now();
      const slots = freeSlots({
        localDate: date,
        timezone,
        hours,
        blocked,
        booked: bookedRanges,
        durationMinutes: type.duration_minutes,
        bufferMinutes: type.buffer_minutes,
        notBefore: now,
      });
      return { timezone, slots: slots.map((s) => new Date(s).toISOString()) };
    });
  }

  // ------------------------------------------------------------ helpers

  private async assertPractitioner(tx: Tx, id: string): Promise<void> {
    const row = await tx.maybeOne('select 1 from practitioners where id = $1', [id]);
    if (row === null) throw notFound('Practitioner');
  }

  private async assertFacility(tx: Tx, id: string): Promise<void> {
    const row = await tx.maybeOne('select 1 from facilities where id = $1 and active', [id]);
    if (row === null) throw notFound('Branch');
  }

  private async assertFacilities(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) throw new AppError(400, 'validation_failed', 'Choose at least one branch.');
    const found = await tx.one<{ n: number }>('select count(*)::int as n from facilities where id = any ($1) and active', [ids]);
    if (found.n !== new Set(ids).size) throw notFound('Branch');
  }

  private async linkFacilities(tx: Tx, orgId: string, practitionerId: string, facilityIds: string[]): Promise<void> {
    for (const facilityId of new Set(facilityIds)) {
      await tx.execute(
        'insert into practitioner_facilities (practitioner_id, facility_id, organization_id) values ($1, $2, $3)',
        [practitionerId, facilityId, orgId],
      );
    }
  }
}

function assertNoOverlap(ranges: WorkingRange[]): void {
  for (const range of ranges) {
    if (range.closes <= range.opens) throw new AppError(400, 'validation_failed', 'Closing time must be after opening time.');
  }
  for (let day = 0; day <= 6; day += 1) {
    const sameDay = ranges.filter((r) => r.day === day).sort((a, b) => a.opens.localeCompare(b.opens));
    for (let i = 1; i < sameDay.length; i += 1) {
      if (sameDay[i]!.opens < sameDay[i - 1]!.closes) {
        throw new AppError(400, 'validation_failed', 'Working hours on the same day must not overlap.');
      }
    }
  }
}

/** Parses a Postgres tstzrange text such as ["2030-01-07 04:00:00+00","2030-01-07 04:15:00+00"). */
export function parseRange(text: string): Range | null {
  const match = /^[[(]"?(.+?)"?,"?(.+?)"?[\])]$/.exec(text);
  if (match === null) return null;
  const start = Date.parse(match[1]!.replace(' ', 'T'));
  const end = Date.parse(match[2]!.replace(' ', 'T'));
  return Number.isNaN(start) || Number.isNaN(end) ? null : { start, end };
}

