import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, notFound } from '../../common/errors';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { setupChecks } from './setup-checks';

export interface OpeningRange {
  day: number;
  opens: string;
  closes: string;
}

export interface OrganizationSettings {
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  defaultLanguage: 'en' | 'ur';
  timezone: string;
  dateFormat: string;
  status: string;
  modules: string[];
}

export interface Facility {
  id: string;
  name: string;
  kind: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  openingHours: OpeningRange[];
  active: boolean;
}

export type SettingsInput = Omit<OrganizationSettings, 'status' | 'modules'>;
export type FacilityInput = Omit<Facility, 'id' | 'kind'>;

interface FacilityRow {
  id: string;
  name: string;
  kind: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  opening_hours: OpeningRange[];
  active: boolean;
}

const toFacility = (row: FacilityRow): Facility => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  address: row.address,
  city: row.city,
  phone: row.phone,
  timezone: row.timezone,
  openingHours: row.opening_hours,
  active: row.active,
});

/** Organization profile, locale, facilities and activation, for the organization's own admins. */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get(ctx: ReqCtx): Promise<OrganizationSettings> {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const row = await tx.one<{
        name: string;
        legal_name: string | null;
        phone: string | null;
        email: string | null;
        address: string | null;
        currency: string;
        default_language: 'en' | 'ur';
        timezone: string;
        date_format: string;
        status: string;
        modules: string[];
      }>('select * from organizations where id = $1', [orgOf(ctx).id]);
      return {
        name: row.name,
        legalName: row.legal_name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        currency: row.currency,
        defaultLanguage: row.default_language,
        timezone: row.timezone,
        dateFormat: row.date_format,
        status: row.status,
        modules: row.modules,
      };
    });
  }

  async update(ctx: ReqCtx, input: SettingsInput): Promise<OrganizationSettings> {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      await tx.execute(
        `update organizations set name = $1, legal_name = $2, phone = $3, email = $4, address = $5, currency = $6,
           default_language = $7, timezone = $8, date_format = $9 where id = $10`,
        [
          input.name,
          input.legalName,
          input.phone,
          input.email,
          input.address,
          input.currency,
          input.defaultLanguage,
          input.timezone,
          input.dateFormat,
          orgOf(ctx).id,
        ],
      );
      await this.audit.org(tx, ctx, 'organization.settings_updated', { type: 'organization', id: orgOf(ctx).id });
    });
    return this.get(ctx);
  }

  async activate(ctx: ReqCtx): Promise<OrganizationSettings> {
    await this.db.withContext(orgDb(ctx), async (tx) => {
      const org = orgOf(ctx);
      if (org.status === 'active') return;
      const checks = await setupChecks(tx, org.id);
      const failing = checks.filter((check) => !check.ok).map((check) => check.key);
      if (failing.length > 0) {
        throw new AppError(409, 'setup_incomplete', 'Finish the setup checklist before activating.', failing);
      }
      await tx.execute(`update organizations set status = 'active' where id = $1`, [org.id]);
      await this.audit.org(tx, ctx, 'organization.activated', { type: 'organization', id: org.id });
    });
    return this.get(ctx);
  }

  // ------------------------------------------------------------ facilities

  listFacilities(ctx: ReqCtx): Promise<Facility[]> {
    return this.db.withContext(orgDb(ctx), async (tx) =>
      (await tx.many<FacilityRow>('select * from facilities order by active desc, name')).map(toFacility),
    );
  }

  async createFacility(ctx: ReqCtx, input: FacilityInput): Promise<Facility> {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertUniqueName(tx, input.name, null);
      const row = await tx.one<FacilityRow>(
        `insert into facilities (organization_id, name, address, city, phone, timezone, opening_hours, active)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [orgOf(ctx).id, input.name, input.address, input.city, input.phone, input.timezone, JSON.stringify(input.openingHours), input.active],
      );
      await this.audit.org(tx, ctx, 'facility.created', { type: 'facility', id: row.id, facilityId: row.id });
      return toFacility(row);
    });
  }

  async updateFacility(ctx: ReqCtx, id: string, input: FacilityInput): Promise<Facility> {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const existing = await tx.maybeOne<FacilityRow>('select * from facilities where id = $1 for update', [id]);
      if (existing === null) throw notFound('Branch');
      await this.assertUniqueName(tx, input.name, id);
      if (existing.active && !input.active) {
        const others = await tx.one<{ n: number }>('select count(*)::int as n from facilities where active and id <> $1', [id]);
        if (others.n === 0) throw new AppError(409, 'last_facility', 'The organization must keep at least one active branch.');
      }
      const row = await tx.one<FacilityRow>(
        `update facilities set name = $1, address = $2, city = $3, phone = $4, timezone = $5, opening_hours = $6, active = $7
         where id = $8 returning *`,
        [input.name, input.address, input.city, input.phone, input.timezone, JSON.stringify(input.openingHours), input.active, id],
      );
      await this.audit.org(tx, ctx, existing.active && !input.active ? 'facility.deactivated' : 'facility.updated', {
        type: 'facility',
        id,
        facilityId: id,
      });
      return toFacility(row);
    });
  }

  private async assertUniqueName(tx: Tx, name: string, exceptId: string | null): Promise<void> {
    // Friendly message for visible branches; the unique index still catches the rest.
    const clash = await tx.maybeOne(
      `select 1 from facilities where lower(name) = lower($1) and ($2::uuid is null or id <> $2)`,
      [name, exceptId],
    );
    if (clash !== null) throw new AppError(409, 'name_in_use', 'Another branch already has this name.');
  }
}
