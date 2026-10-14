import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { CLINICAL_PERMISSIONS } from '../identity/permissions';

export const CLINICAL = 'clinical';

/**
 * Marks a route that creates or reads clinical content. The route is refused unless the organization
 * has the clinical module switched on and the caller holds a clinical permission (constitution III).
 * Clinical routes arrive with Phase 1B; the gate is built and tested now.
 */
export const Clinical = (): MethodDecorator & ClassDecorator => SetMetadata(CLINICAL, true);

@Injectable()
export class ClinicalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(CLINICAL, [context.getHandler(), context.getClass()]);
    if (required !== true) return true;
    const request = context.switchToHttp().getRequest<{ ctx?: ReqCtx }>();
    const org = request.ctx?.org;
    if (org === undefined || !org.modules.includes('clinical')) {
      throw forbidden('Clinical features are switched off for this organization.');
    }
    if (!CLINICAL_PERMISSIONS.some((code) => org.permissions.has(code))) {
      throw forbidden('You do not have clinical permission.');
    }
    return true;
  }
}
