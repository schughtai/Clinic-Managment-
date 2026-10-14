import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Platform } from '../../common/access';
import { badRequest } from '../../common/errors';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { phoneSchema } from '../../common/schemas';
import { parse, parseId } from '../../common/validate';
import { currencySchema, dateFormatSchema, emailSchema, languageSchema, timezoneSchema } from '../identity/identity-helpers';
import { OrganizationsService } from './organizations.service';

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

const createSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3–40 lower-case letters, digits and hyphens.')
    .refine((slug) => !['platform', 'app', 'api', 'login', 'invite', 'reset', 'choose', 'account'].includes(slug), 'This web address is reserved.'),
  currency: currencySchema.default('PKR'),
  defaultLanguage: languageSchema.default('en'),
  timezone: timezoneSchema.default('Asia/Karachi'),
  dateFormat: dateFormatSchema.default('dd/MM/yyyy'),
  facility: z.object({
    name: z.string().trim().min(1, 'Required.').max(120),
    address: optionalTrimmed(300),
    city: optionalTrimmed(80),
    phone: phoneSchema.optional(),
    timezone: timezoneSchema.optional(),
  }),
});

const listSchema = z.object({
  status: z.enum(['setup_required', 'active', 'suspended', 'deactivated']).optional(),
  q: z.string().trim().max(80).optional(),
});

export const inviteeSchema = z
  .object({
    inviteeName: z.string().trim().min(1, 'Required.').max(120),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => value.phone !== undefined || value.email !== undefined, { message: 'Enter a phone number or an email.', path: ['phone'] });

@Platform()
@Controller('platform')
export class PlatformController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  @Get('organizations')
  list(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    return this.organizations.list(ctx, parse(listSchema, query));
  }

  @Post('organizations')
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    return this.organizations.create(ctx, parse(createSchema, body));
  }

  @Get('organizations/:id')
  detail(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    return this.organizations.detail(ctx, parseId(id));
  }

  @Post('organizations/:id/invitations')
  invite(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(inviteeSchema, body);
    if (input.phone === undefined && input.email === undefined) throw badRequest('validation_failed', 'Enter a phone number or an email.');
    return this.organizations.inviteAdmin(ctx, parseId(id), { inviteeName: input.inviteeName, phone: input.phone ?? null, email: input.email ?? null });
  }
}
