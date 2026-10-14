import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/access';
import { invitationInvalid } from '../../common/errors';
import { StrictRate } from '../../common/throttling';
import { parse } from '../../common/validate';
import { newPasswordSchema } from '../identity/identity-helpers';
import { isTokenShaped } from '../identity/tokens';
import { InvitationsService } from './invitations.service';

const tokenSchema = z.object({ token: z.string().max(100) });
const acceptSchema = tokenSchema.extend({
  password: newPasswordSchema.optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
});

/** The public side of invitations: anyone holding the link can look it up and accept it. */
@Controller('invitations')
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Public()
  @StrictRate()
  @Post('lookup')
  @HttpCode(200)
  lookup(@Body() body: unknown) {
    const { token } = parse(tokenSchema, body);
    if (!isTokenShaped(token)) throw invitationInvalid();
    return this.invitations.lookup(token);
  }

  @Public()
  @StrictRate()
  @Post('accept')
  @HttpCode(200)
  accept(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const input = parse(acceptSchema, body);
    if (!isTokenShaped(input.token)) throw invitationInvalid();
    return this.invitations.accept(input.token, { password: input.password, displayName: input.displayName }, request.ctx, request, response);
  }
}
