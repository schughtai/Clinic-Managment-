import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { z } from 'zod';
import { Public } from '../../common/access';
import { resetInvalid } from '../../common/errors';
import { StrictRate } from '../../common/throttling';
import { parse } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { newPasswordSchema } from '../identity/identity-helpers';
import { PasswordService } from '../identity/password.service';
import { hashToken, isTokenShaped } from '../identity/tokens';

const tokenSchema = z.object({ token: z.string().max(100) });
const completeSchema = tokenSchema.extend({ newPassword: newPasswordSchema });

/** The public side of password resets: the link holder sets a new password once. */
@Controller('password-resets')
export class ResetsController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  @Public()
  @StrictRate()
  @Post('lookup')
  @HttpCode(200)
  async lookup(@Body() body: unknown): Promise<{ displayName: string; expiresAt: string }> {
    const { token } = parse(tokenSchema, body);
    if (!isTokenShaped(token)) throw resetInvalid();
    const row = await this.db.withoutContext((tx) =>
      tx.maybeOne<{ display_name: string; expires_at: Date }>('select * from reset_lookup($1)', [hashToken(token)]),
    );
    if (row === null) throw resetInvalid();
    return { displayName: row.display_name, expiresAt: row.expires_at.toISOString() };
  }

  @Public()
  @StrictRate()
  @Post('complete')
  @HttpCode(200)
  async complete(@Body() body: unknown): Promise<{ ok: true }> {
    const input = parse(completeSchema, body);
    if (!isTokenShaped(input.token)) throw resetInvalid();
    const hash = await this.passwords.hash(input.newPassword);
    try {
      await this.db.withoutContext((tx) => tx.execute('select reset_complete($1, $2)', [hashToken(input.token), hash]));
    } catch (error) {
      if (error instanceof DatabaseError && error.message === 'reset_invalid') throw resetInvalid();
      throw error;
    }
    return { ok: true };
  }
}
