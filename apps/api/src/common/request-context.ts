import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ModuleCode, PermissionCode } from '../modules/identity/permissions';
import { unauthorized } from './errors';

export type AuthLevel = 'password' | 'mfa';

export interface OrgContext {
  id: string;
  slug: string;
  name: string;
  status: string;
  modules: readonly ModuleCode[];
  membershipId: string;
  /** Every facility of the organization, or only these ids. */
  facilityIds: readonly string[] | '*';
  permissions: ReadonlySet<PermissionCode>;
}

/** Everything the server knows about the caller. Built by the access guard on every request. */
export interface ReqCtx {
  person: { id: string; displayName: string };
  sessionId: string;
  authLevel: AuthLevel;
  isPlatformAdmin: boolean;
  /** Present on `/orgs/:slug/...` routes only. */
  org: OrgContext | undefined;
  requestId: string | undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: ReqCtx;
    requestId?: string;
  }
}

/** The caller's context. The access guard has already checked the session and the permission. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): ReqCtx => {
  const request = context.switchToHttp().getRequest<Request>();
  if (request.ctx === undefined) throw unauthorized();
  return request.ctx;
});

/** The organization context of an organization route. */
export function orgOf(ctx: ReqCtx): OrgContext {
  if (ctx.org === undefined) throw unauthorized();
  return ctx.org;
}
