import type { Tx } from '../../db/tx';

export type SetupCheckKey = 'profile' | 'facility' | 'admin';

export interface SetupCheck {
  key: SetupCheckKey;
  ok: boolean;
  /** Where the missing item is fixed, relative to the organization workspace. */
  link: string;
}

interface CheckRow {
  profile: boolean;
  facility: boolean;
  admin: boolean;
}

/**
 * What must be true before an organization can be activated (FR-006): profile with name, phone and
 * address; one active facility with address, a timezone and opening hours; one active administrator.
 * Runs in an organization or platform context.
 */
export async function setupChecks(tx: Tx, orgId: string): Promise<SetupCheck[]> {
  const row = await tx.one<CheckRow>(
    `select
       (o.name is not null and o.phone is not null and o.address is not null and btrim(o.address) <> '') as profile,
       exists (
         select 1 from facilities f
         where f.organization_id = o.id and f.active and f.address is not null and btrim(f.address) <> ''
           and coalesce(f.timezone, o.timezone) is not null and jsonb_array_length(f.opening_hours) > 0
       ) as facility,
       exists (
         select 1 from memberships m
         join membership_roles mr on mr.membership_id = m.id
         join roles r on r.id = mr.role_id
         where m.organization_id = o.id and m.status = 'active' and r.key = 'tenant_admin'
       ) as admin
     from organizations o where o.id = $1`,
    [orgId],
  );
  return [
    { key: 'profile', ok: row.profile, link: 'settings' },
    { key: 'facility', ok: row.facility, link: 'settings/facilities' },
    { key: 'admin', ok: row.admin, link: 'settings/staff' },
  ];
}
