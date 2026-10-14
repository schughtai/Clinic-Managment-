import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import { ScheduleService } from './schedule.service';

const timeText = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM.');
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const practitionerSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(120),
  specialty: z.string().trim().max(80).nullable().optional().transform((v) => v ?? null),
  registrationNo: z.string().trim().max(40).nullable().optional().transform((v) => v ?? null),
  facilityIds: z.array(z.string().uuid()).min(1, 'Choose at least one branch.').max(50),
  active: z.boolean().default(true),
});

const hoursSchema = z.object({
  ranges: z
    .array(z.object({ day: z.number().int().min(0).max(6), opens: timeText, closes: timeText }))
    .max(28),
});

const leaveSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(200).nullable().optional().transform((v) => v ?? null),
});

const holidaySchema = z.object({ date: dateText, name: z.string().trim().min(1).max(120) });

const typeSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(80),
  durationMinutes: z.number().int().min(5).max(240),
  bufferMinutes: z.number().int().min(0).max(60).default(0),
  defaultFeeMinor: z.number().int().min(0).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('PKR'),
  active: z.boolean().default(true),
});

const slotsQuery = z.object({
  facility: z.string().uuid(),
  practitioner: z.string().uuid(),
  type: z.string().uuid(),
  date: dateText,
});

@Controller('orgs/:slug')
export class ScheduleController {
  constructor(@Inject(ScheduleService) private readonly schedule: ScheduleService) {}

  @Permission('schedule.read')
  @Get('practitioners')
  practitioners(@Ctx() ctx: ReqCtx) {
    return this.schedule.list(ctx);
  }

  @Permission('schedule.manage')
  @Post('practitioners')
  createPractitioner(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.schedule.create(ctx, parse(practitionerSchema, body));
  }

  @Permission('schedule.manage')
  @Put('practitioners/:id')
  async updatePractitioner(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    await this.schedule.update(ctx, parseId(id), parse(practitionerSchema, body));
    return { ok: true };
  }

  @Permission('schedule.read')
  @Get('practitioners/:id/hours')
  hours(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Query('facility') facility: string) {
    return this.schedule.hours(ctx, parseId(id), parseId(facility));
  }

  @Permission('schedule.manage')
  @Put('practitioners/:id/hours/:facilityId')
  async setHours(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Param('facilityId') facilityId: string, @Body() body: unknown) {
    await this.schedule.setHours(ctx, parseId(id), parseId(facilityId), parse(hoursSchema, body).ranges);
    return { ok: true };
  }

  @Permission('schedule.manage')
  @Post('practitioners/:id/leave')
  addLeave(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(leaveSchema, body);
    return this.schedule.addLeave(ctx, parseId(id), input.startsAt, input.endsAt, input.reason);
  }

  @Permission('schedule.manage')
  @Delete('leave/:id')
  async deleteLeave(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    await this.schedule.deleteLeave(ctx, parseId(id));
    return { ok: true };
  }

  @Permission('schedule.manage')
  @Post('facilities/:id/holidays')
  addHoliday(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(holidaySchema, body);
    return this.schedule.addHoliday(ctx, parseId(id), input.date, input.name);
  }

  @Permission('schedule.read')
  @Get('appointment-types')
  types(@Ctx() ctx: ReqCtx) {
    return this.schedule.listTypes(ctx);
  }

  @Permission('schedule.manage')
  @Post('appointment-types')
  @HttpCode(201)
  createType(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.schedule.createType(ctx, parse(typeSchema, body));
  }

  @Permission('appointments.read')
  @Get('slots')
  slots(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    const input = parse(slotsQuery, query);
    return this.schedule.slots(ctx, input.facility, input.practitioner, input.type, input.date);
  }
}
