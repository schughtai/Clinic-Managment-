import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, lastAdmin, moduleDisabled, notFound, permissionEscalation } from '../../common/errors';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { maskIdentifier } from '../identity/identity-helpers';
import { SessionService } from '../identity/session.service';
import { hashToken, newToken } from '../identity/tokens';
import { InvitationsService, type ShareLink } from './invitations.service';

export const RESET_HOURS = 24;

export interface StaffMember {
  membershipId: string;
  personId: string;
  name: string;
  identifier: string;
  roles: Array<{ id: string; key: string; name: string }>;
  facilityScope: 'all' | 'selected';
  facilities: Array<{ id: string; name: string }>;
  status: 'active' | 'deactivated';
  lastLoginAt: string | null;
  isSelf: boolean;
}

export interface PendingInvitation {
  id: string;
  inviteeName: string;
  identifier: string;
  roles: string[];
  facilityScope: 'all' | 'selected';
  expiresAt: string;
  expired: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  requiresModule: string | null;
  assignable: boolean;
}

export interface AccessInput {
  roleIds: readonly string[];
  facilityScope: 'all' | 'selected';
  facilityIds: readonly string[];
}

interface RoleRow {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  requires_module: string | null;
}

/** Staff of one organization: invitations, roles, branch access, deactivation and resets. */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  async list(ctx: ReqCtx): Promise<{ members: StaffMember[]; invitations: PendingInvitation[] }> {
    return this.db.withContext({ ...orgDb(ctx), facilityIds: '*' }, async (tx) => {
      const members = await tx.many<{
        membership_id: string;
        person_id: string;
        name: string;
        phone: string | null;
        email: string | null;
        status: 'active' | 'deactivated';
        facility_scope: 'all' | 'selected';
        last_login_at: Date | null;
        roles: Array<{ id: string; key: string; name: string }>;
        facilities: Array<{ id: string; name: string }>;
      }>(
        `select m.id as membership_id, p.id as person_id, p.display_name as name, p.phone, p.email, m.status,
                m.facility_scope, p.last_login_at,
                coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name) order by r.name)
                          from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id), '[]') as roles,
                coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.name)
                          from membership_facilities mf join facilities f on f.id = mf.facility_id where mf.membership_id = m.id), '[]') as facilities
         from memberships m join persons p on p.id = m.person_id
         order by m.status, p.display_name`,
      );
      const pending = await tx.many<{
        id: string;
        invitee_name: string;
        invitee_phone: string | null;
        invitee_email: string | null;
        roles: string[];
        facility_scope: 'all' | 'selected';
        expires_at: Date;
      }>(
        `select i.id, i.invitee_name, i.invitee_phone, i.invitee_email, i.facility_scope, i.expires_at,
                array(select r.name from roles r where r.id = any (i.role_ids) order by r.name) as roles
         from invitations i where i.status = 'pending' order by i.created_at desc`,
      );
      return {
        members: members.map((m) => ({
          membershipId: m.membership_id,
          personId: m.person_id,
          name: m.name,
          identifier: maskIdentifier(m.phone, m.email),
          roles: m.roles,
          facilityScope: m.facility_scope,
          facilities: m.facilities,
          status: m.status,
          lastLoginAt: m.last_login_at?.toISOString() ?? null,
          isSelf: m.person_id === ctx.person.id,
        })),
        invitations: pending.map((i) => ({
          id: i.id,
          inviteeName: i.invitee_name,
          identifier: maskIdentifier(i.invitee_phone, i.invitee_email),
          roles: i.roles,
          facilityScope: i.facility_scope,
          expiresAt: i.expires_at.toISOString(),
          expired: i.expires_at <= new Date(),
        })),
      };
    });
  }

  async roles(ctx: ReqCtx): Promise<Role[]> {
    const org = orgOf(ctx);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const rows = await tx.many<RoleRow>('select id, key, name, permissions, requires_module from roles order by system desc, name');
      return rows.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        permissions: [...role.permissions].sort(),
        requiresModule: role.requires_module,
        assignable:
          (role.requires_module === null || org.modules.includes(role.requires_module as never)) &&
          role.permissions.every((code) => org.permissions.has(code as never)),
      }));
    });
  }

  async invite(ctx: ReqCtx, input: { inviteeName: string; phone: string | null; email: string | null } & AccessInput): Promise<ShareLink> {
    const org = orgOf(ctx);
    return this.db.withContext({ ...orgDb(ctx), facilityIds: '*' }, async (tx) => {
      await this.checkAccess(tx, ctx, input);
      const created = await this.invitations.create(tx, org.id, org.name, input, ctx.person.id);
      await this.audit.org(tx, ctx, 'staff.invited', { type: 'invitation', id: created.id }, { facilityScope: input.facilityScope, roleCount: input.roleIds.length });
      return created.share;
    });
  }

  async revokeInvitation(ctx: ReqCtx, id: string): Promise<void> {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      const updated = await tx.execute(`update invitations set status = 'revoked', revoked_at = now() where id = $1 and status = 'pending'`, [id]);
      if (updated === 0) throw notFound('Invitation');
      await this.audit.org(tx, ctx, 'staff.invitation_revoked', { type: 'invitation', id });
    });
  }

  /** Replaces the link: the old token stops working and a new 72-hour link is issued. */
  async reissueInvitation(ctx: ReqCtx, id: string): Promise<ShareLink> {
    const org = orgOf(ctx);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const token = newToken();
      const row = await tx.maybeOne<{ expires_at: Date; invitee_phone: string | null }>(
        `update invitations set token_hash = $1, expires_at = now() + make_interval(hours => 72)
         where id = $2 and status = 'pending' returning expires_at, invitee_phone`,
        [hashToken(token), id],
      );
      if (row === null) throw notFound('Invitation');
      await this.audit.org(tx, ctx, 'staff.invitation_reissued', { type: 'invitation', id });
      return this.invitations.share('invite', token, row.expires_at, row.invitee_phone, `You are invited to join ${org.name} on Clinic Management.`);
    });
  }

  async updateAccess(ctx: ReqCtx, membershipId: string, input: AccessInput): Promise<void> {
    const org = orgOf(ctx);
    await this.db.withContext({ ...orgDb(ctx), facilityIds: '*' }, async (tx) => {
      const membership = await tx.maybeOne<{ id: string; status: string }>('select id, status from memberships where id = $1 for update', [membershipId]);
      if (membership === null) throw notFound('Staff member');
      await this.checkAccess(tx, ctx, input);
      // Removing someone's existing roles is also limited to roles the caller could grant.
      const current = await tx.many<RoleRow>(
        'select r.id, r.key, r.name, r.permissions, r.requires_module from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = $1',
        [membershipId],
      );
      for (const role of current) {
        if (!input.roleIds.includes(role.id) && !role.permissions.every((code) => org.permissions.has(code as never))) {
          throw permissionEscalation();
        }
      }
      await tx.execute('delete from membership_roles where membership_id = $1', [membershipId]);
      for (const roleId of input.roleIds) {
        await tx.execute('insert into membership_roles (membership_id, role_id, organization_id) values ($1, $2, $3)', [membershipId, roleId, org.id]);
      }
      await tx.execute('update memberships set facility_scope = $1 where id = $2', [input.facilityScope, membershipId]);
      await tx.execute('delete from membership_facilities where membership_id = $1', [membershipId]);
      if (input.facilityScope === 'selected') {
        for (const facilityId of input.facilityIds) {
          await tx.execute('insert into membership_facilities (membership_id, facility_id, organization_id) values ($1, $2, $3)', [
            membershipId,
            facilityId,
            org.id,
          ]);
        }
      }
      await this.assertAdminRemains(tx);
      await this.audit.org(tx, ctx, 'staff.access_changed', { type: 'membership', id: membershipId }, {
        facilityScope: input.facilityScope,
        roleCount: input.roleIds.length,
      });
    });
  }

  async deactivate(ctx: ReqCtx, membershipId: string): Promise<void> {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      const membership = await tx.maybeOne<{ person_id: string; status: string }>(
        'select person_id, status from memberships where id = $1 for update',
        [membershipId],
      );
      if (membership === null) throw notFound('Staff member');
      if (membership.person_id === ctx.person.id) {
        throw new AppError(409, 'cannot_deactivate_self', 'You cannot deactivate your own account. Ask another administrator.');
      }
      if (membership.status === 'deactivated') return;
      await tx.execute(`update memberships set status = 'deactivated', deactivated_at = now(), deactivated_by = $1 where id = $2`, [
        ctx.person.id,
        membershipId,
      ]);
      await this.assertAdminRemains(tx);
      // The membership check already blocks the next request; this also signs out sessions working
      // in this organization. Sessions in the person's other organizations continue.
      await this.sessions.revokePerson(tx, membership.person_id, 'membership_deactivated', null, orgOf(ctx).id);
      await this.audit.org(tx, ctx, 'staff.deactivated', { type: 'membership', id: membershipId });
    });
  }

  async reactivate(ctx: ReqCtx, membershipId: string): Promise<void> {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      const updated = await tx.execute(
        `update memberships set status = 'active', deactivated_at = null, deactivated_by = null where id = $1 and status = 'deactivated'`,
        [membershipId],
      );
      if (updated === 0) throw notFound('Staff member');
      await this.audit.org(tx, ctx, 'staff.reactivated', { type: 'membership', id: membershipId });
    });
  }

  /** A single-use 24-hour link. Issuing it ends all of the person's sessions (FR-020). */
  async resetPassword(ctx: ReqCtx, membershipId: string): Promise<ShareLink> {
    const org = orgOf(ctx);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const member = await tx.maybeOne<{ person_id: string; phone: string | null }>(
        'select m.person_id, p.phone from memberships m join persons p on p.id = m.person_id where m.id = $1',
        [membershipId],
      );
      if (member === null) throw notFound('Staff member');
      return this.issueReset(tx, member.person_id, member.phone, ctx.person.id, `${org.name}: a password reset was requested for your account.`, async () =>
        this.audit.org(tx, ctx, 'staff.password_reset_issued', { type: 'membership', id: membershipId }),
      );
    });
  }

  /** Shared by organization admins and Super Admins (the database function checks who may). */
  async issueReset(tx: Tx, personId: string, phone: string | null, issuedBy: string, intro: string, audit: () => Promise<void>): Promise<ShareLink> {
    const token = newToken();
    const expiry = await tx.one<{ expires: Date }>('select reset_issue($1, $2, $3, $4) as expires', [personId, hashToken(token), RESET_HOURS, issuedBy]);
    await audit();
    return this.invitations.share('reset', token, expiry.expires, phone, intro);
  }

  // ------------------------------------------------------------ rules

  /**
   * FR-017: roles must belong to this organization, need their module switched on, and carry no
   * permission the caller lacks. Selected branches must be active branches of this organization.
   */
  private async checkAccess(tx: Tx, ctx: ReqCtx, input: AccessInput): Promise<void> {
    const org = orgOf(ctx);
    if (input.roleIds.length === 0) throw new AppError(400, 'validation_failed', 'Choose at least one role.');
    const roles = await tx.many<RoleRow>('select id, key, name, permissions, requires_module from roles where id = any ($1)', [input.roleIds]);
    if (roles.length !== new Set(input.roleIds).size) throw notFound('Role');
    for (const role of roles) {
      if (role.requires_module !== null && !org.modules.includes(role.requires_module as never)) throw moduleDisabled();
      if (!role.permissions.every((code) => org.permissions.has(code as never))) throw permissionEscalation();
    }
    if (input.facilityScope === 'selected') {
      if (input.facilityIds.length === 0) throw new AppError(400, 'validation_failed', 'Choose at least one branch.');
      const found = await tx.one<{ n: number }>('select count(*)::int as n from facilities where active and id = any ($1)', [input.facilityIds]);
      if (found.n !== new Set(input.facilityIds).size) throw notFound('Branch');
    }
  }

  private async assertAdminRemains(tx: Tx): Promise<void> {
    const admins = await tx.one<{ n: number }>(
      `select count(*)::int as n from memberships m
       where m.status = 'active' and exists (
         select 1 from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id and r.key = 'tenant_admin')`,
    );
    if (admins.n === 0) throw lastAdmin();
  }
}
