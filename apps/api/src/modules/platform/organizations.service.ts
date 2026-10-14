import { Inject, Injectable } from '@nestjs/common';
import { AuditService, actorOf } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import { platformDb } from '../identity/access.guard';
import { maskIdentifier } from '../identity/identity-helpers';
import { ROLE_TEMPLATES } from '../identity/permissions';
import { setupChecks, type SetupCheck } from '../organizations/setup-checks';
import { InvitationsService, type ShareLink } from '../staff/invitations.service';

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  facilityCount: number;
  activeStaffCount: number;
  lastActivityAt: string | null;
  modules: string[];
  createdAt: string;
}

export interface OrganizationDetail extends OrganizationSummary {
  currency: string;
  defaultLanguage: string;
  timezone: string;
  dateFormat: string;
  statusReason: string | null;
  facilities: Array<{ id: string; name: string; active: boolean }>;
  admins: Array<{ membershipId: string; name: string; identifier: string; status: string }>;
  pendingInvitations: number;
  setupChecks: SetupCheck[];
  history: Array<{ at: string; action: string; actor: string; reason: string | null }>;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  currency: string;
  defaultLanguage: 'en' | 'ur';
  timezone: string;
  dateFormat: string;
  facility: { name: string; address?: string | undefined; city?: string | undefined; phone?: string | undefined; timezone?: string | undefined };
}

interface SummaryRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  facility_count: number;
  active_staff_count: number;
  last_activity_at: Date | null;
  modules: string[];
  created_at: Date;
}

const SUMMARY_SQL = `
  select o.id, o.slug, o.name, o.status, o.modules, o.created_at,
    (select count(*)::int from facilities f where f.organization_id = o.id and f.active) as facility_count,
    (select count(*)::int from memberships m where m.organization_id = o.id and m.status = 'active') as active_staff_count,
    (select max(p.last_login_at) from memberships m join persons p on p.id = m.person_id where m.organization_id = o.id) as last_activity_at
  from organizations o`;

function toSummary(row: SummaryRow): OrganizationSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    facilityCount: row.facility_count,
    activeStaffCount: row.active_staff_count,
    lastActivityAt: row.last_activity_at?.toISOString() ?? null,
    modules: row.modules,
    createdAt: row.created_at.toISOString(),
  };
}

/** The Super Admin's view of organizations. No patient, clinical or financial data is read here. */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  list(ctx: ReqCtx, filter: { status?: string | undefined; q?: string | undefined }): Promise<OrganizationSummary[]> {
    return this.db.withContext(platformDb(ctx), async (tx) => {
      const rows = await tx.many<SummaryRow>(
        `${SUMMARY_SQL}
         where ($1::org_status is null or o.status = $1::org_status)
           and ($2::text is null or o.name ilike '%' || $2 || '%' or o.slug ilike '%' || $2 || '%')
         order by o.created_at desc limit 500`,
        [filter.status ?? null, filter.q ?? null],
      );
      return rows.map(toSummary);
    });
  }

  async detail(ctx: ReqCtx, id: string): Promise<OrganizationDetail> {
    return this.db.withContext(platformDb(ctx), async (tx) => {
      const row = await tx.maybeOne<
        SummaryRow & { currency: string; default_language: string; timezone: string; date_format: string; status_reason: string | null }
      >(`${SUMMARY_SQL.replace('select o.id,', 'select o.currency, o.default_language, o.timezone, o.date_format, o.status_reason, o.id,')} where o.id = $1`, [id]);
      if (row === null) throw notFound('Organization');
      const facilities = await tx.many<{ id: string; name: string; active: boolean }>(
        'select id, name, active from facilities where organization_id = $1 order by name',
        [id],
      );
      const admins = await tx.many<{ membership_id: string; name: string; phone: string | null; email: string | null; status: string }>(
        `select m.id as membership_id, p.display_name as name, p.phone, p.email, m.status
         from memberships m join persons p on p.id = m.person_id
         where m.organization_id = $1 and exists (
           select 1 from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id and r.key = 'tenant_admin')
         order by p.display_name`,
        [id],
      );
      const pending = await tx.one<{ n: number }>(
        `select count(*)::int as n from invitations where organization_id = $1 and status = 'pending' and expires_at > now()`,
        [id],
      );
      const history = await tx.many<{ occurred_at: Date; action: string; actor_label: string; details: { reason?: string } }>(
        `select occurred_at, action, actor_label, details from platform_audit_events
         where organization_id = $1 and action like 'organization.%' order by occurred_at desc limit 50`,
        [id],
      );
      return {
        ...toSummary(row),
        currency: row.currency,
        defaultLanguage: row.default_language,
        timezone: row.timezone,
        dateFormat: row.date_format,
        statusReason: row.status_reason,
        facilities,
        admins: admins.map((a) => ({ membershipId: a.membership_id, name: a.name, identifier: maskIdentifier(a.phone, a.email), status: a.status })),
        pendingInvitations: pending.n,
        setupChecks: await setupChecks(tx, id),
        history: history.map((h) => ({ at: h.occurred_at.toISOString(), action: h.action, actor: h.actor_label, reason: h.details.reason ?? null })),
      };
    });
  }

  async create(ctx: ReqCtx, input: CreateOrganizationInput): Promise<OrganizationDetail> {
    const id = await this.db.withContext(platformDb(ctx), async (tx) => {
      const taken = await tx.maybeOne('select 1 from organizations where slug = $1', [input.slug]);
      if (taken !== null) throw new AppError(409, 'slug_taken', 'This web address is already used by another organization.');
      const roles = ROLE_TEMPLATES.map((role) => ({
        key: role.key,
        name: role.name,
        permissions: role.permissions,
        requiresModule: role.requiresModule,
      }));
      const created = await tx.one<{ id: string }>('select platform_create_organization($1, $2, $3, $4, $5, $6, $7, $8) as id', [
        input.name,
        input.slug,
        input.currency,
        input.defaultLanguage,
        input.timezone,
        input.dateFormat,
        JSON.stringify(input.facility),
        JSON.stringify(roles),
      ]);
      await this.audit.platform(tx, actorOf(ctx), 'organization.created', {
        orgId: created.id,
        target: { type: 'organization', id: created.id },
        requestId: ctx.requestId,
        details: { slug: input.slug },
      });
      return created.id;
    });
    return this.detail(ctx, id);
  }

  /** Invites an administrator (Clinic / Hospital Admin role, all facilities). */
  async inviteAdmin(ctx: ReqCtx, orgId: string, input: { inviteeName: string; phone: string | null; email: string | null }): Promise<ShareLink> {
    return this.db.withContext(platformDb(ctx), async (tx) => {
      const org = await tx.maybeOne<{ name: string; status: string }>('select name, status from organizations where id = $1', [orgId]);
      if (org === null) throw notFound('Organization');
      if (org.status !== 'setup_required' && org.status !== 'active') {
        throw new AppError(409, 'organization_not_operating', 'Reactivate the organization before inviting people.');
      }
      const role = await tx.one<{ id: string }>(`select id from roles where organization_id = $1 and key = 'tenant_admin'`, [orgId]);
      const created = await this.invitations.create(
        tx,
        orgId,
        org.name,
        { inviteeName: input.inviteeName, phone: input.phone, email: input.email, roleIds: [role.id], facilityScope: 'all', facilityIds: [] },
        ctx.person.id,
      );
      await this.audit.platform(tx, actorOf(ctx), 'organization.admin_invited', {
        orgId,
        target: { type: 'invitation', id: created.id },
        requestId: ctx.requestId,
      });
      return created.share;
    });
  }
}
