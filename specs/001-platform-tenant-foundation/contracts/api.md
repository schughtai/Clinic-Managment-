# API Contract: Platform and Tenant Foundation

Base path `/api`. JSON in and out. Session in the `clinic_session` httpOnly cookie. Errors use the
v1 shape `{ "error": { "code", "message", "requestId", "fields"? } }`. Unsafe methods require an
allowed `Origin`. Access markers: **Public**, **Session** (any signed-in person),
**MFA-Platform** (Super Admin with MFA-level session; sets `is_platform()`),
**Perm:code** (active organization context and permission).

Organization-scoped routes live under `/api/orgs/:slug/...`. The server resolves `:slug` only
among the caller's active memberships; an unknown slug and a slug without membership both return
`404 not_found`. Suspended or deactivated organizations return `403 organization_suspended`.

## Auth and session

| Method & path | Access | Body / result |
|---|---|---|
| POST /auth/login | Public, strict rate | `{ identifier, password }` → `{ next: "mfa_enroll" \| "mfa" \| "choose_context" \| "ready", destination? }` |
| POST /auth/mfa/enroll/start | Session (password level, Super Admin) | → `{ otpauthUri, secretBase32 }` (only when not enrolled) |
| POST /auth/mfa/enroll/confirm | same | `{ code }` → `{ recoveryCodes: string[] }` (shown once); session becomes `mfa` |
| POST /auth/mfa/verify | Session (password level) | `{ code }` or `{ recoveryCode }` → `{ next, destination? }` |
| POST /auth/logout | Session | ends current session |
| GET /auth/me | Session | `{ person: {id, displayName, language}, isPlatformAdmin, authLevel, memberships: [{ orgSlug, orgName, orgStatus, roles, facilities: [{id,name}], facilityScope }], context: { orgSlug?, facilityId? }, permissions: string[], modules: string[] }` |
| POST /auth/context | Session | `{ orgSlug, facilityId? }` → same as `/auth/me` |
| POST /auth/change-password | Session, strict rate | `{ currentPassword, newPassword }`; ends other sessions |

`destination` is `/platform` or `/app/<slug>/dashboard`. A Super Admin with memberships chooses
between the platform and organizations on the context screen.

## Invitations and resets (public side)

| Method & path | Access | Body / result |
|---|---|---|
| POST /invitations/lookup | Public, strict rate | `{ token }` → `{ organizationName, inviteeName, roles, needsPassword, expiresAt }` or `410 invitation_invalid` |
| POST /invitations/accept | Public, strict rate | `{ token, password? , displayName? }`; when the identifier already has an account the caller must be signed in as that person → starts session |
| POST /password-resets/complete | Public, strict rate | `{ token, newPassword }` → ok; all sessions of the person were already revoked at issue |

## Platform console (MFA-Platform)

| Method & path | Body / result |
|---|---|
| GET /platform/organizations?status=&q= | list `{ id, slug, name, status, facilityCount, activeStaffCount, lastActivityAt, modules }` |
| POST /platform/organizations | `{ name, slug, currency?, defaultLanguage?, timezone?, dateFormat?, facility: { name, address?, city?, phone?, timezone? } }` → organization detail |
| GET /platform/organizations/:id | detail incl. admins (name, identifier masked), setup checks, status history (from audit) |
| POST /platform/organizations/:id/status | `{ action: "suspend" \| "reactivate" \| "deactivate" \| "activate", reason? }` |
| PUT /platform/organizations/:id/modules | `{ modules: ["clinical"] }` |
| POST /platform/organizations/:id/invitations | first/next admin: `{ inviteeName, phone?, email? }` → `{ link, whatsappUrl, expiresAt }` |
| POST /platform/organizations/:id/admins/:membershipId/reset-password | → `{ link, whatsappUrl, expiresAt }` |
| GET /platform/audit?from=&to=&actor=&action=&org= | paginated platform events |

## Organization workspace

| Method & path | Permission | Body / result |
|---|---|---|
| GET /orgs/:slug/dashboard | dashboard.read | `{ setupChecks: [{ key, ok, link }], status, counts: { facilities, activeStaff, pendingInvitations } }` |
| POST /orgs/:slug/activate | organization.update | activates when checks pass, else `409 setup_incomplete` with failing keys |
| GET /orgs/:slug/settings | organization.read | profile + locale |
| PUT /orgs/:slug/settings | organization.update | `{ name, legalName?, phone?, email?, address?, currency, defaultLanguage, timezone, dateFormat }` |
| GET /orgs/:slug/facilities | facility.read | facilities the caller can see |
| POST /orgs/:slug/facilities | facility.manage | create |
| PUT /orgs/:slug/facilities/:id | facility.manage | update incl. `openingHours`, `active` |
| GET /orgs/:slug/staff | staff.read | members `{ membershipId, name, identifierMasked, roles, facilityScope, facilities, status, lastLoginAt }` + pending invitations |
| POST /orgs/:slug/invitations | staff.invite | `{ inviteeName, phone?, email?, roleIds, facilityScope, facilityIds? }` → `{ link, whatsappUrl, expiresAt }` |
| POST /orgs/:slug/invitations/:id/revoke | staff.invite | |
| POST /orgs/:slug/invitations/:id/reissue | staff.invite | new token, old one invalid → link |
| PUT /orgs/:slug/staff/:membershipId | staff.manage | `{ roleIds, facilityScope, facilityIds? }` |
| POST /orgs/:slug/staff/:membershipId/deactivate | staff.manage | revokes that person's sessions in this org |
| POST /orgs/:slug/staff/:membershipId/reactivate | staff.manage | |
| POST /orgs/:slug/staff/:membershipId/reset-password | staff.reset_password | → `{ link, whatsappUrl, expiresAt }` |
| GET /orgs/:slug/roles | role.read | roles with permissions and `assignable` |
| GET /orgs/:slug/audit?from=&to=&actor=&action=&cursor= | audit.read | paginated events |

Rules enforced on every staff change: cannot grant a permission the caller lacks; cannot assign a
role whose `requires_module` is off; cannot leave the organization without an active admin;
cannot change one's own roles to remove the last admin.

## Error codes added

`mfa_required`, `mfa_invalid`, `mfa_already_enrolled`, `account_locked`, `invitation_invalid`,
`reset_invalid`, `organization_suspended`, `setup_incomplete`, `last_admin`, `permission_escalation`,
`module_disabled`, `slug_taken`, `context_required`.

## Web routes (React)

`/login`, `/login/mfa`, `/login/mfa/enroll`, `/choose`, `/invite` (token in fragment),
`/reset` (token in fragment), `/platform`, `/platform/organizations`,
`/platform/organizations/:id`, `/platform/audit`, `/app/:slug/dashboard`, `/app/:slug/settings`,
`/app/:slug/settings/facilities`, `/app/:slug/settings/staff`, `/app/:slug/settings/roles`,
`/app/:slug/audit`, `/account` (change password).
