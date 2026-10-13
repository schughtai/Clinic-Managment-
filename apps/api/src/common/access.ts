import { SetMetadata } from '@nestjs/common';
import type { Role } from './request-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOWED_ROLES = 'allowedRoles';

/** Marks a route that needs no sign-in. Everything else is private by default. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Lists the roles allowed on a route. A private route without this decorator is refused. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ALLOWED_ROLES, roles);
