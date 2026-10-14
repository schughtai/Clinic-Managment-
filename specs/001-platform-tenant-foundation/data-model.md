# Data Model: Platform and Tenant Foundation

Fresh baseline migration `0001_foundation.sql`. All ids are `uuid` (`gen_random_uuid()`), all
times `timestamptz`. "Org-owned" means the table has `organization_id` and the RLS policy
`organization_id = current_org()`; "+platform" adds `or is_platform()`.

## Session helper functions

| Function | Returns | Source |
|---|---|---|
| `current_org()` | uuid or null | `app.org_id` |
| `current_person()` | uuid or null | `app.person_id` |
| `has_facility(f uuid)` | boolean | `app.facility_ids` is `*` or contains `f` |
| `is_platform()` | boolean | `app.platform = 'on'` |

## persons (global login identity, not org-owned)

| Field | Type | Rules |
|---|---|---|
| id | uuid | PK |
| display_name | text | 1–120 chars |
| phone | text null | digits 8–15, unique when present |
| email | text null | valid email, stored lower-case, unique when present |
| password_hash | text | bcrypt (cost 12) |
| failed_logins | int | ≥ 0 |
| locked_until | timestamptz null | set for 15 min after 5 failures |
| mfa_secret_enc | bytea null | AES-256-GCM ciphertext of TOTP secret |
| mfa_enabled_at | timestamptz null | |
| mfa_last_step | bigint null | last accepted TOTP step (replay guard) |
| preferred_language | text | `en` or `ur` |
| last_login_at, created_at, updated_at | timestamptz | |

Constraint: `phone is not null or email is not null`.
RLS: select/update when `id = current_person()`, `is_platform()`, or a membership row links the
person to `current_org()`. Insert only via security-definer functions (invitation acceptance,
bootstrap). Sign-in lookup via `auth_find_person(identifier)`.

## mfa_recovery_codes

person_id → persons, code_hash text, used_at null. Ten per enrolment. RLS: own person only.

## platform_admins

person_id PK → persons, granted_at, granted_by null. Not readable by `clinic_app` except through
`auth_is_platform_admin(person_id)` (security definer). No insert/update grants for `clinic_app`;
only the bootstrap command (admin URL) writes it.

## organizations (+platform)

| Field | Type | Rules |
|---|---|---|
| id | uuid | PK; RLS uses `id = current_org() or is_platform()` |
| slug | text | `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, unique, reserved words refused (`platform`, `app`, `api`, `login`, `invite`, `reset`) |
| name | text | 1–120 |
| legal_name, phone, email, address | text null | length-limited |
| status | org_status | `provisioning`, `setup_required`, `active`, `suspended`, `deactivated` |
| suspended_from | org_status null | state to restore on reactivation |
| status_reason | text null | last transition reason |
| currency | char(3) | ISO 4217, default `PKR` |
| default_language | text | `en`/`ur`, default `en` |
| timezone | text | IANA, default `Asia/Karachi` |
| date_format | text | `dd/MM/yyyy` (default), `yyyy-MM-dd`, `MM/dd/yyyy` |
| modules | text[] | subset of known modules (`clinical`); default `{}` |
| created_at, updated_at, activated_at | timestamptz | |

State transitions (trigger-enforced; reason required for suspend/deactivate):

```
provisioning → setup_required            (creation transaction only)
setup_required → active                  (setup checks pass; admin or Super Admin)
active → suspended, setup_required → suspended   (Super Admin, reason)
suspended → suspended_from               (Super Admin reactivates)
suspended → deactivated                  (Super Admin, reason)
```

`clinic_app` may insert organizations only through `platform_create_organization(...)`
(security definer, requires `is_platform()`), which also inserts the first facility and the role
templates and leaves status `setup_required`.

## facilities (org-owned +platform; visibility also requires `has_facility(id)` unless platform)

| Field | Type | Rules |
|---|---|---|
| id, organization_id | uuid | |
| name | text | 1–120, unique per organization (case-insensitive) |
| kind | text | `clinic_branch` (hospital kinds later) |
| address, city | text null | ≤ 300 / ≤ 80 |
| phone | text null | digits 8–15 |
| timezone | text null | IANA; null = organization timezone |
| opening_hours | jsonb | array of `{day 0-6, opens HH:MM, closes HH:MM}`; validated in API |
| active | boolean | default true; an organization keeps ≥ 1 active facility |
| created_at, updated_at | timestamptz | |

Setup check "facility complete": at least one active facility with address, effective timezone
and at least one opening-hours range.

## roles (org-owned +platform)

| Field | Type | Rules |
|---|---|---|
| id, organization_id | uuid | |
| key | text | `tenant_admin`, `receptionist`, `finance`, `practitioner`; unique per org |
| name | text | display name |
| permissions | text[] | every element in the code catalogue |
| system | boolean | template roles are system roles (not deletable) |
| requires_module | text null | `clinical` for practitioner |

## memberships (org-owned +platform)

| Field | Type | Rules |
|---|---|---|
| id, organization_id, person_id | uuid | unique (organization_id, person_id) |
| status | text | `active`, `deactivated` (invitations are separate rows) |
| facility_scope | text | `all` or `selected` |
| deactivated_at, deactivated_by | | set together |
| created_at, updated_at | | |

`membership_roles` (membership_id, role_id, organization_id) and `membership_facilities`
(membership_id, facility_id, organization_id) are org-owned join tables; the composite foreign keys
include `organization_id` so a membership can never reference another organization's role or
facility.

Invariant (service + test): each organization in `setup_required` or `active` has ≥ 1 active
membership holding `tenant_admin`.

## invitations (org-owned +platform)

| Field | Type | Rules |
|---|---|---|
| id, organization_id | uuid | |
| token_hash | bytea | SHA-256, unique |
| invitee_name | text | |
| invitee_phone / invitee_email | text null | at least one |
| role_ids | uuid[] | roles of the same organization |
| facility_scope | text | `all` / `selected` |
| facility_ids | uuid[] | when `selected` |
| status | text | `pending`, `accepted`, `revoked` (expired = pending past `expires_at`) |
| expires_at | timestamptz | created + 72 h |
| created_by | uuid | person |
| accepted_by, accepted_at, revoked_at | | |

Public lookup/accept only via `invitation_lookup(hash)` and `invitation_accept(...)`
(security definer); lookup returns organization name and invitee name only when valid.

## password_resets (not org-owned)

id, person_id, token_hash (unique), created_by_person, organization_id null (context of the
admin who issued it), expires_at (24 h), used_at. Issuing ends all of the person's sessions.

## sessions (not org-owned)

| Field | Type | Rules |
|---|---|---|
| id | uuid | |
| token_hash | bytea | SHA-256 of cookie value, unique |
| person_id | uuid | |
| auth_level | text | `password` or `mfa` |
| organization_id | uuid null | active context |
| facility_id | uuid null | active facility |
| created_at, last_seen_at, expires_at | | expires = created + 12 h |
| revoked_at, revoke_reason | | |
| user_agent_hash | text null | coarse device label only |

Accessed only through `session_resolve(hash)`, `session_create(...)`, `session_set_context(...)`,
`session_revoke(...)` security-definer functions. Revocation triggers: sign-out, password reset,
membership deactivation (sessions of that person whose organization is that one), organization
suspension (all sessions with that organization context).

## audit_events (org-owned, append-only)

id, organization_id, occurred_at, actor_person_id null, actor_label, action (e.g.
`staff.invited`), target_type, target_id null, facility_id null, request_id, details jsonb
(allow-listed keys per action). `clinic_app` has insert and select only.

## platform_audit_events (append-only)

Same columns without organization scope, plus `organization_id null` as target context. RLS:
select only when `is_platform()`; insert allowed through `platform_audit(...)` function so that
security events can be written before a platform context exists.

## Permission catalogue (code)

| Code | tenant_admin | receptionist | finance |
|---|---|---|---|
| dashboard.read | ✓ | ✓ | ✓ |
| organization.read | ✓ | ✓ | ✓ |
| organization.update | ✓ | | |
| facility.read | ✓ | ✓ | ✓ |
| facility.manage | ✓ | | |
| staff.read | ✓ | | |
| staff.invite | ✓ | | |
| staff.manage | ✓ | | |
| staff.reset_password | ✓ | | |
| role.read | ✓ | | |
| audit.read | ✓ | | |

Practitioner template carries no 001 permissions; later features extend all templates
(new organizations get the extended templates; a migration updates existing system roles).
