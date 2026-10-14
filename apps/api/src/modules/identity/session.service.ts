import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../../config/config';
import type { Tx } from '../../db/tx';
import type { AuthLevel } from '../../common/request-context';
import { hashToken, isTokenShaped, newToken } from './tokens';

export const SESSION_COOKIE = 'clinic_session';

/**
 * Server-side sessions. The cookie holds a random token; the database holds only its hash, so a
 * session can be ended at once by marking the row revoked.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** The raw token from the cookie, if it has the right shape. */
  tokenOf(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    return isTokenShaped(token) ? token : undefined;
  }

  async create(tx: Tx, response: Response, personId: string, level: AuthLevel, deviceLabel: string | null): Promise<string> {
    const token = newToken();
    const row = await tx.one<{ id: string }>('select session_create($1, $2, $3, $4, $5) as id', [
      hashToken(token),
      personId,
      level,
      this.config.sessionHours,
      deviceLabel,
    ]);
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
      maxAge: this.config.sessionHours * 3_600_000,
    });
    return row.id;
  }

  async setLevel(tx: Tx, sessionId: string, level: AuthLevel): Promise<void> {
    await tx.execute('select session_set_level($1, $2)', [sessionId, level]);
  }

  async setContext(tx: Tx, sessionId: string, orgId: string | null, facilityId: string | null): Promise<void> {
    await tx.execute('select session_set_context($1, $2, $3)', [sessionId, orgId, facilityId]);
  }

  async revokeToken(tx: Tx, token: string, reason: string): Promise<void> {
    await tx.execute('select session_revoke($1, $2)', [hashToken(token), reason]);
  }

  /** Ends a person's sessions (only those working in `orgId` when given), optionally keeping the caller's own. */
  async revokePerson(tx: Tx, personId: string, reason: string, keepSessionId: string | null = null, orgId: string | null = null): Promise<number> {
    const row = await tx.one<{ n: number }>('select session_revoke_person($1, $2, $3, $4) as n', [personId, reason, keepSessionId, orgId]);
    return row.n;
  }

  async revokeOrganization(tx: Tx, orgId: string, reason: string): Promise<number> {
    const row = await tx.one<{ n: number }>('select session_revoke_org($1, $2) as n', [orgId, reason]);
    return row.n;
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: this.config.cookieSecure, path: '/' });
  }
}

/** A short, non-identifying label for the device list, such as "Chrome on Windows". */
export function deviceLabel(userAgent: string | undefined): string | null {
  if (userAgent === undefined) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'device';
  return `${browser} on ${system}`;
}
