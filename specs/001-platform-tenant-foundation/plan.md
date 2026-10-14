# Implementation Plan: Platform and Tenant Foundation

**Branch**: `001-platform-tenant-foundation` (work happens on `claude/hi-clinic-management-5cbc61`)
| **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-platform-tenant-foundation/spec.md`

## Summary

Replace v1's single-clinic model with Platform → Organization → Facility, global person
identities with organization memberships, permission-bundle roles, a Super Admin console with
mandatory TOTP, invitation and reset links, organization lifecycle, and separate platform and
organization audit logs. The NestJS API keeps v1's proven infrastructure (database layer with
row-level security, migrations, embedded PostgreSQL tests, security middleware) and gets a new
domain layer and a fresh schema baseline. The Vue web app is replaced by a React + Vite app with
the v2 design system, a permission-driven app shell and the foundation screens. v1 domain modules
not rebuilt here move to `legacy/` for porting in 002 and 005.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 20.10+

**Primary Dependencies**: API: NestJS 11, pg 8, zod 4, bcryptjs, pino, helmet, cookie-parser,
@nestjs/throttler (drop @nestjs/jwt, @anthropic-ai/sdk, multer until 002/005 need them). Web:
React 19, React Router 7, TanStack Query 5, Vite 6, qrcode

**Storage**: PostgreSQL 14+ (embedded PostgreSQL 17 for development and tests); row-level
security; application role `clinic_app` (non-owner, no BYPASSRLS)

**Testing**: Vitest 3 + supertest on real PostgreSQL (API); Vitest + Testing Library + jsdom (web)

**Target Platform**: One Node service that serves the API under `/api` and the built web app for
every other path (same origin, so cookie sessions need no cross-site settings); staging on
Railway with Railway PostgreSQL; evergreen browsers (Chrome/Edge for voice dictation)

**Project Type**: Web application (API + SPA) in an npm workspace monorepo

**Performance Goals**: Session, membership and permission resolution is one database round trip
per request (a single security-definer function);
pages usable within 2 s on a mid-range phone over 4G

**Constraints**: The API refuses to start in production if its database role is a superuser or
has BYPASSRLS (managed hosts hand out superuser URLs); No Redis/queues (Principle V); no patient data in logs or URLs; tokens never in
query strings; Node 20 compatible tool versions (Vite 6, Vitest 3)

**Scale/Scope**: Hundreds of organizations, tens of staff each; ~17 screens; ~35 endpoints

## Constitution Check

*Gate evaluated before Phase 0 and re-checked after Phase 1.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Tenant isolation | Every org-owned table has `organization_id` and RLS (`current_org()`), facility visibility via `has_facility()`; context from session + membership only; slug resolved among caller's memberships; composite FKs prevent cross-org links; isolation test suite per route | PASS |
| II. Least privilege | Permission catalogue in code, roles as data per org, `@Permission()` on every route, fail-closed guard, escalation check, Super Admin separate with `is_platform()` only on foundation tables | PASS |
| III. Clinical gate | Clinical module flag (off by default) exists; Practitioner role unassignable while off; v1 clinical code moved to `legacy/` and unreachable; voice input component delivered | PASS (see Complexity Tracking) |
| IV. Lifecycles and money | Organization lifecycle trigger-enforced; append-only audit tables with allow-listed details; no money in this feature | PASS |
| V. Modular monolith | One API with modules `identity`, `platform`, `organizations`, `staff`, `audit`; one DB; React + Vite; decision records in `docs/v2/decisions` | PASS |
| VI. Real engine | Embedded PostgreSQL tests; gates run before each commit | PASS |
| Security & privacy | TOTP for Super Admin, hashed single-use expiring tokens, server-side revocable sessions, tokens in URL fragments only | PASS |
| Workflow | Spec Kit flow followed; v2 §21.4 checklist answered below | PASS |

Post-design re-check (after data-model and contracts): PASS, no new violations.

### v2 §21.4 review checklist

- **Data ownership**: organizations/facilities/roles/memberships/invitations/audit are
  organization-owned; persons, sessions, resets, platform audit are platform-level.
- **Permissions per action**: see contracts table; platform actions need MFA-level Super Admin.
- **Sensitive data**: identifiers (phone/email) masked in lists; no patient or financial data yet.
- **Lifecycle**: organization (5 states), membership (active/deactivated), invitation
  (pending/accepted/revoked/expired), session (active/revoked/expired).
- **Audit / approval / idempotency**: every write audited; invitation acceptance is
  single-transaction with row lock; reset/invite tokens single-use.
- **Duplicates / failures**: double acceptance → one membership; organization creation is one
  transaction (no half-provisioned tenants); slug uniqueness enforced by DB.
- **Hospital assumptions**: only `facilities.kind = clinic_branch`; no hospital fields.
- **UX states**: loading, empty, error, validation, access-denied for every screen; 375 px check;
  Urdu RTL.

## Project Structure

### Documentation (this feature)

```text
specs/001-platform-tenant-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            (next: /speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── main.ts, bootstrap.ts, app.module.ts, core.module.ts, dev.ts, health.controller.ts
│   ├── config/config.ts                 # + MFA_ENCRYPTION_KEY, DEV_PRINT_TOTP; − JWT, AI, uploads
│   ├── common/                          # kept: errors, logger, http-middleware, validate, schemas,
│   │                                    #       phone, throttling, all-exceptions.filter
│   │   ├── access.ts                    # @Public, @Platform, @Permission, @SessionOnly
│   │   ├── request-context.ts           # ReqCtx: person, org, facility scope, permissions
│   │   └── audit.service.ts             # org + platform audit writers
│   ├── db/                              # kept; DbService.withContext({org, facilities, person, platform})
│   │   ├── migrations/0001_foundation.sql
│   │   └── seed.ts                      # new demo data
│   ├── cli/create-platform-admin.ts
│   └── modules/
│       ├── identity/    # sessions, login, MFA (totp.ts, crypto box), passwords, context, guard
│       ├── platform/    # organizations console, lifecycle, modules, platform audit
│       ├── organizations/ # settings, facilities, setup checks, activation, dashboard
│       ├── staff/       # memberships, roles, invitations, resets
│       └── audit/       # org audit query
└── test/
    ├── global-setup.ts, support/app.ts  # kept, extended with factories
    ├── totp.test.ts, auth.test.ts, mfa.test.ts, platform.test.ts, organizations.test.ts,
    ├── staff.test.ts, invitations.test.ts, audit.test.ts, isolation.test.ts, rls.test.ts
    └── helpers.test.ts                  # kept

apps/web/                                # React + Vite (replaces Vue)
├── index.html, vite.config.ts, tsconfig.json, vitest.config.ts
└── src/
    ├── main.tsx, router.tsx, api/client.ts, api/queries.ts
    ├── auth/        # session provider, RequirePermission, RequirePlatform
    ├── i18n/        # en.ts, ur.ts, useT, direction
    ├── design/      # tokens.css, base.css, components (Button, Field, VoiceTextField,
    │                #   Table, Badge, Alert, Dialog, Drawer, EmptyState, PageHeader, Spinner)
    ├── shell/       # AppShell, Sidebar (from permissions), TopBar, FacilitySelector, PlatformShell
    └── pages/       # login, mfa, choose, invite, reset, account, platform/*, app/*

legacy/
├── v1-api/      # moved v1 domain modules + tests (not built)
└── v1-web/      # v1 Vue sources for porting voice and handwriting
docs/v2/decisions/ # 0007-v2-tenancy-and-identity.md, 0008-sessions-and-mfa.md, 0009-react-web.md,
                   # 0010-legacy-code.md
```

**Structure Decision**: Keep the two-app npm workspace (`apps/api`, `apps/web`). Domain code is
grouped by module under `apps/api/src/modules`. v1 domain code moves to `legacy/` (outside the
workspaces) until 002/005 port it.

## Delivery order (input for /speckit-tasks)

1. Setup: tag `v1-final`, move legacy code, replace web scaffold, trim dependencies, decision records.
2. Foundation: migration, DbService context, session/guard/permission infrastructure, audit, test
   factories, RLS tests.
3. Story 1 (P1) platform onboarding with MFA; Story 2 (P1) sign-in routing and shell;
   Story 3 (P1) setup and team. Each story: API + tests + screens.
4. Staging deployment on Railway (after Story 2): single service, migrations as pre-deploy
   command with the admin URL, restricted app role, backups enabled and one restore tested.
5. Story 4 (P2) staff lifecycle; Story 5 (P2) organization lifecycle and modules.
6. Story 6 (P3) audit views.
7. Polish: demo seed, dev runner, README, CI workflow update, responsive/RTL/accessibility pass,
   quickstart walkthrough in the browser.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| v1 clinical code kept in `legacy/` (unreachable) instead of "behind the module switch" (Principle III wording) | The v1 code targets the removed schema and cannot compile against 001's model | Porting it now would build clinical features ahead of Phase 1B; deleting it loses easy reference for 002/005 |
