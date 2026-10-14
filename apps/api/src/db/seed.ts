import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { seal } from '../modules/identity/crypto-box';
import { ROLE_TEMPLATES, type RoleKey } from '../modules/identity/permissions';
import { base32Decode } from '../modules/identity/totp';

/**
 * Synthetic demo data for development only (research.md R14). Never run against production.
 * Every account uses DEMO_PASSWORD. The Super Admin's authenticator secret is fixed so the
 * development console can print the current code.
 */
export const DEMO_PASSWORD = 'demo-password-123';
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const DEMO_ACCOUNTS = {
  superAdmin: { name: 'Platform Owner', email: 'owner@demo.test' },
  shifaAdmin: { name: 'Sana Malik', phone: '923001000001' },
  shifaReceptionist: { name: 'Bilal Ahmed', phone: '923001000002' },
  shifaFinance: { name: 'Hina Raza', phone: '923001000003' },
  cityAdmin: { name: 'Omar Farooq', phone: '923001000004' },
} as const;

const HOURS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '09:00', closes: '17:00' }));

export async function seedDemo(adminUrl: string, mfaKey: Buffer): Promise<{ seeded: boolean }> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query('select 1 from persons where email = $1', [DEMO_ACCOUNTS.superAdmin.email]);
    if (existing.rowCount !== 0) return { seeded: false };
    await client.query('begin');
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const person = async (name: string, contact: { phone?: string; email?: string }, mfa = false): Promise<string> => {
      const row = await client.query<{ id: string }>(
        `insert into persons (display_name, phone, email, password_hash, mfa_secret_enc, mfa_enabled_at)
         values ($1, $2, $3, $4, $5, case when $5::bytea is null then null else now() end) returning id`,
        [name, contact.phone ?? null, contact.email ?? null, hash, mfa ? seal(mfaKey, base32Decode(DEMO_TOTP_SECRET)) : null],
      );
      return row.rows[0]!.id;
    };

    const organization = async (name: string, slug: string, facilities: Array<{ name: string; city: string }>) => {
      const org = await client.query<{ id: string }>(
        `insert into organizations (name, slug, phone, address, status) values ($1, $2, '924235761234', $3, 'provisioning') returning id`,
        [name, slug, `${facilities[0]!.city}, Pakistan`],
      );
      const id = org.rows[0]!.id;
      const facilityIds: string[] = [];
      for (const facility of facilities) {
        const row = await client.query<{ id: string }>(
          `insert into facilities (organization_id, name, address, city, phone, opening_hours)
           values ($1, $2, $3, $4, '924235761234', $5) returning id`,
          [id, facility.name, `12 Main Boulevard, ${facility.city}`, facility.city, JSON.stringify(HOURS)],
        );
        facilityIds.push(row.rows[0]!.id);
      }
      const roles = {} as Record<RoleKey, string>;
      for (const role of ROLE_TEMPLATES) {
        const row = await client.query<{ id: string }>(
          'insert into roles (organization_id, key, name, permissions, system, requires_module) values ($1, $2, $3, $4, true, $5) returning id',
          [id, role.key, role.name, role.permissions, role.requiresModule],
        );
        roles[role.key] = row.rows[0]!.id;
      }
      await client.query(`update organizations set status = 'setup_required' where id = $1`, [id]);
      return { id, facilityIds, roles };
    };

    const member = async (org: { id: string; roles: Record<RoleKey, string> }, personId: string, role: RoleKey, facilities: string[] | 'all') => {
      const row = await client.query<{ id: string }>(
        'insert into memberships (organization_id, person_id, facility_scope) values ($1, $2, $3) returning id',
        [org.id, personId, facilities === 'all' ? 'all' : 'selected'],
      );
      const membershipId = row.rows[0]!.id;
      await client.query('insert into membership_roles (membership_id, role_id, organization_id) values ($1, $2, $3)', [membershipId, org.roles[role], org.id]);
      if (facilities !== 'all') {
        for (const facility of facilities) {
          await client.query('insert into membership_facilities (membership_id, facility_id, organization_id) values ($1, $2, $3)', [membershipId, facility, org.id]);
        }
      }
    };

    const owner = await person(DEMO_ACCOUNTS.superAdmin.name, { email: DEMO_ACCOUNTS.superAdmin.email }, true);
    await client.query('insert into platform_admins (person_id) values ($1)', [owner]);

    const shifa = await organization('Shifa Health Clinic', 'shifa-health', [
      { name: 'Gulberg Branch', city: 'Lahore' },
      { name: 'DHA Branch', city: 'Lahore' },
    ]);
    await member(shifa, await person(DEMO_ACCOUNTS.shifaAdmin.name, { phone: DEMO_ACCOUNTS.shifaAdmin.phone }), 'tenant_admin', 'all');
    await member(shifa, await person(DEMO_ACCOUNTS.shifaReceptionist.name, { phone: DEMO_ACCOUNTS.shifaReceptionist.phone }), 'receptionist', [shifa.facilityIds[0]!]);
    await member(shifa, await person(DEMO_ACCOUNTS.shifaFinance.name, { phone: DEMO_ACCOUNTS.shifaFinance.phone }), 'finance', 'all');
    await client.query(`update organizations set status = 'active' where id = $1`, [shifa.id]);

    const city = await organization('City Medical Centre', 'city-medical', [{ name: 'Clifton Branch', city: 'Karachi' }]);
    await member(city, await person(DEMO_ACCOUNTS.cityAdmin.name, { phone: DEMO_ACCOUNTS.cityAdmin.phone }), 'tenant_admin', 'all');

    await client.query('commit');
    return { seeded: true };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
