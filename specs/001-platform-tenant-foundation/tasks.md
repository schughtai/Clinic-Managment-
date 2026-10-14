---

description: "Task list for 001 Platform and Tenant Foundation"
---

# Tasks: Platform and Tenant Foundation

**Input**: Design documents from `specs/001-platform-tenant-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included. Constitution Principle VI requires automated tests for tenancy,
permissions, status transitions; spec SC-003 requires isolation tests for every route.

**Organization**: Grouped by user story (spec.md US1–US6) so each can be built and checked alone.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 … US6 from spec.md
- Paths: API `apps/api/`, web `apps/web/`, legacy `legacy/`, decisions `docs/v2/decisions/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Clear v1 domain code out of the build, scaffold the React app, trim dependencies.

- [X] T001 Create git tag `v1-final` on commit `bb638aa` (last v1 commit) for recovery reference
- [X] T002 Move v1 API domain modules `apps/api/src/modules/{patients,appointments,doctors,visits,prescriptions,billing,reports,messaging,data,ai,files,clinic,users}` and their tests `apps/api/src/modules/auth`, and tests `apps/api/test/{appointments,billing,operations,patients,visits,ai-provider,staff,auth,db-isolation}.test.ts` to `legacy/v1-api/`, and replace `apps/api/src/db/seed.ts` with a stub that seeds nothing until T081 with a `legacy/README.md` explaining they are unbuilt reference code to be ported by features 002 and 005
- [X] T003 Move v1 Vue sources `apps/web/src/**` to `legacy/v1-web/src/` (keeping the voice-input and handwriting components for porting) and delete the remaining Vue config files in `apps/web/`
- [X] T004 Remove unused API dependencies (`@nestjs/jwt`, `@anthropic-ai/sdk`, `multer`, `@types/multer`) from `apps/api/package.json`; strip AI/upload/signup/JWT settings and add `MFA_ENCRYPTION_KEY` (64 hex chars, required and non-placeholder in production; fixed dev value otherwise) and `DEV_PRINT_TOTP` to `apps/api/src/config/config.ts`; update `apps/api/.env.example`
- [X] T005 Scaffold React + Vite app: `apps/web/package.json` (react 19, react-dom, react-router 7, @tanstack/react-query 5, qrcode; dev: vite 6, @vitejs/plugin-react, typescript, vitest 3, @testing-library/react, @testing-library/user-event, jsdom, eslint + typescript-eslint + eslint-plugin-react-hooks), `apps/web/index.html`, `apps/web/vite.config.ts` (port 3000, `/api` proxy to :3001), `apps/web/tsconfig.json` (strict), `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`
- [X] T006 [P] Update root `package.json` scripts (`dev`, `build`, `test` running both workspaces, `lint`, `typecheck`, `platform:create-admin`) and `.github/workflows/ci.yml` to run typecheck, lint, test and build for both apps
- [X] T007 [P] Write decision records `docs/v2/decisions/0007-tenancy-and-identity.md`, `0008-sessions-and-mfa.md`, `0009-react-web-app.md`, `0010-legacy-v1-code.md` from research.md R1–R6, R9, R2
- [X] T008 Run `npm install` and confirm all gates (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) pass for the trimmed API skeleton (`AppModule` with only `HealthController`) in `apps/api/src/app.module.ts` and the placeholder React page

**Checkpoint**: Repository builds with only infrastructure; v1 domain code lives in `legacy/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, context-aware database access, sessions, permissions guard, audit, test kit,
design system and app shell skeleton. No user story can start before this is done.

### Database

- [X] T009 Delete `apps/api/src/db/migrations/0001_init.sql`, `0002_*.sql`, `0003_*.sql` and create `apps/api/src/db/migrations/0001_foundation.sql` with extensions (`pg_trgm`, `btree_gist`), default privileges for `clinic_app`, helper functions `current_org()`, `current_person()`, `has_facility(uuid)` (`app.facility_ids` is `*` or contains the id), `is_platform()` (`app.platform = 'on'`), and `touch_updated_at()`
- [X] T010 In `0001_foundation.sql` create `persons` exactly per data-model.md: `display_name` 1–120 chars; `phone` digits 8–15 unique when present; `email` lower-case unique when present; check `phone is not null or email is not null`; `password_hash`; `failed_logins ≥ 0`; `locked_until`; `mfa_secret_enc bytea`; `mfa_enabled_at`; `mfa_last_step bigint`; `preferred_language in ('en','ur')`; timestamps; RLS select/update for self, `is_platform()`, or membership in `current_org()`; plus `mfa_recovery_codes` and `platform_admins` (no direct `clinic_app` grants)
- [X] T011 In `0001_foundation.sql` create type `org_status` (`provisioning`,`setup_required`,`active`,`suspended`,`deactivated`) and `organizations` per data-model.md: slug `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` unique and not in (`platform`,`app`,`api`,`login`,`invite`,`reset`); name 1–120; `currency char(3)` default `PKR`; `default_language` `en`/`ur`; `timezone` default `Asia/Karachi`; `date_format in ('dd/MM/yyyy','yyyy-MM-dd','MM/dd/yyyy')`; `modules text[]` default `{}`; `suspended_from`, `status_reason`, `activated_at`; a trigger rejecting transitions not listed in data-model.md and requiring `status_reason` for suspend/deactivate; RLS `id = current_org() or is_platform()`
- [X] T012 In `0001_foundation.sql` create `facilities` (name 1–120 unique per org case-insensitive, `kind = 'clinic_branch'`, address ≤ 300, city ≤ 80, phone digits 8–15, `timezone` nullable, `opening_hours jsonb` default `[]`, `active`), `roles` (`key` unique per org, `permissions text[]`, `system`, `requires_module`), `memberships` (unique `(organization_id, person_id)`, `status in ('active','deactivated')`, `facility_scope in ('all','selected')`, deactivation fields), `membership_roles` and `membership_facilities` with composite foreign keys including `organization_id`; RLS org-owned `+platform`; facilities additionally require `has_facility(id) or is_platform()` for select
- [X] T013 In `0001_foundation.sql` create `invitations` (`token_hash bytea` unique, invitee name, phone/email at least one, `role_ids uuid[]`, `facility_scope`, `facility_ids uuid[]`, `status in ('pending','accepted','revoked')`, `expires_at`, creator/accepter fields), `password_resets` (`token_hash` unique, `person_id`, `organization_id` null, `expires_at`, `used_at`), `sessions` (`token_hash` unique, `person_id`, `auth_level in ('password','mfa')`, `organization_id`, `facility_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `revoke_reason`), `audit_events` (org-owned, insert/select only) and `platform_audit_events` (select only when `is_platform()`)
- [X] T014 In `0001_foundation.sql` create security-definer functions with fixed `search_path` and execute granted only to `clinic_app`: `auth_find_person(identifier)`, `auth_record_login(person, success, max, lock_minutes)`, `auth_is_platform_admin(person)`, `session_create`, `session_resolve(hash)` (returns person, level, context, expiry, revoked), `session_touch`, `session_set_context`, `session_revoke(hash)`, `session_revoke_person(person, reason, org null)`, `session_revoke_org(org, reason)`, `invitation_lookup(hash)`, `invitation_accept(hash, person or new-person fields)` (row lock, single use), `reset_lookup(hash)`, `reset_complete(hash, password_hash)`, `platform_create_organization(...)` (requires `is_platform()`; inserts org as `provisioning`, first facility, four role templates, then sets `setup_required`), `platform_audit(...)`, and `request_context(session_hash, org_slug)` returning session, person, platform flag, membership, organization status/modules, facility scope and permission union in one round trip
- [X] T015 Extend `apps/api/src/db/db.service.ts`: replace `withClinic`/`withoutClinic` with `withContext({ orgId?, facilityIds?: string[] | '*', personId?, platform?: boolean }, work)` setting `app.org_id`, `app.facility_ids`, `app.person_id`, `app.platform` via `set_config(..., true)`, and `withoutContext(work)`
- [X] T016 [P] Write `apps/api/test/rls.test.ts`: as `clinic_app`, prove each org-owned table returns no rows for another org, facilities outside `app.facility_ids` are hidden, `is_platform()` rows appear only with `app.platform=on`, audit tables reject update/delete, `clinic_app` cannot insert into `platform_admins` or read `sessions` directly, and invalid organization status transitions raise

### Identity core

- [X] T017 [P] Implement `apps/api/src/modules/identity/tokens.ts`: `newToken()` (32 random bytes base64url) and `hashToken()` (SHA-256 → Buffer), plus `apps/api/src/modules/identity/crypto-box.ts` AES-256-GCM `seal`/`open` using `MFA_ENCRYPTION_KEY`
- [X] T018 [P] Implement `apps/api/src/modules/identity/totp.ts` (RFC 6238: SHA-1, 6 digits, 30 s step, ±1 step window, base32 encode/decode, `otpauth://` URI builder) and `apps/api/test/totp.test.ts` with the RFC 6238 Appendix B vectors (truncated to 6 digits) and window/replay cases
- [X] T019 Implement `apps/api/src/modules/identity/permissions.ts`: permission catalogue (`dashboard.read`, `organization.read`, `organization.update`, `facility.read`, `facility.manage`, `staff.read`, `staff.invite`, `staff.manage`, `staff.reset_password`, `role.read`, `audit.read`), role templates `tenant_admin`, `receptionist`, `finance`, `practitioner` (requires module `clinical`, no 001 permissions) per data-model.md matrix, `KNOWN_MODULES = ['clinical']`
- [X] T020 Implement `apps/api/src/modules/identity/session.service.ts`: create (cookie `clinic_session`, httpOnly, SameSite Lax, Secure from config, 12 h), resolve via `session_resolve`, touch `last_seen_at` at most once per minute, set context, revoke current/person/org
- [X] T021 Rewrite `apps/api/src/common/request-context.ts` (`ReqCtx` with `person`, `session`, `org?: {id, slug, status, modules}`, `facilityIds: string[] | '*'`, `activeFacilityId?`, `permissions: Set<string>`, `isPlatform`, `requestId`) and `apps/api/src/common/access.ts` decorators `@Public()`, `@SessionOnly()`, `@Platform()`, `@Permission(code)`
- [X] T022 Implement `apps/api/src/modules/identity/access.guard.ts` (fail closed, one `request_context` call per request): resolve session; for `@Platform` require platform admin + `mfa` level; for `:slug` routes resolve org among the caller's active memberships (unknown → 404 `not_found`), refuse suspended/deactivated orgs with 403 `organization_suspended`, load facility scope and union of role permissions, check `@Permission`; attach `ReqCtx`
- [X] T023 Implement `apps/api/src/common/audit.service.ts` with `org(ctx, action, target, details)` and `platform(ctx, action, target, details)`; per-action allow-list of detail keys; never accepts secrets
- [X] T024 [P] Add error codes from contracts/api.md (`mfa_required`, `mfa_invalid`, `mfa_already_enrolled`, `account_locked`, `invitation_invalid`, `reset_invalid`, `organization_suspended`, `setup_incomplete`, `last_admin`, `permission_escalation`, `module_disabled`, `slug_taken`, `context_required`) to `apps/api/src/common/errors.ts`
- [X] T025 Add a production start-up check in `apps/api/src/db/db.service.ts` (or `bootstrap.ts`) that queries `rolsuper`/`rolbypassrls` of `current_user` and refuses to start when either is true, with a test in `apps/api/test/db-role.test.ts`
- [X] T026 Rewrite `apps/api/test/support/app.ts` with factories: `createPlatformAdmin()`, `createOrg({ facilities })`, `addMember(org, roles, facilityScope)`, `signIn(agent, identifier, password, totp?)`, `currentTotp(secret)`; and `apps/api/src/app.module.ts` registering identity guard, throttler and error filter

### Web foundation

- [X] T027 [P] Create `apps/web/src/design/tokens.css` with v2 §17.2 tokens (`--bg #F7F9FC`, `--surface #FFFFFF`, `--text #17212F`, `--text-2 #64748B`, `--border #E2E8F0`, `--accent #0F766E`, `--accent-hover #115E59`, `--info #2563EB`, `--success #15803D`, `--warning #B45309`, `--danger #B91C1C`, `--focus #0F766E`), 4 px spacing scale, radii 8/12/16 px, type scale 12–28 px, Inter + Noto Nastaliq Urdu fallbacks, tabular numerals, reduced-motion rule; and `apps/web/src/design/base.css` using logical properties
- [X] T028 [P] Create components in `apps/web/src/design/components/`: `Button` (primary/secondary/tertiary/destructive, loading, disabled), `Field` (label, hint, error), `TextInput`, `Select`, `Checkbox`, `Table`, `Badge` (status with text + icon), `Alert`, `Dialog`, `ConfirmDialog`, `Drawer`, `EmptyState`, `ErrorState`, `AccessDenied`, `PageHeader`, `Spinner`, `Icon` (inline SVG set)
- [X] T029 [P] Port voice input from `legacy/v1-web/` to `apps/web/src/design/components/VoiceTextField.tsx` + `useDictation.ts` (Speech Recognition, `en-PK`/`ur-PK`, interim text into the field, never saves, hidden with explanation when unsupported) with `apps/web/src/design/components/VoiceTextField.test.tsx`
- [X] T030 [P] Create i18n `apps/web/src/i18n/{en.ts,ur.ts,index.tsx}` (typed keys, `useT()`, English fallback, sets `<html lang dir>`)
- [X] T031 Create `apps/web/src/api/client.ts` (fetch wrapper, JSON, error shape → typed `ApiError`, 401 → session expired event, Idempotency-Key helper) and `apps/web/src/api/queries.ts` (TanStack Query client, `useMe()`)
- [X] T032 Create `apps/web/src/main.tsx`, `apps/web/src/router.tsx` (all routes from contracts/api.md with lazy pages), `apps/web/src/auth/SessionProvider.tsx`, `RequireSession`, `RequirePlatform`, `RequirePermission`

**Checkpoint**: Migrations apply, RLS tests pass, guard and test kit work, web app boots to a
placeholder login page.

---

## Phase 3: User Story 1 — Super Admin onboards a new clinic organization (Priority: P1) 🎯 MVP

**Goal**: Bootstrap Super Admin, MFA sign-in, create organization with first facility and
defaults, invite the first admin, accept the invitation.

**Independent Test**: Empty system + bootstrapped Super Admin → create organization → invite
admin → accept in another browser → admin lands in the organization workspace.

### Tests for User Story 1

- [X] T033 [P] [US1] `apps/api/test/mfa.test.ts`: first Super Admin sign-in returns `mfa_enroll`; enrol/confirm returns 10 recovery codes; platform routes refuse `password`-level sessions with `mfa_required`; wrong code → `mfa_invalid`; reused code step refused; recovery code works once
- [X] T034 [P] [US1] `apps/api/test/platform.test.ts`: create organization (status `setup_required`, one facility, four roles, PKR/en/Asia/Karachi defaults, platform audit entry); duplicate or reserved slug → `slug_taken`/validation error; non-admin and non-MFA callers get 403
- [X] T035 [P] [US1] `apps/api/test/invitations.test.ts`: first-admin invitation returns link with fragment token and `whatsappUrl`, expires in 72 h; lookup reveals only org and invitee names; acceptance creates person + membership with `tenant_admin`; second acceptance and concurrent double acceptance yield exactly one membership; expired/revoked → `invitation_invalid`; existing person must be signed in as that person to accept

### Implementation for User Story 1

- [X] T036 [US1] Implement `apps/api/src/cli/create-platform-admin.ts` (args `--name`, `--email`|`--phone`, `--promote`; hidden password prompt; uses admin URL) and npm script `platform:create-admin` in `apps/api/package.json`; also accept `--password-env NAME` for non-interactive use on a host
- [X] T037 [US1] Implement `apps/api/src/cli/reset-platform-mfa.ts` (npm script `platform:reset-mfa`) that clears a Super Admin's MFA enrolment and recovery codes with a platform audit entry, documented in `docs/v2/operations.md`
- [X] T038 [US1] Implement `apps/api/src/modules/identity/auth.service.ts` + `auth.controller.ts`: `POST /auth/login` (identifier = phone or email; lockout 5 failures/15 min; returns `next`), `POST /auth/mfa/enroll/start`, `POST /auth/mfa/enroll/confirm`, `POST /auth/mfa/verify`, `POST /auth/logout`, `GET /auth/me`; security events to audit
- [X] T039 [US1] Implement `apps/api/src/modules/platform/organizations.service.ts` + `platform.controller.ts`: `GET/POST /platform/organizations`, `GET /platform/organizations/:id` (no patient data), using `platform_create_organization`
- [X] T040 [US1] Implement `apps/api/src/modules/staff/invitations.service.ts`: create (hash only stored; link `/invite#<token>`; `https://wa.me/<phone?>?text=` message), lookup, accept (new person with password ≥ 10 chars, or existing signed-in person), and controllers `POST /platform/organizations/:id/invitations`, `POST /invitations/lookup`, `POST /invitations/accept` with strict rate limit
- [X] T041 [P] [US1] Web: `apps/web/src/pages/auth/LoginPage.tsx`, `MfaEnrollPage.tsx` (QR via `qrcode`, base32 text, confirm, recovery codes shown once with copy/print), `MfaVerifyPage.tsx` (code or recovery code)
- [X] T042 [P] [US1] Web: `apps/web/src/shell/PlatformShell.tsx`, `apps/web/src/pages/platform/OrganizationsPage.tsx` (list, search, status badges, empty state) and `CreateOrganizationDrawer.tsx` (name, slug auto-suggest, locale defaults, first facility)
- [X] T043 [US1] Web: `apps/web/src/pages/platform/OrganizationDetailPage.tsx` with "Invite administrator" dialog showing the one-time link with copy and WhatsApp buttons; `apps/web/src/pages/auth/InvitePage.tsx` reading the token from `location.hash`, showing org/invitee, password form or "sign in to accept"

**Checkpoint**: Story 1 works end to end and its tests pass.

---

## Phase 4: User Story 2 — Staff sign in and land in the right workspace (Priority: P1)

**Goal**: Correct routing, context selection, permission-driven shell, immediate revocation.

**Independent Test**: Seed users with different memberships; sign in as each; check landing,
sidebar, blocked pages.

### Tests for User Story 2

- [X] T044 [P] [US2] `apps/api/test/auth.test.ts`: one membership → `ready` with destination `/app/<slug>/dashboard`; two memberships → `choose_context`; `POST /auth/context` only accepts own active memberships and granted facilities; 5 failures lock for 15 min and 6th attempt refused even with right password; deactivated membership → next request 401/404; member whose last facility grant was removed signs in but gets `context_required` / no-facility state; session expires after 12 h; logout ends session
- [X] T045 [P] [US2] `apps/api/test/isolation.test.ts` (grows with each story): for every org route in contracts/api.md, a member of org B gets 404 for org A's slug and resources; Receptionist gets 403 on admin routes; facility-limited member never sees ungranted facility ids
- [X] T046 [P] [US2] `apps/web/src/shell/Sidebar.test.tsx`: sidebar items are derived from `permissions` (Receptionist sees Dashboard only; admin sees Settings, Staff, Audit); `RequirePermission` renders `AccessDenied` without fetching data

### Implementation for User Story 2

- [X] T047 [US2] Implement `POST /auth/context` and context-aware `GET /auth/me` (memberships, facilities, permissions, modules) in `apps/api/src/modules/identity/auth.controller.ts` and `context.service.ts`
- [X] T048 [US2] Implement `GET /orgs/:slug/dashboard` (setup checks, counts) in `apps/api/src/modules/organizations/dashboard.controller.ts`
- [X] T049 [P] [US2] Web: `apps/web/src/pages/auth/ChooseContextPage.tsx` (organizations and, for Super Admins, the platform; then facility when more than one)
- [X] T050 [US2] Web: `apps/web/src/shell/AppShell.tsx`, `Sidebar.tsx` (permission-driven, collapsible under 1024 px, active item), `TopBar.tsx` (org name, `FacilitySelector.tsx` when >1 facility, user menu, language switch, sign-out), session-expired, suspended and "no facility access" states; `apps/web/src/pages/app/DashboardPage.tsx` (setup checklist placeholder for US3)
- [X] T051 [US2] Web: `apps/web/src/pages/account/AccountPage.tsx` with change password; `POST /auth/change-password` in `apps/api/src/modules/identity/auth.controller.ts` ending other sessions
- [X] T052 [US2] Optional MFA for any staff member: allow `/auth/mfa/enroll/*` for any signed-in person, require the code at sign-in once enrolled, add "Turn on authenticator" to `apps/web/src/pages/account/AccountPage.tsx`, tests in `apps/api/test/mfa.test.ts`

**Checkpoint**: Stories 1 and 2 work independently; isolation suite green for existing routes.

---

## Phase 4b: Staging deployment on Railway (after US2)

**Purpose**: Run the product on real hosting early, with synthetic data only. Deploying to the
user's Railway account needs the user's confirmation at that moment.

- [X] T053 Serve the built web app from the API in production: static files from `apps/web/dist` with SPA fallback for every non-`/api` GET, long cache for hashed assets, no cache for `index.html`, in `apps/api/src/bootstrap.ts`, with a test in `apps/api/test/static.test.ts`
- [X] T054 [P] Add Railway build config `railway.json` (build `npm ci && npm run build`, pre-deploy `npm run db:migrate`, start `npm run start --workspace apps/api`, health check `/api/health`) and pin Node 20 via `engines` and `.nvmrc`
- [X] T055 [P] Write `docs/v2/deploy-railway.md`: services, environment variables (`DATABASE_URL` for `clinic_app`, `ADMIN_DATABASE_URL` = Railway superuser URL used only for migrations, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `NODE_ENV=production`), Super Admin bootstrap via `railway run`, region and data-residency note, backups and restore procedure
- [ ] T056 With the user's confirmation, create the Railway project, PostgreSQL and app service, set variables, deploy, bootstrap the Super Admin and run quickstart scenarios 1–4 against the staging URL; record results in `docs/v2/PROGRESS.md`
- [ ] T057 Enable Railway PostgreSQL backups, perform one restore into a scratch database, verify row counts and RLS, and record the result and whether storage is encrypted at rest in `docs/v2/deploy-railway.md`

**Checkpoint**: Staging runs the latest US1–US2 build; restore has been tested once.

---

## Phase 5: User Story 3 — Organization admin sets up the clinic and its team (Priority: P1)

**Goal**: Profile, facilities with hours, locale, invitations with roles and facility grants,
activation via setup checks.

**Independent Test**: New admin completes setup, invites a Receptionist limited to one facility,
organization becomes Active, Receptionist only sees that facility.

### Tests for User Story 3

- [X] T058 [P] [US3] `apps/api/test/organizations.test.ts`: settings update validates currency (ISO 4217 list), language, IANA timezone, date format; facility CRUD validates opening hours (`day 0-6`, `HH:MM`, closes > opens, no overlaps) and keeps ≥ 1 active facility; dashboard setup checks report missing items; `POST /activate` → `setup_incomplete` with failing keys, then `active` with audit entry
- [X] T059 [P] [US3] `apps/api/test/staff.test.ts`: invite with roles and `selected` facilities; accepted member's facility scope enforced; assigning a role with a permission the caller lacks → `permission_escalation`; assigning `practitioner` while clinical module off → `module_disabled`

### Implementation for User Story 3

- [X] T060 [US3] Implement `apps/api/src/modules/organizations/settings.service.ts` + controller (`GET/PUT /orgs/:slug/settings`) and `setup-checks.ts` (profile name present; ≥ 1 active facility with address, effective timezone and ≥ 1 opening range; ≥ 1 active admin) and `POST /orgs/:slug/activate`
- [X] T061 [US3] Implement `apps/api/src/modules/organizations/facilities.service.ts` + controller (`GET/POST /orgs/:slug/facilities`, `PUT /orgs/:slug/facilities/:id`) with zod schemas for opening hours
- [X] T062 [US3] Implement `apps/api/src/modules/staff/staff.service.ts` + controller: `GET /orgs/:slug/staff`, `POST /orgs/:slug/invitations`, `PUT /orgs/:slug/staff/:membershipId`, `GET /orgs/:slug/roles` with escalation and module checks; audit each change
- [X] T063 [P] [US3] Web: `apps/web/src/pages/app/settings/OrganizationSettingsPage.tsx` (profile + locale; address uses `VoiceTextField`) and `FacilitiesPage.tsx` with `FacilityDrawer.tsx` and `OpeningHoursEditor.tsx`
- [X] T064 [P] [US3] Web: `apps/web/src/pages/app/settings/StaffPage.tsx` (members and pending invitations tables, masked identifiers) and `InviteStaffDialog.tsx` (roles, facility scope, one-time link with copy/WhatsApp), `RolesPage.tsx` (read-only permissions per role)
- [X] T065 [US3] Extend `apps/api/test/isolation.test.ts` to every US3 route (settings, facilities, staff, invitations, roles, activate)
- [X] T066 [US3] Web: complete `DashboardPage.tsx` setup checklist with links and Activate button; show organization status badge

**Checkpoint**: P1 scope (US1–US3) complete: a real organization can be onboarded and staffed.

---

## Phase 6: User Story 4 — Admin manages staff lifecycle securely (Priority: P2)

**Goal**: Revoke/reissue invitations, change roles/grants, reset passwords, deactivate with
immediate effect, last-admin protection.

**Independent Test**: Deactivate a signed-in Receptionist → next request fails; reset a password
→ old fails, link works once.

### Tests for User Story 4

- [X] T067 [P] [US4] Extend `apps/api/test/staff.test.ts`: revoke → link invalid; reissue → old link invalid, new works; deactivate → that person's sessions in this org revoked (next request fails) but other-org sessions survive; reactivate; last active admin cannot be deactivated or lose `tenant_admin` (`last_admin`); reset → all sessions revoked, link 24 h single-use, old password fails
- [X] T068 [P] [US4] `apps/api/test/resets.test.ts`: `POST /password-resets/complete` validates length ≥ 10, expiry, single use, rate limit; Super Admin reset for an org admin

### Implementation for User Story 4

- [X] T069 [US4] Implement in `apps/api/src/modules/staff/staff.service.ts` + controller: revoke/reissue invitation, deactivate/reactivate membership (with `session_revoke_person(person, reason, org)`), last-admin guard
- [X] T070 [US4] Implement `apps/api/src/modules/staff/resets.service.ts` + controllers `POST /orgs/:slug/staff/:membershipId/reset-password`, `POST /platform/organizations/:id/admins/:membershipId/reset-password`, `POST /password-resets/complete`
- [X] T071 [US4] Extend `apps/api/test/isolation.test.ts` to every US4 route (revoke, reissue, deactivate, reactivate, reset)
- [X] T072 [P] [US4] Web: staff row actions (change access drawer, deactivate/reactivate with `ConfirmDialog`, reset password dialog with one-time link) in `apps/web/src/pages/app/settings/StaffPage.tsx`; `apps/web/src/pages/auth/ResetPage.tsx` (token from fragment)

**Checkpoint**: Offboarding and resets satisfy SC-004.

---

## Phase 7: User Story 5 — Super Admin manages organization lifecycle and modules (Priority: P2)

**Goal**: Suspend, reactivate, deactivate, activate; per-organization module switches.

**Independent Test**: Suspend while a member is signed in → blocked; reactivate → data intact.

### Tests for User Story 5

- [X] T073 [P] [US5] Extend `apps/api/test/platform.test.ts`: suspend requires reason, revokes org sessions, returns `organization_suspended` to members, keeps data; reactivate restores `suspended_from`; deactivate only from suspended; invalid transitions refused; module switch accepts only `KNOWN_MODULES`; practitioner assignable only while `clinical` is on; organization list exposes no patient fields; every action writes a platform audit entry

### Implementation for User Story 5

- [X] T074 [US5] Implement `apps/api/src/modules/platform/lifecycle.service.ts` + routes `POST /platform/organizations/:id/status`, `PUT /platform/organizations/:id/modules`
- [X] T075 [US5] Web: lifecycle actions with reason dialog, status history and module toggles on `apps/web/src/pages/platform/OrganizationDetailPage.tsx`; suspended-organization screen in `apps/web/src/shell/AppShell.tsx` that keeps unsaved form state in place
- [X] T076 [US5] Extend `apps/api/test/isolation.test.ts`: a tenant admin of any organization gets 403/404 on every `/platform/*` route, and a password-level Super Admin session gets `mfa_required`

**Checkpoint**: SaaS operations for v2 §20.6 (initial subset) work.

---

## Phase 8: User Story 6 — Admin reviews the audit trail (Priority: P3)

**Goal**: Filterable organization and platform audit views.

**Independent Test**: Perform actions, find each with actor/time/target; other org sees none.

### Tests for User Story 6

- [X] T077 [P] [US6] `apps/api/test/audit.test.ts`: filters by date range, actor, action; cursor pagination; org A never sees org B; Receptionist 403; no entry contains tokens, passwords, codes or hashes (scan `details` of all entries produced by the whole suite's flows)

### Implementation for User Story 6

- [X] T078 [US6] Implement `apps/api/src/modules/audit/audit.controller.ts` (`GET /orgs/:slug/audit`) and `GET /platform/audit` in `apps/api/src/modules/platform/platform.controller.ts`
- [X] T079 [US6] Extend `apps/api/test/isolation.test.ts` to both audit routes (cross-organization and non-platform access)
- [X] T080 [P] [US6] Web: `apps/web/src/pages/app/AuditPage.tsx` and `apps/web/src/pages/platform/PlatformAuditPage.tsx` (filter bar, table, readable action labels in en/ur, empty state)

**Checkpoint**: All six stories complete.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T081 Rewrite `apps/api/src/db/seed.ts` demo data per research.md R14 (Super Admin with dev MFA secret, Shifa Health Clinic with two facilities and admin/receptionist(one facility)/finance, City Medical Centre with admin) and `apps/api/src/dev.ts` printing accounts and, when `DEV_PRINT_TOTP=true`, the current code
- [ ] T082 [P] Complete Urdu strings in `apps/web/src/i18n/ur.ts` for every key; check RTL layout of shell, tables, dialogs
- [ ] T083 [P] Accessibility pass: focus order, visible focus ring, labels, `aria-live` for form errors and toasts, contrast check of token pairs (WCAG 2.2 AA) documented in `apps/web/src/design/README.md`
- [ ] T084 [P] Responsive pass at 375, 768, 1280 px for every page (no horizontal scroll; tables become stacked rows on phones)
- [ ] T085 Security review of the diff: no tokens in URLs/logs, cookie flags, rate limits on public routes, `security definer` functions have fixed `search_path` and minimal grants; record results in `specs/001-platform-tenant-foundation/checklists/security.md`
- [X] T086 [P] Update `README.md` (v2 overview, roles, quick start, bootstrap command, demo accounts, limitations) and `docs/v2/PROGRESS.md`
- [ ] T087 Run all gates (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) and walk through quickstart.md scenarios 1–8 in the browser, recording results and measured task times for SC-001/SC-002 in `docs/v2/PROGRESS.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup** → no dependencies.
- **Phase 2 Foundational** → after Setup; blocks every story.
- **US1 (Phase 3)** → after Foundational.
- **US2 (Phase 4)** → after Foundational; its tests use the US1 sign-in path, so build after US1.
- **US3 (Phase 5)** → after US2 (needs shell and context); uses invitation code from US1.
- **Phase 4b staging** → after US2; can run alongside US3. T056 needs the user's confirmation.
- **US4 (Phase 6)** → after US3 (staff page).
- **US5 (Phase 7)** → after US1 (platform detail page); independent of US3/US4.
- **US6 (Phase 8)** → after Foundational audit service; best after US3–US5 so there is data.
- **Polish (Phase 9)** → after all stories.

### Within each story

Tests first (they must fail), then services, controllers, then web pages; commit after each
logical group with all gates passing.

### Parallel opportunities

- Setup: T006, T007 alongside T005.
- Foundational: T016, T017, T018, T024 and web T027–T030 in parallel once T009–T015 exist.
- US1: tests T033–T035 together; web T041, T042 together.
- US2: T044–T046 together; T049 alongside API work.
- US3: T058, T059 together; T063, T064 together.
- US5 can run in parallel with US3/US4 (different files) once US1 is done.
- Polish: T082, T083, T084, T086 together.

## Parallel Example: User Story 1

```bash
Task: "mfa.test.ts in apps/api/test/mfa.test.ts"
Task: "platform.test.ts in apps/api/test/platform.test.ts"
Task: "invitations.test.ts in apps/api/test/invitations.test.ts"
Task: "LoginPage/MfaEnrollPage/MfaVerifyPage in apps/web/src/pages/auth/"
Task: "PlatformShell and OrganizationsPage in apps/web/src/"
```

## Implementation Strategy

### MVP first

1. Phases 1–2 (setup, foundation).
2. Phase 3 (US1): a Super Admin can onboard an organization and its first admin. Stop and check.
3. Phases 4–5 (US2, US3): the organization can be set up, staffed and activated — this is the
   minimum needed before feature 002 (patients, appointments, billing) can be built on top.

### Incremental delivery

US4 and US5 harden operations (required before any external clinic per constitution); US6 adds
audit views; Polish finishes demo data, accessibility, docs and the browser walkthrough.

## Notes

- `[P]` = different files, no dependency on unfinished tasks.
- Every commit keeps typecheck, lint, tests and build green (Principle VI).
- The isolation suite (T045) is extended in every story for new routes.
