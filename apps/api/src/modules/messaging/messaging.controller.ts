import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import { MessagingService, type PreparedMessage, type ReminderEntry, remindersQuerySchema } from './messaging.service';

@Controller()
export class MessagingController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  @Roles('owner', 'receptionist')
  @Get('reminders')
  reminders(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<ReminderEntry[]> {
    return this.messaging.reminders(ctx, parse(remindersQuerySchema, query).date);
  }

  @Roles('owner', 'receptionist')
  @Post('reminders/:appointmentId/mark-sent')
  @HttpCode(200)
  markSent(@Ctx() ctx: ReqCtx, @Param('appointmentId') appointmentId: string): Promise<ReminderEntry> {
    return this.messaging.markReminderSent(ctx, parseId(appointmentId));
  }

  @Roles('owner', 'doctor', 'receptionist')
  @Get('visits/:visitId/prescription/whatsapp')
  prescription(@Ctx() ctx: ReqCtx, @Param('visitId') visitId: string): Promise<PreparedMessage> {
    return this.messaging.prescription(ctx, parseId(visitId));
  }

  @Roles('owner', 'receptionist')
  @Get('invoices/:invoiceId/reminder')
  paymentReminder(@Ctx() ctx: ReqCtx, @Param('invoiceId') invoiceId: string): Promise<PreparedMessage> {
    return this.messaging.paymentReminder(ctx, parseId(invoiceId));
  }
}
