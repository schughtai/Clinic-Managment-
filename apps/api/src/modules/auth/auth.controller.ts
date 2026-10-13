import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, Roles } from '../../common/access';
import { normalizePhone } from '../../common/phone';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { nameSchema, passwordSchema, phoneSchema } from '../../common/schemas';
import { StrictRate } from '../../common/throttling';
import { parse } from '../../common/validate';
import { AuthService, type Profile, type SessionGrant } from './auth.service';
import { SessionService } from './session.service';

const loginSchema = z.object({
  phone: z.string().max(40),
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  signupCode: z.string().min(1).max(100),
  clinicName: nameSchema,
  ownerName: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Public()
  @StrictRate()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    const input = parse(loginSchema, body);
    const grant = await this.auth.login(normalizePhone(input.phone), input.password);
    await this.startSession(response, grant);
    return { ok: true };
  }

  @Public()
  @StrictRate()
  @Post('register-clinic')
  async registerClinic(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    const grant = await this.auth.registerClinic(parse(registerSchema, body));
    await this.startSession(response, grant);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response): { ok: true } {
    this.sessions.clear(response);
    return { ok: true };
  }

  @Roles('owner', 'doctor', 'receptionist')
  @Get('me')
  me(@Ctx() ctx: ReqCtx): Promise<Profile> {
    return this.auth.profile(ctx);
  }

  @Roles('owner', 'doctor', 'receptionist')
  @StrictRate()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Ctx() ctx: ReqCtx,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    const input = parse(changePasswordSchema, body);
    const grant = await this.auth.changePassword(ctx, input.currentPassword, input.newPassword);
    await this.startSession(response, grant);
    return { ok: true };
  }

  private startSession(response: Response, grant: SessionGrant): Promise<void> {
    return this.sessions.issue(response, { sub: grant.userId, cid: grant.clinicId, tv: grant.tokenVersion });
  }
}
