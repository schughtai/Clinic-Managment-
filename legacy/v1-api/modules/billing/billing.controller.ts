import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { badRequest } from '../../common/errors';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import {
  BillingService,
  type Invoice,
  type InvoiceDetail,
  type PaymentResult,
  createInvoiceSchema,
  idempotencyKeySchema,
  listInvoicesSchema,
  recordPaymentSchema,
  voidInvoiceSchema,
} from './billing.service';

/** Money is handled at the front desk and by the owner. Doctors have no access to billing. */
@Roles('owner', 'receptionist')
@Controller('invoices')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post()
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<InvoiceDetail> {
    return this.billing.create(ctx, parse(createInvoiceSchema, body));
  }

  @Get()
  list(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<{ items: Invoice[]; total: number }> {
    return this.billing.list(ctx, parse(listInvoicesSchema, query));
  }

  @Get(':id')
  get(@Ctx() ctx: ReqCtx, @Param('id') id: string): Promise<InvoiceDetail> {
    return this.billing.get(ctx, parseId(id));
  }

  /** Send an Idempotency-Key header. If the network drops and the request is repeated, the payment is recorded once. */
  @Post(':id/payments')
  @HttpCode(201)
  pay(
    @Ctx() ctx: ReqCtx,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<PaymentResult> {
    let idempotencyKey: string | undefined;
    if (key !== undefined) {
      const checked = idempotencyKeySchema.safeParse(key);
      if (!checked.success) throw badRequest('invalid_idempotency_key', 'The Idempotency-Key header is not valid.');
      idempotencyKey = checked.data;
    }
    return this.billing.recordPayment(ctx, parseId(id), parse(recordPaymentSchema, body), idempotencyKey);
  }

  @Roles('owner')
  @Post(':id/void')
  @HttpCode(200)
  void(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<InvoiceDetail> {
    return this.billing.voidInvoice(ctx, parseId(id), parse(voidInvoiceSchema, body).reason);
  }
}
