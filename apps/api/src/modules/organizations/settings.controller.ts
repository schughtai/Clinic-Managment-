import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { phoneSchema } from '../../common/schemas';
import { parse, parseId } from '../../common/validate';
import { currencySchema, dateFormatSchema, emailSchema, languageSchema, timezoneSchema } from '../identity/identity-helpers';
import { type OpeningRange, SettingsService } from './settings.service';

/** Empty text clears a value. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const nullablePhone = z
  .union([z.literal(''), z.null(), phoneSchema])
  .optional()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const nullableEmail = z
  .union([z.literal(''), z.null(), emailSchema])
  .optional()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(120),
  legalName: optionalText(200),
  phone: nullablePhone,
  email: nullableEmail,
  address: optionalText(300),
  currency: currencySchema,
  defaultLanguage: languageSchema,
  timezone: timezoneSchema,
  dateFormat: dateFormatSchema,
});

const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM, for example 09:00.');

const toMinutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Weekly hours: day 0 (Sunday) to 6, closes after opens, no overlapping ranges on a day. */
export const openingHoursSchema = z
  .array(z.object({ day: z.number().int().min(0).max(6), opens: time, closes: time }))
  .max(28)
  .superRefine((ranges: OpeningRange[], context) => {
    ranges.forEach((range, index) => {
      if (toMinutes(range.closes) <= toMinutes(range.opens)) {
        context.addIssue({ code: 'custom', path: [index, 'closes'], message: 'Closing time must be after opening time.' });
      }
    });
    for (let day = 0; day <= 6; day += 1) {
      const sameDay = ranges.filter((range) => range.day === day).sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens));
      for (let index = 1; index < sameDay.length; index += 1) {
        if (toMinutes(sameDay[index]!.opens) < toMinutes(sameDay[index - 1]!.closes)) {
          context.addIssue({ code: 'custom', path: [], message: 'Opening hours on the same day must not overlap.' });
          return;
        }
      }
    }
  });

const facilitySchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(120),
  address: optionalText(300),
  city: optionalText(80),
  phone: nullablePhone,
  timezone: z
    .union([z.literal(''), z.null(), timezoneSchema])
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
  openingHours: openingHoursSchema.default([]),
  active: z.boolean().default(true),
});

@Controller('orgs/:slug')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Permission('organization.read')
  @Get('settings')
  get(@Ctx() ctx: ReqCtx) {
    return this.settings.get(ctx);
  }

  @Permission('organization.update')
  @Put('settings')
  update(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.settings.update(ctx, parse(settingsSchema, body));
  }

  @Permission('organization.update')
  @Post('activate')
  @HttpCode(200)
  activate(@Ctx() ctx: ReqCtx) {
    return this.settings.activate(ctx);
  }

  @Permission('facility.read')
  @Get('facilities')
  facilities(@Ctx() ctx: ReqCtx) {
    return this.settings.listFacilities(ctx);
  }

  @Permission('facility.manage')
  @Post('facilities')
  createFacility(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.settings.createFacility(ctx, parse(facilitySchema, body));
  }

  @Permission('facility.manage')
  @Put('facilities/:id')
  updateFacility(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.settings.updateFacility(ctx, parseId(id), parse(facilitySchema, body));
  }
}
