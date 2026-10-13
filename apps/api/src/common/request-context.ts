import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from './errors';

export const ROLES = ['owner', 'doctor', 'receptionist'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  clinicId: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    requestId?: string;
  }
}

export interface ReqCtx {
  user: AuthUser;
  requestId: string | undefined;
}

/** The signed-in user and request id. The access guard has already checked the session and the role. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): ReqCtx => {
  const request = context.switchToHttp().getRequest<Request>();
  if (request.user === undefined) throw unauthorized();
  return { user: request.user, requestId: request.requestId };
});
