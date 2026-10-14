import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../modules/identity/permissions';

export const ACCESS = 'access';

/**
 * How a route is protected. Every route must declare exactly one; the access guard refuses a
 * route without a declaration rather than letting everyone in.
 */
export type AccessRule =
  | { kind: 'public' }
  /** Any signed-in person, with or without an organization context. */
  | { kind: 'session'; allowPasswordLevel: boolean }
  /** A Super Admin whose session passed the authenticator check. */
  | { kind: 'platform' }
  /** A member of the organization named by the `:slug` route parameter, holding this permission. */
  | { kind: 'permission'; code: PermissionCode };

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(ACCESS, { kind: 'public' } satisfies AccessRule);

/**
 * Any signed-in person. By default the session must have completed every sign-in step; routes that
 * are part of the authenticator step itself pass `allowPasswordLevel`.
 */
export const SessionOnly = (options: { allowPasswordLevel?: boolean } = {}): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS, { kind: 'session', allowPasswordLevel: options.allowPasswordLevel ?? false } satisfies AccessRule);

export const Platform = (): MethodDecorator & ClassDecorator => SetMetadata(ACCESS, { kind: 'platform' } satisfies AccessRule);

export const Permission = (code: PermissionCode): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS, { kind: 'permission', code } satisfies AccessRule);
