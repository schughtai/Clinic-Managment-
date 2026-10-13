import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import type { Appointment } from './appointments.repository';
import {
  AppointmentsService,
  type SlotsResult,
  createAppointmentSchema,
  listAppointmentsSchema,
  queueSchema,
  rescheduleSchema,
  slotsQuerySchema,
  statusChangeSchema,
  walkinSchema,
} from './appointments.service';

@Roles('owner', 'doctor', 'receptionist')
@Controller()
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly appointments: AppointmentsService) {}

  @Get('doctors/:id/slots')
  slots(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Query() query: unknown): Promise<SlotsResult> {
    return this.appointments.slots(ctx, parseId(id), parse(slotsQuerySchema, query).date);
  }

  @Post('appointments')
  book(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<Appointment> {
    return this.appointments.book(ctx, parse(createAppointmentSchema, body));
  }

  @Post('appointments/walkin')
  walkin(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<Appointment> {
    return this.appointments.walkin(ctx, parse(walkinSchema, body));
  }

  @Get('appointments')
  list(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<Appointment[]> {
    return this.appointments.list(ctx, parse(listAppointmentsSchema, query));
  }

  @Get('appointments/queue')
  queue(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<Appointment[]> {
    return this.appointments.queue(ctx, parse(queueSchema, query).doctorId);
  }

  @Patch('appointments/:id/status')
  changeStatus(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<Appointment> {
    return this.appointments.changeStatus(ctx, parseId(id), parse(statusChangeSchema, body).status);
  }

  @Patch('appointments/:id/reschedule')
  reschedule(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<Appointment> {
    return this.appointments.reschedule(ctx, parseId(id), parse(rescheduleSchema, body).startsAt);
  }
}
