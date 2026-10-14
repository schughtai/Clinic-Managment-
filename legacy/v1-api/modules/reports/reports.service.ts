import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { badRequest, conflict } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema, nullableText, pageSchema } from '../../common/validate';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';

export const dailyQuerySchema = z.object({ date: dateSchema.optional() });
export const rangeQuerySchema = z.object({ from: dateSchema, to: dateSchema });
export const closeDaySchema = z
  .object({ date: dateSchema, countedCash: z.number().int().min(0).max(2_000_000_000), note: nullableText(500) })
  .strict();
export const listClosingsSchema = pageSchema;

type Method = 'cash' | 'bank' | 'jazzcash' | 'easypaisa';

export interface DailyReport {
  date: string;
  collected: { total: number; byMethod: Record<Method, number> };
  invoices: { count: number; billed: number };
  newPatients: number;
  visits: number;
  appointments: Record<string, number>;
  outstanding: { count: number; amount: number };
  closing: Closing | null;
}

export interface Closing {
  id: string;
  date: string;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string | null;
  closedAt: Date;
}

export interface DoctorReportRow {
  doctorId: string;
  doctorName: string;
  visits: number;
  billed: number;
  collected: number;
}

interface Range {
  day: string;
  start: Date;
  stop: Date;
  today: string;
}

const CLOSING_COLUMNS = `id, to_char(closing_date, 'YYYY-MM-DD') as date, expected_cash as "expectedCash",
  counted_cash as "countedCash", difference, note, closed_at as "closedAt"`;

const METHODS: readonly Method[] = ['cash', 'bank', 'jazzcash', 'easypaisa'];

function emptyByMethod(): Record<Method, number> {
  return { cash: 0, bank: 0, jazzcash: 0, easypaisa: 0 };
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  daily(ctx: ReqCtx, date: string | undefined): Promise<DailyReport> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const range = await this.rangeFor(tx, date, date);
      return this.buildDaily(tx, range);
    });
  }

  async closeDay(ctx: ReqCtx, input: z.output<typeof closeDaySchema>): Promise<Closing> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const range = await this.rangeFor(tx, input.date, input.date);
      if (range.day > range.today) throw badRequest('future_date', 'A day cannot be closed before it happens.');
      const report = await this.buildDaily(tx, range);
      if (report.closing !== null) throw conflict('already_closed', 'This day has already been closed.');
      const expected = report.collected.byMethod.cash;
      const closing = await tx.one<Closing>(
        `insert into day_closings (clinic_id, closing_date, expected_cash, counted_cash, difference, totals, note, closed_by)
         values ($1, $2::date, $3, $4, $5, $6::jsonb, $7, $8) returning ${CLOSING_COLUMNS}`,
        [
          ctx.user.clinicId,
          input.date,
          expected,
          input.countedCash,
          input.countedCash - expected,
          JSON.stringify({ collected: report.collected, invoices: report.invoices }),
          input.note ?? null,
          ctx.user.id,
        ],
      );
      await this.audit.record(tx, ctx, {
        action: 'day.closed',
        entity: 'day_closing',
        entityId: closing.id,
        meta: { date: input.date, difference: closing.difference },
      });
      return closing;
    });
  }

  listClosings(ctx: ReqCtx, limit: number, offset: number): Promise<Closing[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.many<Closing>(`select ${CLOSING_COLUMNS} from day_closings order by closing_date desc limit $1 offset $2`, [limit, offset]),
    );
  }

  /** Per doctor: patients seen, amount billed on their visits and amount collected, for a date range. */
  async byDoctor(ctx: ReqCtx, from: string, to: string): Promise<DoctorReportRow[]> {
    if (from > to) throw badRequest('invalid_range', 'The start date must not be after the end date.');
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const range = await this.rangeFor(tx, from, to);
      return tx.many<DoctorReportRow>(
        `select d.id as "doctorId", d.name as "doctorName",
                (select count(*)::int from visits v where v.doctor_id = d.id and v.visited_at >= $1 and v.visited_at < $2) as visits,
                coalesce((select sum(i.total) from invoices i join visits v on v.id = i.visit_id
                           where v.doctor_id = d.id and i.status <> 'void' and i.created_at >= $1 and i.created_at < $2), 0)::int as billed,
                coalesce((select sum(p.amount) from payments p join invoices i on i.id = p.invoice_id join visits v on v.id = i.visit_id
                           where v.doctor_id = d.id and p.received_at >= $1 and p.received_at < $2), 0)::int as collected
           from doctors d order by d.name`,
        [range.start, range.stop],
      );
    });
  }

  /** The start and end of a local calendar day range, as exact instants in the clinic's time zone. */
  private rangeFor(tx: Tx, from: string | undefined, to: string | undefined): Promise<Range> {
    return tx.one<Range>(
      `with c as (select timezone from clinics limit 1),
            t as (select (now() at time zone c.timezone)::date as today, c.timezone as tz from c),
            d as (select coalesce($1::date, t.today) as first, coalesce($2::date, t.today) as last, t.today, t.tz from t)
       select to_char(d.first, 'YYYY-MM-DD') as day,
              (d.first::timestamp at time zone d.tz) as start,
              ((d.last + 1)::timestamp at time zone d.tz) as stop,
              to_char(d.today, 'YYYY-MM-DD') as today
         from d`,
      [from ?? null, to ?? null],
    );
  }

  private async buildDaily(tx: Tx, range: Range): Promise<DailyReport> {
    const payments = await tx.many<{ method: Method; amount: number }>(
      'select method, sum(amount)::int as amount from payments where received_at >= $1 and received_at < $2 group by method',
      [range.start, range.stop],
    );
    const byMethod = emptyByMethod();
    for (const row of payments) if (METHODS.includes(row.method)) byMethod[row.method] = row.amount;

    const invoices = await tx.one<{ count: number; billed: number }>(
      "select count(*)::int as count, coalesce(sum(total), 0)::int as billed from invoices where status <> 'void' and created_at >= $1 and created_at < $2",
      [range.start, range.stop],
    );
    const newPatients = await tx.one<{ count: number }>('select count(*)::int as count from patients where created_at >= $1 and created_at < $2', [
      range.start,
      range.stop,
    ]);
    const visits = await tx.one<{ count: number }>('select count(*)::int as count from visits where visited_at >= $1 and visited_at < $2', [
      range.start,
      range.stop,
    ]);
    const appointmentRows = await tx.many<{ status: string; count: number }>(
      'select status, count(*)::int as count from appointments where starts_at >= $1 and starts_at < $2 group by status',
      [range.start, range.stop],
    );
    const outstanding = await tx.one<{ count: number; amount: number }>(
      "select count(*)::int as count, coalesce(sum(total - paid), 0)::int as amount from invoices where status in ('unpaid', 'partial')",
    );
    const closing = await tx.maybeOne<Closing>(`select ${CLOSING_COLUMNS} from day_closings where closing_date = $1::date`, [range.day]);

    return {
      date: range.day,
      collected: { total: Object.values(byMethod).reduce((sum, value) => sum + value, 0), byMethod },
      invoices,
      newPatients: newPatients.count,
      visits: visits.count,
      appointments: Object.fromEntries(appointmentRows.map((row) => [row.status, row.count])),
      outstanding,
      closing,
    };
  }
}
