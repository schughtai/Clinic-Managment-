import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { dateSchema, parse, parseId } from '../../common/validate';
import {
  type Doctor,
  DoctorsService,
  type Leave,
  createDoctorSchema,
  leaveSchema,
  scheduleSchema,
  updateDoctorSchema,
} from './doctors.service';

@Controller('doctors')
export class DoctorsController {
  constructor(@Inject(DoctorsService) private readonly doctors: DoctorsService) {}

  @Roles('owner', 'doctor', 'receptionist')
  @Get()
  list(@Ctx() ctx: ReqCtx, @Query('includeInactive') includeInactive?: string): Promise<Doctor[]> {
    // Only the owner sees inactive doctors. Others always get the active list.
    return this.doctors.list(ctx, ctx.user.role === 'owner' && includeInactive === 'true');
  }

  @Roles('owner')
  @Post()
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<Doctor> {
    return this.doctors.create(ctx, parse(createDoctorSchema, body));
  }

  @Roles('owner')
  @Patch(':id')
  update(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<Doctor> {
    return this.doctors.update(ctx, parseId(id), parse(updateDoctorSchema, body));
  }

  @Roles('owner')
  @Put(':id/schedule')
  setSchedule(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<Doctor> {
    return this.doctors.setSchedule(ctx, parseId(id), parse(scheduleSchema, body).sessions);
  }

  @Roles('owner', 'doctor', 'receptionist')
  @Get(':id/leaves')
  listLeaves(@Ctx() ctx: ReqCtx, @Param('id') id: string): Promise<Leave[]> {
    return this.doctors.listLeaves(ctx, parseId(id));
  }

  @Roles('owner')
  @Post(':id/leaves')
  addLeave(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<Leave> {
    const input = parse(leaveSchema, body);
    return this.doctors.addLeave(ctx, parseId(id), input.date, input.note);
  }

  @Roles('owner')
  @Delete(':id/leaves/:date')
  @HttpCode(204)
  async removeLeave(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Param('date') date: string): Promise<void> {
    await this.doctors.removeLeave(ctx, parseId(id), parse(dateSchema, date));
  }
}
