import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SessionOnly } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { StrictRate } from '../../common/throttling';
import { parse } from '../../common/validate';
import { AuthService, type MeResult, type StepResult } from './auth.service';
import { languageSchema, newPasswordSchema } from './identity-helpers';

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Required.').max(254),
  password: z.string().min(1, 'Required.').max(200),
});

const codeSchema = z.object({ code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code.') });

const verifySchema = z
  .object({
    code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code.').optional(),
    recoveryCode: z.string().trim().min(8).max(20).optional(),
  })
  .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined), 'Enter a code or a recovery code.');

const contextSchema = z.object({
  orgSlug: z.string().max(40).nullable(),
  facilityId: z.string().uuid().nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @StrictRate()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<StepResult> {
    const input = parse(loginSchema, body);
    return this.auth.login(input.identifier, input.password, request, response);
  }

  @SessionOnly({ allowPasswordLevel: true })
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    await this.auth.logout(request, response);
    return { ok: true };
  }

  @SessionOnly({ allowPasswordLevel: true })
  @Get('me')
  me(@Ctx() ctx: ReqCtx, @Req() request: Request): Promise<MeResult> {
    return this.auth.me(ctx, request);
  }

  @SessionOnly({ allowPasswordLevel: true })
  @StrictRate()
  @Post('mfa/enroll/start')
  @HttpCode(200)
  enrollStart(@Ctx() ctx: ReqCtx): Promise<{ otpauthUri: string; secretBase32: string }> {
    return this.auth.enrollStart(ctx);
  }

  @SessionOnly({ allowPasswordLevel: true })
  @StrictRate()
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  enrollConfirm(@Ctx() ctx: ReqCtx, @Body() body: unknown, @Req() request: Request): Promise<StepResult & { recoveryCodes: string[] }> {
    return this.auth.enrollConfirm(ctx, parse(codeSchema, body).code, request);
  }

  @SessionOnly({ allowPasswordLevel: true })
  @StrictRate()
  @Post('mfa/verify')
  @HttpCode(200)
  verify(@Ctx() ctx: ReqCtx, @Body() body: unknown, @Req() request: Request): Promise<StepResult> {
    return this.auth.verify(ctx, parse(verifySchema, body), request);
  }

  @SessionOnly()
  @Post('context')
  @HttpCode(200)
  async context(@Ctx() ctx: ReqCtx, @Body() body: unknown, @Req() request: Request): Promise<MeResult> {
    const input = parse(contextSchema, body);
    await this.auth.setContext(ctx, input.orgSlug, input.facilityId ?? null);
    return this.auth.me(ctx, request);
  }

  @SessionOnly()
  @StrictRate()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Ctx() ctx: ReqCtx, @Body() body: unknown, @Req() request: Request): Promise<{ ok: true }> {
    const input = parse(changePasswordSchema, body);
    await this.auth.changePassword(ctx, input.currentPassword, input.newPassword, request);
    return { ok: true };
  }

  @SessionOnly()
  @Put('language')
  async language(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<{ ok: true }> {
    await this.auth.setLanguage(ctx, parse(z.object({ language: languageSchema }), body).language);
    return { ok: true };
  }
}
