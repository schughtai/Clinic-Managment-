# 0007: Organizations, facilities and global identities

Status: accepted · 14 October 2026 · supersedes the tenancy parts of v1 0001 and 0002

## Context

v2 (§18) needs a platform that hosts many organizations, each with one or more facilities, and
people who may work for more than one organization. v1 had one `clinics` table and users that
belonged to exactly one clinic with a fixed role.

## Decision

- Platform → Organization (tenant) → Facility. Every organization-owned row carries
  `organization_id`; facility-owned rows also carry `facility_id`.
- A person has one login identity (`persons`) and a membership per organization. Memberships hold
  roles and either organization-wide or selected facility access.
- Roles are rows per organization holding permission codes. The list of codes that exist lives in
  code (`modules/identity/permissions.ts`), so roles cannot reference phantom permissions.
- Super Admin is a separate platform assignment (`platform_admins`), never a tenant role, and it
  grants no access to patient, clinical or financial tables.
- Every transaction sets `app.org_id`, `app.facility_ids`, `app.person_id` and `app.platform`;
  row-level security policies read them. Only foundation tables (organizations, facilities,
  roles, memberships, invitations) allow platform access.

## Consequences

- New tenant tables must add the organization policy and isolation tests (constitution I).
- Patient numbers and invoice numbers are per organization (each clinic business numbers its own).
