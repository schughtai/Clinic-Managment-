import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import { APPOINTMENT_STATUSES } from './transitions';
import { AppointmentsService } from './appointments.service';
import { QueueService, QUEUE_STATUSES } from '../queue/queue.service';

const bookSchema = z.object({
  facilityId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  patientId: z.string().uuid(),
  typeId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(200) });
const rescheduleSchema = z.object({ startsAt: z.string().datetime({ offset: true }) });
const statusSchema = z.object({ to: z.enum(APPOINTMENT_STATUSES) });
const listSchema = z.object({
  facility: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  practitioner: z.string().uuid().optional(),
});
const ticketSchema = z.object({
  facilityId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});
const queueMoveSchema = z.object({ to: z.enum(QUEUE_STATUSES) });
const queueListSchema = z.object({
  facility: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  display: z.enum(['true', 'false']).optional(),
});

@Controller('orgs/:slug')
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}

  @Permission('appointments.read')
  @Get('appointments')
  list(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    const input = parse(listSchema, query);
    return this.appointments.list(ctx, input.facility, input.date, input.practitioner);
  }

  @Permission('appointments.manage')
  @Post('appointments')
  @HttpCode(201)
  book(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.appointments.book(ctx, parse(bookSchema, body));
  }

  @Permission('appointments.manage')
  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  reschedule(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.appointments.reschedule(ctx, parseId(id), parse(rescheduleSchema, body).startsAt);
  }

  @Permission('appointments.manage')
  @Post('appointments/:id/cancel')
  @HttpCode(200)
  async cancel(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    await this.appointments.cancel(ctx, parseId(id), parse(cancelSchema, body).reason);
    return { ok: true };
  }

  @Permission('appointments.manage')
  @Post('appointments/:id/status')
  @HttpCode(200)
  setStatus(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.appointments.setStatus(ctx, parseId(id), parse(statusSchema, body).to);
  }

  @Permission('queue.manage')
  @Post('queue/tickets')
  @HttpCode(201)
  issue(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.queue.issue(ctx, parse(ticketSchema, body));
  }

  @Permission('queue.manage')
  @Get('queue')
  today(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    const input = parse(queueListSchema, query);
    return this.queue.list(ctx, input.facility, input.day, input.display === 'true');
  }

  @Permission('queue.manage')
  @Post('queue/tickets/:id/transition')
  @HttpCode(200)
  moveTicket(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.queue.transition(ctx, parseId(id), parse(queueMoveSchema, body).to);
  }
}
