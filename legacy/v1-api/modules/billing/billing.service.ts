import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../common/errors';
import { priceInvoice, statusFor } from '../../common/money';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema, nullableText, pageSchema } from '../../common/validate';
import { DbService } from '../../db/db.service';

const rupees = z.number().int().min(0).max(100_000_000);

const lineSchema = z
  .object({
    description: z.string().trim().min(1, 'Required.').max(200),
    quantity: z.number().int().min(1).max(10_000).default(1),
    unitPrice: rupees,
  })
  .strict();

export const createInvoiceSchema = z
  .object({
    patientId: z.string().uuid(),
    visitId: z.string().uuid().optional(),
    lines: z.array(lineSchema).min(1, 'Add at least one item.').max(50),
    discount: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('amount'), value: rupees }).strict(),
        z.object({ kind: z.literal('percent'), value: z.number().min(0).max(100) }).strict(),
      ])
      .optional(),
  })
  .strict();

export const recordPaymentSchema = z
  .object({
    amount: z.number().int().min(1).max(100_000_000),
    method: z.enum(['cash', 'bank', 'jazzcash', 'easypaisa']),
    reference: nullableText(100),
  })
  .strict();

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const listInvoicesSchema = pageSchema.extend({
  status: z.enum(['unpaid', 'partial', 'paid', 'void', 'open']).optional(),
  patientId: z.string().uuid().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const idempotencyKeySchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/);

export interface Invoice {
  id: string;
  invoiceNo: number;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  visitId: string | null;
  status: 'unpaid' | 'partial' | 'paid' | 'void';
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  voidReason: string | null;
  createdAt: Date;
}

export interface InvoiceDetail extends Invoice {
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  payments: Payment[];
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: 'cash' | 'bank' | 'jazzcash' | 'easypaisa';
  reference: string | null;
  receivedAt: Date;
}

export interface PaymentResult {
  payment: Payment;
  invoice: Invoice;
  /** True when this exact request had already been recorded and nothing new was written. */
  replayed: boolean;
}

const INVOICE_SELECT = `
  select i.id, i.invoice_no as "invoiceNo", i.patient_id as "patientId", p.name as "patientName", p.phone as "patientPhone",
         i.visit_id as "visitId", i.status, i.subtotal, i.discount, i.total, i.paid,
         case when i.status = 'void' then 0 else i.total - i.paid end as due,
         i.void_reason as "voidReason", i.created_at as "createdAt"
    from invoices i join patients p on p.id = i.patient_id`;

const PAYMENT_COLUMNS = `id, invoice_id as "invoiceId", amount, method, reference, received_at as "receivedAt"`;

@Injectable()
export class BillingService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(ctx: ReqCtx, input: z.output<typeof createInvoiceSchema>): Promise<InvoiceDetail> {
    let totals;
    try {
      totals = priceInvoice(
        input.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice })),
        input.discount,
      );
    } catch {
      throw unprocessable('discount_too_large', 'The discount is larger than the total of the items.');
    }
    if (!Number.isSafeInteger(totals.subtotal) || totals.subtotal > 2_000_000_000) {
      throw unprocessable('amount_too_large', 'The invoice total is too large.');
    }

    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const patient = await tx.maybeOne<{ id: string }>('select id from patients where id = $1', [input.patientId]);
      if (patient === null) throw notFound('This patient');
      if (input.visitId !== undefined) {
        const visit = await tx.maybeOne<{ patientId: string }>('select patient_id as "patientId" from visits where id = $1', [input.visitId]);
        if (visit === null) throw notFound('This visit');
        if (visit.patientId !== input.patientId) throw badRequest('visit_mismatch', 'This visit belongs to a different patient.');
      }
      // The invoice number comes from a counter that is locked while it is incremented, so numbers never repeat.
      const seq = await tx.one<{ seq: number }>('update clinics set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq as seq', [
        ctx.user.clinicId,
      ]);
      const created = await tx.one<{ id: string }>(
        `insert into invoices (clinic_id, invoice_no, patient_id, visit_id, status, subtotal, discount, total, paid, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9) returning id`,
        [ctx.user.clinicId, seq.seq, input.patientId, input.visitId ?? null, statusFor(totals.total, 0), totals.subtotal, totals.discount, totals.total, ctx.user.id],
      );
      for (const [position, line] of totals.lines.entries()) {
        await tx.execute(
          'insert into invoice_items (clinic_id, invoice_id, position, description, quantity, unit_price, amount) values ($1, $2, $3, $4, $5, $6, $7)',
          [ctx.user.clinicId, created.id, position, line.description, line.quantity, line.unitPrice, line.amount],
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'invoice.created',
        entity: 'invoice',
        entityId: created.id,
        meta: { invoiceNo: seq.seq, total: totals.total },
      });
      return this.detail(tx, created.id);
    });
  }

  async list(ctx: ReqCtx, query: z.output<typeof listInvoicesSchema>): Promise<{ items: Invoice[]; total: number }> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const where = `
        where ($1::text is null or ($1 = 'open' and i.status in ('unpaid', 'partial')) or i.status = $1)
          and ($2::uuid is null or i.patient_id = $2)
          and ($3::date is null or i.created_at >= ($3::date::timestamp at time zone (select timezone from clinics limit 1)))
          and ($4::date is null or i.created_at < (($4::date + 1)::timestamp at time zone (select timezone from clinics limit 1)))`;
      const params = [query.status ?? null, query.patientId ?? null, query.from ?? null, query.to ?? null];
      const items = await tx.many<Invoice>(`${INVOICE_SELECT} ${where} order by i.created_at desc, i.invoice_no desc limit $5 offset $6`, [
        ...params,
        query.limit,
        query.offset,
      ]);
      const count = await tx.one<{ total: number }>(`select count(*)::int as total from invoices i ${where}`, params);
      return { items, total: count.total };
    });
  }

  get(ctx: ReqCtx, id: string): Promise<InvoiceDetail> {
    return this.db.withClinic(ctx.user.clinicId, (tx) => this.detail(tx, id));
  }

  /**
   * Records money received. The invoice row is locked first, so two payments at the same moment are
   * handled one after the other and can never add up to more than the invoice total. A repeated request
   * with the same idempotency key returns the original payment instead of recording a second one.
   */
  async recordPayment(ctx: ReqCtx, invoiceId: string, input: z.output<typeof recordPaymentSchema>, idempotencyKey: string | undefined): Promise<PaymentResult> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const locked = await tx.maybeOne<{ status: Invoice['status']; total: number; paid: number }>(
        'select status, total, paid from invoices where id = $1 for update',
        [invoiceId],
      );
      if (locked === null) throw notFound('This invoice');

      if (idempotencyKey !== undefined) {
        const earlier = await tx.maybeOne<Payment>(`select ${PAYMENT_COLUMNS} from payments where idempotency_key = $1`, [idempotencyKey]);
        if (earlier !== null) {
          if (earlier.invoiceId !== invoiceId || earlier.amount !== input.amount || earlier.method !== input.method) {
            throw conflict('idempotency_conflict', 'This request key was already used for a different payment.');
          }
          return { payment: earlier, invoice: await this.requireInvoice(tx, invoiceId), replayed: true };
        }
      }

      if (locked.status === 'void') throw conflict('invoice_void', 'This invoice was cancelled.');
      const remaining = locked.total - locked.paid;
      if (remaining === 0) throw conflict('already_paid', 'This invoice is already fully paid.');
      if (input.amount > remaining) {
        throw unprocessable('overpayment', `The amount is more than what is still due (Rs ${remaining}).`, { remaining });
      }

      const payment = await tx.one<Payment>(
        `insert into payments (clinic_id, invoice_id, amount, method, reference, idempotency_key, received_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${PAYMENT_COLUMNS}`,
        [ctx.user.clinicId, invoiceId, input.amount, input.method, input.reference ?? null, idempotencyKey ?? null, ctx.user.id],
      );
      const paid = locked.paid + input.amount;
      await tx.execute('update invoices set paid = $2, status = $3 where id = $1', [invoiceId, paid, statusFor(locked.total, paid)]);
      await this.audit.record(tx, ctx, {
        action: 'payment.recorded',
        entity: 'invoice',
        entityId: invoiceId,
        meta: { amount: input.amount, method: input.method },
      });
      return { payment, invoice: await this.requireInvoice(tx, invoiceId), replayed: false };
    });
  }

  /** An invoice that has taken money cannot be cancelled, because refunds are not part of this version. */
  async voidInvoice(ctx: ReqCtx, id: string, reason: string): Promise<InvoiceDetail> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const locked = await tx.maybeOne<{ status: Invoice['status']; paid: number }>('select status, paid from invoices where id = $1 for update', [id]);
      if (locked === null) throw notFound('This invoice');
      if (locked.status === 'void') throw conflict('already_void', 'This invoice is already cancelled.');
      if (locked.paid > 0) {
        throw new AppError(409, 'has_payments', 'An invoice with payments cannot be cancelled. Refunds are not supported yet.');
      }
      await tx.execute("update invoices set status = 'void', void_reason = $2 where id = $1", [id, reason]);
      await this.audit.record(tx, ctx, { action: 'invoice.voided', entity: 'invoice', entityId: id });
      return this.detail(tx, id);
    });
  }

  private async requireInvoice(tx: import('../../db/tx').Tx, id: string): Promise<Invoice> {
    const invoice = await tx.maybeOne<Invoice>(`${INVOICE_SELECT} where i.id = $1`, [id]);
    if (invoice === null) throw notFound('This invoice');
    return invoice;
  }

  private async detail(tx: import('../../db/tx').Tx, id: string): Promise<InvoiceDetail> {
    const invoice = await this.requireInvoice(tx, id);
    const items = await tx.many<InvoiceDetail['items'][number]>(
      'select description, quantity, unit_price as "unitPrice", amount from invoice_items where invoice_id = $1 order by position, id',
      [id],
    );
    const payments = await tx.many<Payment>(`select ${PAYMENT_COLUMNS} from payments where invoice_id = $1 order by received_at, id`, [id]);
    return { ...invoice, items, payments };
  }
}
