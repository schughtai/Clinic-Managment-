import { Inject, Injectable } from '@nestjs/common';
import { AuditService, actorOf } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import { platformDb } from '../identity/access.guard';
import { isModule } from '../identity/permissions';
import { SessionService } from '../identity/session.service';
import { setupChecks } from '../organizations/setup-checks';
import type { ShareLink } from '../staff/invitations.service';
import { StaffService } from '../staff/staff.service';

export type LifecycleAction = 'suspend' | 'reactivate' | 'deactivate' | 'activate';

const PAST: Record<LifecycleAction, string> = { suspend: 'suspended', reactivate: 'reactivated', deactivate: 'deactivated', activate: 'activated' };

/** Organization lifecycle and module switches (v2 §18.4, §20.6). Data is never deleted here. */
@Injectable()
export class LifecycleService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  async changeStatus(ctx: ReqCtx, orgId: string, action: LifecycleAction, reason: string | null): Promise<void> {
    await this.db.withContext(platformDb(ctx), async (tx) => {
      const org = await tx.maybeOne<{ status: string; suspended_from: string | null }>(
        'select status, suspended_from from organizations where id = $1 for update',
        [orgId],
      );
      if (org === null) throw notFound('Organization');
      if ((action === 'suspend' || action === 'deactivate') && (reason === null || reason.trim() === '')) {
        throw new AppError(400, 'reason_required', 'Give a reason for this change.');
      }
      let target: string;
      switch (action) {
        case 'suspend':
          target = 'suspended';
          break;
        case 'deactivate':
          if (org.status !== 'suspended') throw new AppError(409, 'invalid_transition', 'Suspend the organization before deactivating it.');
          target = 'deactivated';
          break;
        case 'reactivate':
          if (org.status !== 'suspended' || org.suspended_from === null) throw new AppError(409, 'invalid_transition', 'Only a suspended organization can be reactivated.');
          target = org.suspended_from;
          break;
        case 'activate': {
          if (org.status !== 'setup_required') throw new AppError(409, 'invalid_transition', 'Only an organization in setup can be activated.');
          const failing = (await setupChecks(tx, orgId)).filter((check) => !check.ok).map((check) => check.key);
          if (failing.length > 0) throw new AppError(409, 'setup_incomplete', 'The setup checklist is not complete.', failing);
          target = 'active';
          break;
        }
      }
      if (org.status === target) return;
      await tx.execute('update organizations set status = $1::org_status, status_reason = $2 where id = $3', [target, reason, orgId]);
      if (target === 'suspended' || target === 'deactivated') {
        await this.sessions.revokeOrganization(tx, orgId, `organization_${target}`);
      }
      await this.audit.platform(tx, actorOf(ctx), `organization.${PAST[action]}`, {
        orgId,
        target: { type: 'organization', id: orgId },
        requestId: ctx.requestId,
        details: { from: org.status, to: target, ...(reason !== null ? { reason: reason.slice(0, 200) } : {}) },
      });
    });
  }

  async setModules(ctx: ReqCtx, orgId: string, modules: readonly string[]): Promise<string[]> {
    const clean = [...new Set(modules)].filter(isModule).sort();
    if (clean.length !== new Set(modules).size) throw new AppError(400, 'unknown_module', 'One of these modules does not exist.');
    return this.db.withContext(platformDb(ctx), async (tx) => {
      const before = await tx.maybeOne<{ modules: string[] }>('select modules from organizations where id = $1 for update', [orgId]);
      if (before === null) throw notFound('Organization');
      await tx.execute('update organizations set modules = $1 where id = $2', [clean, orgId]);
      await this.audit.platform(tx, actorOf(ctx), 'organization.modules_changed', {
        orgId,
        target: { type: 'organization', id: orgId },
        requestId: ctx.requestId,
        details: { before: before.modules, after: clean },
      });
      return clean;
    });
  }

  /** A Super Admin can reset the password of an organization's administrator (FR-020). */
  async resetAdminPassword(ctx: ReqCtx, orgId: string, membershipId: string): Promise<ShareLink> {
    return this.db.withContext(platformDb(ctx), async (tx) => {
      const member = await tx.maybeOne<{ person_id: string; phone: string | null; org_name: string }>(
        `select m.person_id, p.phone, o.name as org_name from memberships m
         join persons p on p.id = m.person_id join organizations o on o.id = m.organization_id
         where m.id = $1 and m.organization_id = $2 and exists (
           select 1 from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id and r.key = 'tenant_admin')`,
        [membershipId, orgId],
      );
      if (member === null) throw notFound('Administrator');
      return this.staff.issueReset(tx, member.person_id, member.phone, ctx.person.id, `${member.org_name}: a password reset was requested for your account.`, () =>
        this.audit.platform(tx, actorOf(ctx), 'organization.admin_password_reset', {
          orgId,
          target: { type: 'membership', id: membershipId },
          requestId: ctx.requestId,
        }),
      );
    });
  }
}
