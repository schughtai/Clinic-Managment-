import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Logger } from 'pino';
import { ACCESS, type AccessRule } from '../../common/access';
import { AppError, forbidden, mfaRequired, notFound, organizationSuspended, unauthorized } from '../../common/errors';
import type { AuthLevel, ReqCtx } from '../../common/request-context';
import { LOGGER } from '../../common/tokens';
import { DbService } from '../../db/db.service';
import { isModule, isPermission, type ModuleCode, type PermissionCode } from './permissions';
import { SessionService } from './session.service';
import { hashToken } from './tokens';

interface ContextRow {
  session_id: string;
  person_id: string;
  display_name: string;
  auth_level: AuthLevel;
  mfa_enabled: boolean;
  is_platform_admin: boolean;
  org_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  org_status: string | null;
  org_modules: string[] | null;
  membership_id: string | null;
  facility_scope: 'all' | 'selected' | null;
  facility_ids: string[] | null;
  permissions: string[] | null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const OPERATING = new Set(['setup_required', 'active']);

/**
 * Runs on every request and fails closed: a route must declare an access rule, and every check is
 * made on the server with one database round trip (`request_context`).
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
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<Request>();
    if (rule === undefined) {
      this.logger.error({ path: request.path }, 'route has no access rule');
      throw forbidden();
    }

    const slugParam = (request.params as Record<string, string | undefined>).slug;
    const slug = rule.kind === 'permission' ? slugParam : undefined;
    const token = this.sessions.tokenOf(request);
    const row =
      token === undefined
        ? null
        : await this.db.withoutContext((tx) =>
            tx.maybeOne<ContextRow>('select * from request_context($1, $2)', [hashToken(token), slug !== undefined && SLUG.test(slug) ? slug : null]),
          );

    if (rule.kind === 'public') {
      // Public routes still learn who is signed in, for example to accept an invitation as oneself.
      if (row !== null) request.ctx = this.toCtx(row, request, false);
      return true;
    }
    if (row === null) throw unauthorized();

    const complete = row.auth_level === 'mfa' || (!row.mfa_enabled && !row.is_platform_admin);
    if (rule.kind === 'session') {
      if (!complete && !rule.allowPasswordLevel) throw mfaRequired();
      request.ctx = this.toCtx(row, request, false);
      return true;
    }
    if (!complete) throw mfaRequired();

    if (rule.kind === 'platform') {
      if (!row.is_platform_admin || row.auth_level !== 'mfa') throw forbidden();
      request.ctx = this.toCtx(row, request, false);
      return true;
    }

    // Organization route: the slug must belong to one of the caller's active memberships. A
    // non-member gets the same answer as for an organization that does not exist.
    if (row.org_id === null || row.membership_id === null) throw notFound('Organization');
    if (row.org_status === null || !OPERATING.has(row.org_status)) throw organizationSuspended();
    const ctx = this.toCtx(row, request, true);
    if (!ctx.org?.permissions.has(rule.code)) throw forbidden();
    request.ctx = ctx;
    return true;
  }

  private toCtx(row: ContextRow, request: Request, withOrg: boolean): ReqCtx {
    const org =
      withOrg && row.org_id !== null && row.membership_id !== null
        ? {
            id: row.org_id,
            slug: row.org_slug ?? '',
            name: row.org_name ?? '',
            status: row.org_status ?? '',
            modules: (row.org_modules ?? []).filter(isModule) as ModuleCode[],
            membershipId: row.membership_id,
            facilityIds: row.facility_scope === 'all' ? ('*' as const) : (row.facility_ids ?? []),
            permissions: new Set((row.permissions ?? []).filter(isPermission) as PermissionCode[]),
          }
        : undefined;
    return {
      person: { id: row.person_id, displayName: row.display_name },
      sessionId: row.session_id,
      authLevel: row.auth_level,
      isPlatformAdmin: row.is_platform_admin,
      org,
      requestId: request.requestId,
    };
  }
}

/** Database context for an organization route: organization, granted facilities and person. */
export function orgDb(ctx: ReqCtx): { orgId: string; facilityIds: readonly string[] | '*'; personId: string } {
  if (ctx.org === undefined) throw new AppError(500, 'internal_error', 'Organization context missing.');
  return { orgId: ctx.org.id, facilityIds: ctx.org.facilityIds, personId: ctx.person.id };
}

/** Database context for a platform route. */
export function platformDb(ctx: ReqCtx): { platform: true; personId: string } {
  return { platform: true, personId: ctx.person.id };
}
