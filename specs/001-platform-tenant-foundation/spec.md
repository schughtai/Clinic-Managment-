# Feature Specification: Platform and Tenant Foundation

**Feature Branch**: `001-platform-tenant-foundation`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Platform and tenant foundation for the v2 re-architecture (v2 document sections 4.1, 4.10, 12, 18, 19, 20.3, 20.6, 20.7, 21.1). Platform → Organization → Facilities; global users with memberships, tenant-scoped roles as permission bundles, facility grants; Super Admin with mandatory multi-factor sign-in; Super Admin console for organization lifecycle, first-admin invitation and module switches; tenant admin management of profile, facilities, users, roles, invitations, deactivation, password resets and audit log; login routing to platform or organization workspace with context selection; per-organization locale settings; strict isolation with tests; separate platform and tenant audit; new web app shell with the v2 design system; fresh data baseline."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Super Admin onboards a new clinic organization (Priority: P1)

The platform owner signs in to the Platform Admin Console with a password and a one-time code
from an authenticator app. They create a new organization (a clinic business) with its name, a
short web-address name (slug), its first facility (branch) and its locale settings. The
organization starts in "Setup required". They invite the organization's first administrator and
receive a single-use invitation link to send to that person.

**Why this priority**: Nothing else in the product can be used until an organization exists and
has an administrator. This is the entry point for every customer.

**Independent Test**: With an empty system and one bootstrapped Super Admin, create an
organization, invite an admin, accept the invitation in another browser, and see the admin land in
the new organization's workspace.

**Acceptance Scenarios**:

1. **Given** a Super Admin without multi-factor set up, **When** they sign in the first time,
   **Then** they must enrol an authenticator app before reaching the console.
2. **Given** a signed-in Super Admin, **When** they create an organization with name, slug,
   first facility and defaults, **Then** the organization exists in state "Setup required" with
   one facility, default role templates and locale settings (PKR, English, Asia/Karachi unless
   changed), and a platform audit entry is recorded.
3. **Given** an organization slug already in use, **When** the Super Admin tries to reuse it,
   **Then** creation is refused with a clear message.
4. **Given** an organization, **When** the Super Admin invites a first administrator by name and
   phone or email, **Then** a single-use invitation link valid for 72 hours is shown once for
   copying or sharing by WhatsApp.
5. **Given** a valid invitation link, **When** the invitee opens it and sets a password (or signs
   in with an existing account), **Then** they become a member of that organization with the
   Clinic / Hospital Admin role, and the link no longer works.

---

### User Story 2 - Staff sign in and land in the right workspace (Priority: P1)

Any staff member signs in with phone number or email and password. Super Admins go to the
Platform Admin Console. Organization staff go to their organization's workspace. A person who
belongs to several organizations, or to an organization with several facilities, chooses the
context explicitly. The navigation shows only the modules their permissions allow.

**Why this priority**: Correct routing and permission-driven navigation are the backbone every
later module plugs into.

**Independent Test**: Seed users with different memberships, sign in as each, and confirm the
landing page, visible navigation and blocked pages.

**Acceptance Scenarios**:

1. **Given** a user with one active membership, **When** they sign in, **Then** they land on that
   organization's dashboard at `/app/<slug>/dashboard`.
2. **Given** a user with two active memberships, **When** they sign in, **Then** they choose an
   organization before seeing any organization data.
3. **Given** a Receptionist, **When** they view the sidebar, **Then** settings, user management,
   finance and platform links are absent, and opening those pages directly shows an access-denied
   state with no data.
4. **Given** a user whose membership was deactivated, **When** they make any request with an
   existing session, **Then** access to that organization is refused immediately.
5. **Given** five wrong passwords in a row for one account, **When** a sixth attempt is made,
   **Then** the account is temporarily locked and the attempt is recorded as a security event.

---

### User Story 3 - Organization admin sets up the clinic and its team (Priority: P1)

The Clinic / Hospital Admin completes setup: organization profile, facility details (address,
contact, timezone, opening hours), additional branches, and locale. They invite Receptionist and
Finance staff, assign roles and facility access, and once required setup checks pass, the
organization becomes Active.

**Why this priority**: An organization cannot operate until it has its facility details and staff.

**Independent Test**: As a new admin, complete setup, invite a Receptionist limited to one
facility, and confirm the organization changes to Active and the Receptionist can only choose
that facility.

**Acceptance Scenarios**:

1. **Given** an organization in "Setup required", **When** the admin views the dashboard,
   **Then** a setup checklist lists each missing required item (organization profile, facility
   address, timezone, opening hours) and links to where it is fixed.
2. **Given** all required setup items are complete, **When** the admin confirms, **Then** the
   organization becomes Active and the change is audited.
3. **Given** an admin, **When** they invite a person with the Receptionist role and access to
   facility A only, **Then** after acceptance that person cannot select or see data of facility B.
4. **Given** an admin, **When** they try to assign a role containing a permission they do not
   hold themselves, or a platform permission, **Then** the assignment is refused.
5. **Given** an admin, **When** they add a second facility, **Then** it appears in the facility
   selector for users granted access to it.

---

### User Story 4 - Admin manages staff lifecycle securely (Priority: P2)

The admin sees all staff, pending invitations and their roles. They can resend or revoke an
invitation, change roles and facility access, reset a staff member's password (producing a
single-use reset link), and deactivate a membership when someone leaves. Deactivation ends that
person's access at once.

**Why this priority**: Offboarding and resets are required before any real clinic goes live
(v2 §20.7), but they follow initial setup.

**Independent Test**: Deactivate a signed-in Receptionist and confirm their next request fails;
reset a password and confirm the old one stops working and the link works once.

**Acceptance Scenarios**:

1. **Given** a pending invitation, **When** the admin revokes it, **Then** the link stops working.
2. **Given** an expired invitation, **When** someone opens the link, **Then** they see that it has
   expired and must ask for a new one, with no organization details exposed.
3. **Given** an active staff member, **When** the admin resets their password, **Then** all of that
   person's sessions end and a reset link valid for 24 hours is shown once.
4. **Given** the last active administrator of an organization, **When** someone tries to
   deactivate them or remove their admin role, **Then** the change is refused.

---

### User Story 5 - Super Admin manages organization lifecycle and modules (Priority: P2)

The Super Admin lists organizations with status, facility count, staff count and last activity
(no patient data). They can suspend an organization (staff can no longer use it, data is kept),
reactivate it, and switch optional modules on or off per organization. The clinical module is off
by default.

**Why this priority**: Needed to operate the SaaS safely, but not to onboard the first customer.

**Independent Test**: Suspend an organization while one of its users is signed in, confirm they
are blocked with a "suspended" message, reactivate, and confirm access returns with data intact.

**Acceptance Scenarios**:

1. **Given** an Active organization, **When** the Super Admin suspends it with a reason, **Then**
   its users cannot use any organization workflow, no data is deleted, and a platform audit entry
   records who, when and why.
2. **Given** a Suspended organization, **When** the Super Admin reactivates it, **Then** it returns
   to its previous operational state.
3. **Given** an organization, **When** the Super Admin turns the clinical module on, **Then** the
   module appears as enabled in that organization's settings; clinical screens remain hidden from
   anyone without clinical permissions.
4. **Given** the organization list, **When** the Super Admin views it, **Then** no patient names or
   clinical details are shown.

---

### User Story 6 - Admin reviews the audit trail (Priority: P3)

The admin views the organization's audit log filtered by date, person and action type.
The Super Admin views the separate platform audit log.

**Why this priority**: Required for accountability, used less often than daily workflows.

**Independent Test**: Perform role changes and invitations, then find each in the log with actor,
time and target, and confirm one organization never sees another's entries.

**Acceptance Scenarios**:

1. **Given** actions in organizations A and B, **When** A's admin opens the audit log, **Then** only
   A's entries are visible.
2. **Given** a Receptionist, **When** they try to open the audit log, **Then** access is denied.

---

### Edge Cases

- A person invited to a second organization already has an account: accepting the invitation adds
  a membership; their password is not changed and they must sign in to accept.
- An invitation is accepted twice at the same moment: exactly one acceptance succeeds.
- A user changes a URL to another organization's slug or another facility's identifier: they get
  the same "not found or no access" response as for a non-existent organization, without revealing
  whether it exists.
- A user's last facility grant is removed: they can still sign in but see a "no facility access"
  state until an admin grants one (unless they have organization-wide access).
- An organization is suspended while a staff member is mid-task: their next request fails with a
  suspended message; unsaved work in the browser is not silently discarded.
- A Super Admin loses their authenticator: recovery requires a second Super Admin or a
  documented server-side recovery step; there is no self-service bypass.
- Clocks drift: one-time codes accept one adjacent 30-second window only.
- A Super Admin also needs organization access (for example the product owner runs a clinic): this
  is a separate membership with its own roles; platform status grants no organization data.

## Requirements *(mandatory)*

### Functional Requirements

**Organizations, facilities and lifecycle**

- **FR-001**: System MUST support many organizations; each has a unique slug, display name,
  lifecycle state and locale settings.
- **FR-002**: Organization lifecycle states MUST be Provisioning, SetupRequired, Active, Suspended
  and Deactivated, with only these transitions: Provisioning→SetupRequired (on creation complete),
  SetupRequired→Active (setup checks pass), Active↔Suspended, SetupRequired↔Suspended,
  Suspended→Deactivated, and each transition MUST be audited with actor and reason. Activation
  is done by the organization's admin or by a Super Admin, and only when setup checks pass.
- **FR-003**: Suspended and Deactivated organizations MUST block all organization workflows for
  their members while preserving all data.
- **FR-004**: Each organization MUST have one or more facilities, each with name, type (clinic
  branch for now), address, contact phone, timezone and weekly opening hours.
- **FR-005**: Organization settings MUST include currency (default PKR), default language (English
  or Urdu), timezone (default Asia/Karachi) and date format; facilities MAY override timezone.
- **FR-006**: Setup checks for activation MUST require: organization profile complete (name,
  contact phone and address), at least one facility with address, timezone and opening hours, and
  at least one active administrator.
- **FR-007**: Super Admin MUST be able to switch optional modules on or off per organization; the
  clinical module MUST default to off and only modules that exist may be listed.

**Identity, sessions and sign-in**

- **FR-008**: A person MUST have one login identity, identified by phone number and/or email, with
  a password of at least 10 characters.
- **FR-009**: Sign-in MUST lock an account for 15 minutes after 5 consecutive failures and record
  failed and successful sign-ins as security events.
- **FR-010**: Super Admin sign-in MUST require a time-based one-time code from an authenticator
  app; first sign-in MUST force enrolment; any staff member MAY enrol from their account page,
  after which their sign-in also requires a code.
- **FR-011**: Sessions MUST expire after 12 hours, end on sign-out, and be revoked immediately
  when the password is reset, the membership is deactivated, or the organization is suspended.
- **FR-012**: After sign-in the system MUST route Super Admins to the platform console and other
  users to their organization workspace, asking them to choose when more than one organization or
  facility context is available.
- **FR-013**: A first Super Admin MUST be creatable only by an operator-run server command, never
  through the web interface.

**Memberships, roles and permissions**

- **FR-014**: A membership MUST link one person to one organization with a status (invited,
  active, deactivated), one or more roles, and either organization-wide facility access or a
  list of granted facilities.
- **FR-015**: Roles MUST be named bundles of permissions stored as data; each organization MUST
  receive default roles Clinic / Hospital Admin, Receptionist and Finance at creation, plus a
  Practitioner role that cannot be assigned while the clinical module is off.
- **FR-016**: Every server action MUST check a specific permission in the active organization and
  facility context; navigation MUST be built from the permissions the server reports.
- **FR-017**: An admin MUST NOT be able to grant permissions they do not hold, assign platform
  roles, or remove the last active administrator.
- **FR-018**: Super Admin status MUST be a platform assignment separate from memberships and MUST
  NOT grant access to any organization's patient, clinical or financial records.

**Invitations and resets**

- **FR-019**: Invitations MUST be single-use, expire after 72 hours, be stored only as a secure
  hash, carry the intended roles and facility grants, and be revocable and re-issuable.
- **FR-020**: Admin-initiated password resets MUST produce a single-use link valid 24 hours and end
  the person's existing sessions; a Super Admin can do the same for an organization's admin.
- **FR-021**: The system MUST present invitation and reset links for the inviter to copy or share
  via a WhatsApp click-to-send link; it MUST NOT send them automatically in this feature.

**Isolation and audit**

- **FR-022**: Every organization-owned record MUST be scoped to its organization, and to a
  facility where it belongs to one; access attempts outside the user's scope MUST behave exactly
  like requests for non-existent records.
- **FR-023**: The system MUST record platform audit events (organization lifecycle, module
  switches, Super Admin sign-ins, admin invitations and resets by Super Admin) separately from
  organization audit events (profile and facility changes, invitations, role and grant changes,
  deactivations, resets, sign-ins).
- **FR-024**: Audit entries MUST include actor, time, action, target and organization (for
  organization events), and MUST NOT contain passwords, codes, tokens or patient clinical content.
- **FR-025**: Organization admins MUST be able to filter their audit log by date range, person and
  action; Super Admins MUST be able to filter the platform log the same way.

**Web application**

- **FR-026**: The web app MUST provide a sign-in page, multi-factor enrolment and challenge,
  context selection, Platform Admin Console (organizations list and detail with lifecycle, modules
  and admin invitation, platform audit), and organization workspace with dashboard (setup checklist),
  organization settings, facilities, staff and invitations, roles view, and audit log.
- **FR-027**: The workspace shell MUST have a sidebar listing only permitted modules, a top bar
  with facility selector (when the user has more than one facility), user menu and sign-out, and
  show the active organization and facility at all times.
- **FR-028**: Every screen MUST provide loading, empty, error, validation and access-denied states,
  be operable by keyboard, use the v2 design tokens, and work at phone, tablet and desktop widths.
- **FR-029**: All interface text MUST be available in English and Urdu (right-to-left when Urdu is
  selected); untranslated text falls back to English.
- **FR-030**: Free-text inputs in these screens are short administrative fields; voice dictation
  support is provided as a shared input component so later features can use it on any text field.

### Key Entities

- **Organization**: a customer business (clinic or hospital group); slug, name, lifecycle state,
  locale settings, enabled modules.
- **Facility**: a physical location of an organization; name, type, address, contact, timezone,
  opening hours, active flag.
- **Person (login identity)**: phone and/or email, password, lock state, multi-factor enrolment.
- **Platform assignment**: marks a person as Super Admin.
- **Membership**: a person's belonging to an organization; status, roles, facility access mode.
- **Facility grant**: a membership's access to one facility.
- **Role and Permission**: permission bundles per organization; permissions are fixed codes
  defined by the product (for example `staff.invite`, `organization.settings.update`).
- **Invitation**: pending membership with hashed token, roles, grants, expiry, status.
- **Password reset**: hashed single-use token with expiry.
- **Session**: signed-in device context with expiry and revocation.
- **Platform audit event / Organization audit event**: append-only records of sensitive actions.
- **Module switch**: per-organization enabled flag for optional modules (clinical).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can create an organization and issue the first admin invitation in
  under 3 minutes.
- **SC-002**: A new admin can complete setup and invite two staff members in under 10 minutes
  without help.
- **SC-003**: 100% of automated isolation tests pass: no user can read or change another
  organization's or an ungranted facility's records through any tested route, export or guessed
  identifier.
- **SC-004**: A deactivated, reset or suspended user is blocked on their very next request (0
  requests succeed after the change).
- **SC-005**: Every sensitive action in this feature produces exactly one audit entry with actor,
  time and target, and no entry contains a secret.
- **SC-006**: All screens in this feature meet WCAG 2.2 AA contrast and keyboard checks and render
  without horizontal scrolling at 375 px width.

## Assumptions

- No v1 data needs migrating; the database is rebuilt from a new baseline and demo data is
  regenerated for the new model.
- No email or SMS provider exists yet, so invitation and reset links are shared manually or by
  WhatsApp click-to-send; automatic delivery is a later feature.
- Self-service "forgot password" is out of scope until a delivery channel exists; resets are
  admin-initiated.
- Patients, appointments, billing and clinical modules are rebuilt in later features on top of this
  foundation; until then, their v1 screens are not available in the new web app.
- Subscription plans, billing of organizations and quotas are deferred (v2 §20.6).
- The product owner is the only Super Admin at launch; a second Super Admin is recommended for
  authenticator recovery.
- Opening hours are weekly recurring hours per facility; holidays come with scheduling.
