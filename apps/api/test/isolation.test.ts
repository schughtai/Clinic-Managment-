import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPlatformAdmin, memberAgent, PASSWORD, signIn, startTestApp, type Agent, type TestApp, type TestOrg } from './support/app';

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
const ZERO = '00000000-0000-4000-8000-000000000000';
const ORG_ROUTES: Array<Route & { adminOnly: boolean }> = [
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/dashboard`, adminOnly: false },
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/settings`, adminOnly: false },
  { method: 'put', path: (o) => `/api/orgs/${o.slug}/settings`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/activate`, adminOnly: true },
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/facilities`, adminOnly: false },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/facilities`, adminOnly: true },
  { method: 'put', path: (o) => `/api/orgs/${o.slug}/facilities/${o.facilityIds[0]}`, adminOnly: true },
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/staff`, adminOnly: true },
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/roles`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/invitations`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/invitations/${ZERO}/revoke`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/invitations/${ZERO}/reissue`, adminOnly: true },
  { method: 'put', path: (o) => `/api/orgs/${o.slug}/staff/${ZERO}`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/staff/${ZERO}/deactivate`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/staff/${ZERO}/reactivate`, adminOnly: true },
  { method: 'post', path: (o) => `/api/orgs/${o.slug}/staff/${ZERO}/reset-password`, adminOnly: true },
  { method: 'get', path: (o) => `/api/orgs/${o.slug}/audit`, adminOnly: true },
];

/** Platform routes: closed to every organization member, including administrators. */
const PLATFORM_ROUTES: Route[] = [
  { method: 'get', path: () => '/api/platform/organizations' },
  { method: 'post', path: () => '/api/platform/organizations' },
  { method: 'get', path: (o) => `/api/platform/organizations/${o.id}` },
  { method: 'post', path: (o) => `/api/platform/organizations/${o.id}/invitations` },
  { method: 'post', path: (o) => `/api/platform/organizations/${o.id}/status`, body: { action: 'suspend', reason: 'x' } },
  { method: 'put', path: (o) => `/api/platform/organizations/${o.id}/modules`, body: { modules: [] } },
  { method: 'post', path: (o) => `/api/platform/organizations/${o.id}/admins/${ZERO}/reset-password` },
  { method: 'get', path: () => '/api/platform/audit' },
];

/** Placeholder organization used only to print readable test names. */
const LABEL = { slug: ':slug', id: ':id', facilityIds: [':facility'], roleIds: {} } as unknown as TestOrg;

const call = (agent: Agent, route: Route, org: TestOrg) => agent[route.method](route.path(org)).send(route.body ?? {});

describe('organization isolation over HTTP', () => {
  it.each(ORG_ROUTES.map((route) => [route.path(LABEL), route] as const))(
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

  it.each(ORG_ROUTES.filter((route) => route.adminOnly).map((route) => [route.path(LABEL), route] as const))(
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

  it.each(PLATFORM_ROUTES.map((route) => [route.path(LABEL), route] as const))(
    'an organization administrator gets 403 on platform route %s',
    async (_label, route) => {
      expect((await call(adminB, route, orgA)).status).toBe(403);
    },
  );

  it('a Super Admin without the authenticator step gets mfa_required on platform routes', async () => {
    const admin = await createPlatformAdmin(t);
    const agent = t.agent();
    await agent.post('/api/auth/login').send({ identifier: admin.phone, password: PASSWORD });
    for (const route of PLATFORM_ROUTES) {
      const response = await call(agent, route, orgA);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('mfa_required');
    }
  });

  it('refuses everything without a session', async () => {
    for (const route of [...ORG_ROUTES, ...PLATFORM_ROUTES]) {
      expect((await call(t.agent(), route, orgA)).status).toBe(401);
    }
  });
});
