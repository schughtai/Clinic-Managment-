import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Row-level security checked directly against PostgreSQL as the application role, without the API.
 * These prove the database refuses cross-organization access even if application code forgets a filter.
 */

interface Ctx {
  org?: string;
  facilities?: string;
  person?: string;
  platform?: boolean;
}

let admin: Client;
let app: Client;
const ids = {
  orgA: '',
  orgB: '',
  facilityA1: '',
  facilityA2: '',
  facilityB1: '',
  personA: '',
  personB: '',
};

async function asApp<T>(ctx: Ctx, work: (client: Client) => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query(
      `select set_config('app.org_id', $1, true), set_config('app.facility_ids', $2, true),
              set_config('app.person_id', $3, true), set_config('app.platform', $4, true)`,
      [ctx.org ?? '', ctx.facilities ?? '', ctx.person ?? '', ctx.platform === true ? 'on' : ''],
    );
    return await work(app);
  } finally {
    await app.query('rollback');
  }
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query<{ n: string }>(`select count(*)::text as n from (${sql}) q`, params);
  return Number(result.rows[0]?.n ?? 0);
}

beforeAll(async () => {
  admin = new Client({ connectionString: inject('adminUrl') });
  app = new Client({ connectionString: inject('appUrl') });
  await admin.connect();
  await app.connect();

  const org = async (slug: string): Promise<string> =>
    (await admin.query<{ id: string }>(`insert into organizations (name, slug, status) values ($1, $2, 'provisioning') returning id`, [slug, slug]))
      .rows[0]!.id;
  ids.orgA = await org('rls-org-a');
  ids.orgB = await org('rls-org-b');
  const facility = async (orgId: string, name: string): Promise<string> =>
    (await admin.query<{ id: string }>('insert into facilities (organization_id, name) values ($1, $2) returning id', [orgId, name])).rows[0]!.id;
  ids.facilityA1 = await facility(ids.orgA, 'A1');
  ids.facilityA2 = await facility(ids.orgA, 'A2');
  ids.facilityB1 = await facility(ids.orgB, 'B1');
  const person = async (phone: string): Promise<string> =>
    (await admin.query<{ id: string }>(`insert into persons (display_name, phone, password_hash) values ('P', $1, 'x') returning id`, [phone])).rows[0]!.id;
  ids.personA = await person('923001110001');
  ids.personB = await person('923001110002');
  await admin.query('insert into memberships (organization_id, person_id) values ($1, $2), ($3, $4)', [ids.orgA, ids.personA, ids.orgB, ids.personB]);
  await admin.query(`insert into audit_events (organization_id, actor_label, action) values ($1, 'x', 'test.event'), ($2, 'x', 'test.event')`, [
    ids.orgA,
    ids.orgB,
  ]);
});

afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('row-level security', () => {
  it('shows only the current organization', async () => {
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      expect(await count(c, 'select id from organizations')).toBe(1);
      expect(await count(c, 'select id from memberships')).toBe(1);
      expect(await count(c, 'select id from facilities')).toBe(2);
      expect(await count(c, 'select id from audit_events')).toBe(1);
      expect(await count(c, 'select id from organizations where id = $1', [ids.orgB])).toBe(0);
    });
  });

  it('shows nothing without a context', async () => {
    await asApp({}, async (c) => {
      expect(await count(c, 'select id from organizations')).toBe(0);
      expect(await count(c, 'select id from facilities')).toBe(0);
      expect(await count(c, 'select id from persons')).toBe(0);
    });
  });

  it('hides facilities outside the granted list', async () => {
    await asApp({ org: ids.orgA, facilities: ids.facilityA1 }, async (c) => {
      const rows = await c.query<{ id: string }>('select id from facilities');
      expect(rows.rows.map((r) => r.id)).toEqual([ids.facilityA1]);
    });
    await asApp({ org: ids.orgA }, async (c) => {
      expect(await count(c, 'select id from facilities')).toBe(0);
    });
  });

  it('shows persons only through a membership in the current organization or as oneself', async () => {
    await asApp({ org: ids.orgA }, async (c) => {
      const rows = await c.query<{ id: string }>('select id from persons');
      expect(rows.rows.map((r) => r.id)).toEqual([ids.personA]);
    });
    await asApp({ person: ids.personB }, async (c) => {
      const rows = await c.query<{ id: string }>('select id from persons');
      expect(rows.rows.map((r) => r.id)).toEqual([ids.personB]);
    });
  });

  it('refuses writes into another organization', async () => {
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      await expect(c.query(`insert into facilities (organization_id, name) values ($1, 'sneaky')`, [ids.orgB])).rejects.toThrow(/row-level security/);
    });
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      const updated = await c.query('update organizations set name = $1 where id = $2', ['x', ids.orgB]);
      expect(updated.rowCount).toBe(0);
    });
  });

  it('opens foundation tables to the platform but not audit or other details', async () => {
    await asApp({ platform: true }, async (c) => {
      expect(await count(c, 'select id from organizations where id in ($1, $2)', [ids.orgA, ids.orgB])).toBe(2);
      expect(await count(c, 'select id from facilities where organization_id in ($1, $2)', [ids.orgA, ids.orgB])).toBe(3);
      expect(await count(c, 'select id from audit_events')).toBe(0);
    });
  });

  it('keeps audit tables append-only', async () => {
    await asApp({ org: ids.orgA }, async (c) => {
      await expect(c.query(`update audit_events set action = 'x.y'`)).rejects.toThrow(/permission denied/);
    });
    await asApp({ org: ids.orgA }, async (c) => {
      await expect(c.query('delete from audit_events')).rejects.toThrow(/permission denied/);
    });
  });

  it('keeps sessions, resets and platform admins out of direct reach', async () => {
    for (const table of ['sessions', 'password_resets', 'platform_admins']) {
      await asApp({ platform: true }, async (c) => {
        await expect(c.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      });
    }
    await asApp({ platform: true }, async (c) => {
      await expect(c.query(`insert into platform_admins (person_id) values ($1)`, [ids.personA])).rejects.toThrow(/permission denied/);
    });
  });

  it('enforces organization status transitions', async () => {
    const setStatus = (status: string, reason: string | null) =>
      asApp({ platform: true }, (c) => c.query('update organizations set status = $1, status_reason = $2 where id = $3', [status, reason, ids.orgA]));
    await expect(setStatus('active', null)).rejects.toThrow(/cannot move from provisioning to active/);
    await admin.query(`update organizations set status = 'setup_required' where id = $1`, [ids.orgA]);
    await expect(setStatus('suspended', null)).rejects.toThrow(/reason is required/);
    await expect(setStatus('deactivated', 'x')).rejects.toThrow(/cannot move/);
    // A tenant cannot suspend itself or change its modules.
    await expect(
      asApp({ org: ids.orgA }, (c) => c.query(`update organizations set status = 'suspended', status_reason = 'x' where id = $1`, [ids.orgA])),
    ).rejects.toThrow(/only the platform/);
    await expect(
      asApp({ org: ids.orgA }, (c) => c.query(`update organizations set modules = '{clinical}' where id = $1`, [ids.orgA])),
    ).rejects.toThrow(/only the platform/);
  });

  it('refuses to link another organization’s facility to a membership', async () => {
    const membership = (await admin.query<{ id: string }>('select id from memberships where organization_id = $1', [ids.orgA])).rows[0]!.id;
    await expect(
      admin.query('insert into membership_facilities (membership_id, facility_id, organization_id) values ($1, $2, $3)', [
        membership,
        ids.facilityB1,
        ids.orgA,
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});
