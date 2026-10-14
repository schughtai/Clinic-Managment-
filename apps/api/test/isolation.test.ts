import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPlatformAdmin, memberAgent, signIn, startTestApp, type Agent, type TestApp, type TestOrg } from './support/app';

/**
 * Cross-organization and cross-role access through the HTTP API (SC-003). Every organization route
 * in contracts/api.md is listed here; each feature adds its routes as they are built.
 */

let t: TestApp;
let orgA: TestOrg;
let orgB: TestOrg;
let adminB: Agent;
let receptionistA: Agent;
let platform: Agent;

beforeAll(async () => {
  t = await startTestApp();
  orgA = await createOrg(t, { facilities: 2 });
  orgB = await createOrg(t);
  adminB = (await memberAgent(t, orgB, ['tenant_admin'])).agent;
  receptionistA = (await memberAgent(t, orgA, ['receptionist'], [orgA.facilityIds[0]!])).agent;
  platform = await signIn(t, await createPlatformAdmin(t));
});
afterAll(async () => {
  await t.close();
});

type Route = { method: 'get' | 'post' | 'put'; path: (org: TestOrg) => string; body?: object };

/** Organization routes. `admin` routes need permissions a receptionist does not have. */
const ORG_ROUTES: Array<Route & { adminOnly: boolean }> = [{ method: 'get', path: (o) => `/api/orgs/${o.slug}/dashboard`, adminOnly: false }];

const call = (agent: Agent, route: Route, org: TestOrg) => agent[route.method](route.path(org)).send(route.body ?? {});

describe('organization isolation over HTTP', () => {
  it.each(ORG_ROUTES.map((route) => [route.path({ slug: ':slug' } as TestOrg), route] as const))(
    'a member of another organization gets 404 on %s',
    async (_label, route) => {
      const response = await call(adminB, route, orgA);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    },
  );

  it('answers the same for an organization that does not exist', async () => {
    const response = await adminB.get('/api/orgs/no-such-org/dashboard');
    expect(response.status).toBe(404);
  });

  it.each(ORG_ROUTES.filter((route) => route.adminOnly).map((route) => [route.path({ slug: ':slug' } as TestOrg), route] as const))(
    'a receptionist gets 403 on admin route %s',
    async (_label, route) => {
      expect((await call(receptionistA, route, orgA)).status).toBe(403);
    },
  );

  it('keeps a branch-limited member to their branch', async () => {
    const me = await receptionistA.get('/api/auth/me');
    expect(me.body.memberships[0].facilities.map((f: { id: string }) => f.id)).toEqual([orgA.facilityIds[0]]);
    const dashboard = await receptionistA.get(`/api/orgs/${orgA.slug}/dashboard`);
    expect(dashboard.body.counts.facilities).toBe(1);
    expect((await receptionistA.post('/api/auth/context').send({ orgSlug: orgA.slug, facilityId: orgA.facilityIds[1] })).status).toBe(404);
  });

  it('gives a Super Admin no organization access without a membership', async () => {
    for (const route of ORG_ROUTES) {
      expect((await call(platform, route, orgA)).status).toBe(404);
    }
  });

  it('refuses everything without a session', async () => {
    for (const route of ORG_ROUTES) {
      expect((await call(t.agent(), route, orgA)).status).toBe(401);
    }
  });
});
