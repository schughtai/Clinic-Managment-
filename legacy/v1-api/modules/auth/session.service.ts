import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { CONFIG, type AppConfig } from '../../config/config';

export const SESSION_COOKIE = 'clinic_session';

export interface SessionClaims {
  sub: string;
  cid: string;
  tv: number;
}

function isClaims(value: unknown): value is SessionClaims {
  if (typeof value !== 'object' || value === null) return false;
  const claims = value as Record<string, unknown>;
  return typeof claims.sub === 'string' && typeof claims.cid === 'string' && typeof claims.tv === 'number';
}

/** Signed session tokens held in an httpOnly cookie, so page scripts and web addresses never see them. */
@Injectable()
export class SessionService {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(response: Response, claims: SessionClaims): Promise<void> {
    const token = await this.jwt.signAsync({ ...claims });
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
      maxAge: this.config.sessionHours * 3_600_000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
    });
  }

  /** Returns the claims for a valid, unexpired token, or null for anything else. */
  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const payload: unknown = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
      return isClaims(payload) ? payload : null;
    } catch {
      return null;
    }
  }
}
