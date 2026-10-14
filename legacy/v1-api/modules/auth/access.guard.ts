import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Logger } from 'pino';
import { ALLOWED_ROLES, IS_PUBLIC } from '../../common/access';
import { forbidden, unauthorized } from '../../common/errors';
import type { AuthUser, Role } from '../../common/request-context';
import { LOGGER } from '../../common/tokens';
import { DbService } from '../../db/db.service';
import { SESSION_COOKIE, SessionService } from './session.service';

interface SessionUserRow {
  id: string;
  clinicId: string;
  name: string;
  role: Role;
  active: boolean;
  tokenVersion: number;
}

/**
 * Runs on every request. A route is private unless it is marked public, and a private route must
 * name the roles allowed on it. Both the session and the role are checked on the server.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(DbService) private readonly db: DbService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') throw unauthorized();

    const claims = await this.sessions.verify(token);
    if (claims === null) throw unauthorized();

    const row = await this.db.withClinic(claims.cid, (tx) =>
      tx.maybeOne<SessionUserRow>(
        'select id, clinic_id as "clinicId", name, role, active, token_version as "tokenVersion" from users where id = $1',
        [claims.sub],
      ),
    );
    // A deactivated user or a changed password invalidates every older session at once.
    if (row === null || !row.active || row.tokenVersion !== claims.tv) throw unauthorized();

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ALLOWED_ROLES, targets);
    if (roles === undefined || roles.length === 0) {
      // A private route with no role list is a coding mistake. Refuse rather than allow everyone.
      this.logger.error({ path: request.path }, 'route has no role list');
      throw forbidden();
    }
    if (!roles.includes(row.role)) throw forbidden();

    const user: AuthUser = { id: row.id, clinicId: row.clinicId, name: row.name, role: row.role };
    request.user = user;
    return true;
  }
}
