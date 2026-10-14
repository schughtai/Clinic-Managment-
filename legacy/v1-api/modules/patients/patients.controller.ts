import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import type { PatientListItem, PatientRecord } from './patients.repository';
import {
  PatientsService,
  createPatientSchema,
  searchPatientsSchema,
  updatePatientSchema,
} from './patients.service';

@Roles('owner', 'doctor', 'receptionist')
@Controller('patients')
export class PatientsController {
  constructor(@Inject(PatientsService) private readonly patients: PatientsService) {}

  @Post()
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<PatientRecord> {
    return this.patients.create(ctx, parse(createPatientSchema, body));
  }

  @Get()
  search(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<{ items: PatientListItem[]; total: number }> {
    return this.patients.search(ctx, parse(searchPatientsSchema, query));
  }

  @Get(':id')
  get(@Ctx() ctx: ReqCtx, @Param('id') id: string): Promise<PatientRecord> {
    return this.patients.get(ctx, parseId(id));
  }

  @Patch(':id')
  update(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<PatientRecord> {
    return this.patients.update(ctx, parseId(id), parse(updatePatientSchema, body));
  }
}
