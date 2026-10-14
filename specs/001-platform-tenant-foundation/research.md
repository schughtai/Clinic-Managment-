# Research: Platform and Tenant Foundation

All Technical Context items are resolved below. Each entry lists the decision, why, and what was
rejected. The machine runs Node 20.10, which constrains tool versions (v1 decision 0006).

## R1. What to keep from the v1 API

- **Decision**: Keep the infrastructure: `DbService`/`Tx` transaction helpers, SQL migration
  runner with the restricted `clinic_app` role, embedded PostgreSQL dev server and Vitest global
  setup, config loader, pino logging, request-id / access-log / origin-check middleware, helmet,
  throttling, error filter, zod validation helpers, phone and name-key helpers. Replace the
  domain: tenancy, sessions, access guard, users, clinic settings.
- **Rationale**: The infrastructure already satisfies constitution Principles I, V and VI and is
  tested. The domain model is exactly what v2 changes.
- **Alternatives**: Full rewrite (rejected: discards tested security plumbing); in-place
  migration of v1 tables (rejected: user chose a fresh baseline and there is no data to keep).

## R2. What happens to v1 feature modules and the Vue app

- **Decision**: Tag the last v1 commit as `v1-final`. Move v1 API domain modules that 001 does
  not rebuild (patients, appointments, doctors, visits, prescriptions, billing, reports,
  messaging, data import/export, AI, files) and their tests to `legacy/v1-api/`, outside the npm
  workspaces, build, lint and type check. Remove the Vue app; move its voice-input and
  handwriting components' source to `legacy/v1-web/` for porting. Features 002 and 005 port
  pieces from `legacy/` and delete what they replace.
- **Rationale**: Keeping uncompiled v1 modules inside `src` against a schema that no longer
  exists would break type check and tests. Keeping them unreachable but readable satisfies
  constitution III ("stays in the codebase") more strictly than a module switch, because no
  route can reach them at all.
- **Alternatives**: Delete outright and rely on git history (rejected: the porting work in
  002/005 benefits from the files being at hand); keep them compiling against a compatibility
  layer (rejected: large effort for code that will be reworked).

## R3. Sessions: stateless tokens vs. server-side sessions

- **Decision**: Opaque random session token (32 bytes, base64url) in an httpOnly SameSite=Lax
  cookie (Secure in production). The database stores only its SHA-256 hash in `sessions` with
  user, active organization, active facility, MFA level, created/last-seen/expiry and revoked
  time. Every request looks up the session (one indexed query) and the membership state.
- **Rationale**: FR-011 and SC-004 need immediate revocation per session and per person, and
  context (organization, facility) must change without re-signing tokens. A lookup per request is
  already done in v1 (user row check), so cost is unchanged. Removes `@nestjs/jwt`.
- **Alternatives**: Keep JWT + `token_version` (rejected: cannot revoke one device, context
  switching needs new tokens); Redis sessions (rejected: Principle V, no Redis).

## R4. Multi-factor authentication

- **Decision**: TOTP (RFC 6238, SHA-1, 6 digits, 30-second step, ±1 step window) implemented with
  `node:crypto` (HMAC) in ~60 lines with RFC test vectors. Secret: 20 random bytes, shown once as
  an `otpauth://` URI and QR code (QR rendered in the browser with the small `qrcode` package) plus
  base32 text. Stored encrypted with AES-256-GCM using `MFA_ENCRYPTION_KEY` (32 bytes, required in
  production). Replay protection: store the last accepted time step per person and refuse reuse.
  Sign-in becomes two steps: password creates a session at level `password`; platform routes
  require level `mfa`. Ten single-use recovery codes are generated at enrolment (hashed).
- **Rationale**: No SMS or email provider exists; authenticator apps are free and offline. The
  algorithm is small and fully specified, avoiding a dependency for security-critical code that
  we can test against the RFC vectors.
- **Alternatives**: `otplib`/`speakeasy` (rejected: unmaintained or heavier than the need);
  WebAuthn passkeys (rejected for now: more complex enrolment and recovery; good later option).

## R5. Tenant isolation with row-level security

- **Decision**: Each transaction sets `app.org_id`, `app.facility_ids` (comma list or `*` for
  organization-wide access), `app.user_id` and `app.platform` (`on` only for MFA-verified Super
  Admin on platform routes) via `set_config(..., true)`. SQL helper functions `current_org()`,
  `current_user_id()`, `has_facility(uuid)` and `is_platform()` read them. Policies:
  - Organization-owned tables: `organization_id = current_org()`.
  - Facility-owned rows (from 002 on, and facility visibility now): additionally
    `has_facility(facility_id)`.
  - Foundation tables the platform must manage (organizations, facilities, roles, memberships,
    invitations): `... or is_platform()`. Clinical, patient and financial tables in later
    features never get the `is_platform()` clause (FR-018).
  - Global `persons` table: visible to self, platform, or when the person has a membership in
    `current_org()`. Sign-in lookups use narrow `security definer` functions, as in v1.
  - Audit tables are append-only for `clinic_app` (no update/delete grants).
- **Rationale**: Two independent layers (Principle I). Same proven pattern as v1, extended with
  facility scope.
- **Alternatives**: Schema per tenant (rejected in v1 0001); app-only filtering (rejected:
  Principle I).

## R6. Permissions model

- **Decision**: A fixed permission catalogue in code (`permissions.ts`), mirrored by a check
  constraint-free `text[]` on roles validated in the service layer. Roles are rows per
  organization (`roles`), created from templates at organization creation: `tenant_admin`,
  `receptionist`, `finance`, `practitioner` (assignable only when the clinical module is on).
  Membership has many roles (`membership_roles`). Effective permissions = union, computed per
  request with the session lookup. Controllers declare `@Permission('staff.invite')`; platform
  routes declare `@Platform()`; a private route without either is refused (same fail-closed rule
  as v1). Catalogue for 001: `organization.read`, `organization.update`, `facility.read`,
  `facility.manage`, `staff.read`, `staff.invite`, `staff.manage`, `staff.reset_password`,
  `role.read`, `audit.read`, `dashboard.read`. Later features add their own codes.
- **Rationale**: Permissions as data (Principle II) while keeping the code-level list as the
  single source of truth for what exists, so a typo cannot create a phantom permission.
- **Alternatives**: Custom role editor in 001 (deferred: v2 allows starting from templates; the
  data model supports it later); CASL/ABAC library (rejected: unneeded dependency).

## R7. Invitations and password resets

- **Decision**: 32-byte random tokens, base64url, delivered in the URL path fragment
  (`/invite#token`) so they are not sent to servers or logs by the browser; stored as SHA-256.
  Acceptance is a public endpoint taking the token in the JSON body, rate limited, resolved by a
  `security definer` function. Acceptance runs in one transaction with `for update` on the
  invitation row so double acceptance yields exactly one membership. Invitation 72 h, reset 24 h.
  Links are shown once with copy and a `https://wa.me/?text=` click-to-send link (no phone number
  pre-filled unless the invitee's phone is known).
- **Rationale**: FR-019–FR-021; no delivery provider exists.
- **Alternatives**: Query-string tokens (rejected: leak to logs and referrers).

## R8. Organization lifecycle

- **Decision**: `organizations.status` enum with a transition table enforced in the service and a
  trigger that rejects invalid transitions. `suspended_from` keeps the state to return to.
  Provisioning exists only inside the creation transaction (the row is inserted as Provisioning,
  defaults are created, then set to SetupRequired before commit), so a half-created organization
  can never be committed. Suspended/Deactivated organizations: the session check refuses any
  organization-context request with `organization_suspended`.
- **Rationale**: FR-002/FR-003 with a guarantee enforced in the database too.

## R9. Web stack

- **Decision**: React 19 + React Router 7 (library mode, `createBrowserRouter`) + Vite 6 +
  TypeScript, TanStack Query 5 for server state, no UI kit. Styling: one CSS file of design tokens
  (v2 §17.2) as CSS custom properties plus small component CSS modules; logical properties
  (`margin-inline-start`) so Urdu right-to-left works by setting `dir="rtl"`. Fonts: Inter with
  system fallback; Noto Nastaliq Urdu for Urdu text. Icons: inline SVG set (no icon dependency).
  Tests: Vitest + Testing Library + jsdom for components with logic (permission-driven
  navigation, voice input fallback, forms). i18n: typed dictionary objects (`en.ts`, `ur.ts`),
  as in v1.
- **Rationale**: User chose React + Vite. All listed versions support Node 20. TanStack Query gives
  consistent loading/error/empty states (FR-028) with little code.
- **Alternatives**: Next.js (rejected by the user); Redux (unneeded); a component library such as
  MUI (rejected: bundle size and styling conflicts with v2 tokens).

## R10. Voice input component (FR-030)

- **Decision**: Port v1's browser speech-recognition button to a React `VoiceTextField` /
  `useDictation` hook: `SpeechRecognition`/`webkitSpeechRecognition`, languages `en-PK` and
  `ur-PK`, interim results into the field, never auto-saves, hidden with explanation when
  unsupported. Used in 001 on the organization and facility address fields to prove the
  component; 002 uses it everywhere.
- **Rationale**: User requirement; component lands with the design system.

## R11. Super Admin bootstrap

- **Decision**: `npm run platform:create-admin -- --name ... --email ...` (or `--phone`) prompts
  for a password on the terminal, creates the person and platform assignment with the admin
  database URL, and prints that MFA enrolment happens at first sign-in. Refuses if a person with
  that identifier exists unless `--promote` is given. Demo seed creates one Super Admin in
  development only.
- **Rationale**: FR-013.

## R12. Audit

- **Decision**: Two tables, `platform_audit_events` (no organization, visible only with
  `is_platform()`) and `audit_events` (organization-scoped, RLS). Columns: id, time, actor person
  id, actor label snapshot, action code, target type, target id, facility id, request id, and a
  small `details jsonb` restricted by an allow-list per action (no secrets, no clinical text).
  Inserts only; `clinic_app` has no update/delete. Security events (sign-in success/failure,
  lockout) go to the organization log when the organization is known, else to the platform log
  without personal identifiers beyond the person id.
- **Rationale**: FR-023–FR-025, constitution IV.

## R13. Facility timezone and hours

- **Decision**: IANA timezone validated against `Intl.supportedValuesOf('timeZone')`; weekly
  opening hours as `jsonb` array of `{day: 0-6, opens: "HH:MM", closes: "HH:MM"}` (multiple
  ranges per day allowed, closes > opens, no overlap), validated by zod.
- **Rationale**: Enough for setup checks; scheduling in 002 uses practitioner hours separately.

## R14. Development runner and demo data

- **Decision**: Keep `npm run dev` (embedded PostgreSQL + API + Vite). New demo seed: Super Admin
  (development MFA secret printed in the console), organization "Shifa Health Clinic" with two
  facilities, an admin, a receptionist limited to one facility and a finance user; a second
  organization "City Medical Centre" with one admin, for isolation checks. All synthetic.
