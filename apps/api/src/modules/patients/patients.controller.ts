import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { optionalText, parse, parseId, dateSchema } from '../../common/validate';
import { phoneSchema } from '../../common/schemas';
import { HistoryService } from './history.service';
import { addEntrySchema, assessmentSchema } from './history.schemas';
import { PHONE_LABELS, PatientsService, SEXES } from './patients.service';

/** A blank optional phone from a form means "not given". */
const optionalPhone = z
  .union([z.literal(''), phoneSchema])
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value));

const phoneEntry = z.object({
  phone: phoneSchema,
  label: z.enum(PHONE_LABELS).default('mobile'),
});

const createSchema = z
  .object({
    nameEn: optionalText(120),
    nameUr: optionalText(120),
    sex: z.enum(SEXES).default('unknown'),
    dateOfBirth: dateSchema.optional(),
    approximateAge: z.number().int().min(0).max(130).optional(),
    address: optionalText(300),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalPhone,
    phones: z.array(phoneEntry).max(5).default([]),
    confirmDuplicates: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.nameEn || value.nameUr), {
    message: 'Enter the name in English or Urdu.',
    path: ['nameEn'],
  })
  .refine((value) => !(value.dateOfBirth !== undefined && value.approximateAge !== undefined), {
    message: 'Enter either a date of birth or an approximate age, not both.',
    path: ['dateOfBirth'],
  });

const updateSchema = z
  .object({
    nameEn: optionalText(120),
    nameUr: optionalText(120),
    sex: z.enum(SEXES).optional(),
    dateOfBirth: dateSchema.optional(),
    approximateAge: z.number().int().min(0).max(130).optional(),
    address: optionalText(300),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalPhone,
  })
  .refine((value) => !(value.dateOfBirth !== undefined && value.approximateAge !== undefined), {
    message: 'Enter either a date of birth or an approximate age, not both.',
    path: ['dateOfBirth'],
  });

const phoneAddSchema = phoneEntry;
const searchSchema = z.object({ q: z.string().max(120).optional().default('') });

@Controller('orgs/:slug/patients')
export class PatientsController {
  constructor(
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  @Permission('patients.read')
  @Get()
  search(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    return this.patients.search(ctx, parse(searchSchema, query).q);
  }

  @Permission('patients.create')
  @Post()
  @HttpCode(201)
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.patients.create(ctx, parse(createSchema, body));
  }

  @Permission('patients.read')
  @Get(':id')
  get(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    return this.patients.get(ctx, parseId(id));
  }

  @Permission('patients.update')
  @Patch(':id')
  update(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.patients.update(ctx, parseId(id), parse(updateSchema, body));
  }

  @Permission('patients.update')
  @Post(':id/phones')
  @HttpCode(201)
  addPhone(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(phoneAddSchema, body);
    return this.patients.addPhone(ctx, parseId(id), input.phone, input.label);
  }

  @Permission('history.read_summary')
  @Get(':id/history')
  listHistory(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    return this.history.list(ctx, parseId(id));
  }

  @Permission('history.write')
  @Post(':id/history')
  @HttpCode(201)
  addHistory(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(addEntrySchema, body);
    return this.history.add(ctx, parseId(id), input);
  }

  @Permission('history.write')
  @Post(':id/assessments')
  @HttpCode(201)
  assess(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(assessmentSchema, body);
    return this.history.assess(ctx, parseId(id), input.section, input.state);
  }
}
