# Clinic Management Platform Constitution

The product reference is `docs/v2/clinic_management_app_hospital_ready.md` (the "v2 document").
The v1 decision records in `docs/v1/decisions` remain background context; where they conflict
with this constitution or the v2 document, this constitution and the v2 document win.

## Core Principles

### I. Tenant Isolation (NON-NEGOTIABLE)

- Every tenant-owned row MUST carry `organization_id`, and `facility_id` where the record belongs
  to a facility.
- Tenant and facility context MUST be resolved from the authenticated user's active membership
  and grants. A client-supplied tenant, facility or resource identifier is never proof of access.
- PostgreSQL row-level security MUST be enabled on every tenant-owned table as defense in depth,
  in addition to checks in application code. The application connects as a non-owner,
  non-superuser role.
- Every new resource, search, export, file download, report and background job MUST ship with
  automated tests proving a user of one organization (or an unauthorized facility) cannot read or
  change it through guessed IDs or modified requests.
- Cache keys, object-storage paths and job payloads MUST carry tenant scope.

Rationale: a cross-tenant leak of patient data is the single most damaging failure this product
can have; two independent layers make one missed filter survivable.

### II. Least-Privilege, Permission-Based Authorization

- Roles are data: named bundles of permissions (for example `patient.read_demographics`,
  `invoice.refund`) assigned to a tenant membership. Code checks permissions, never role names.
- The initial release has exactly four staff role profiles: Super Admin, Clinic / Hospital Admin,
  Receptionist and Finance. New roles MUST be addable by configuration plus permission checks,
  without changing the tenant architecture.
- Super Admin is a platform-level assignment, not a tenant role. It MUST NOT grant routine access
  to patient records; any exceptional support access requires a recorded reason and an audit
  entry.
- The server MUST authorize every request. Hiding a menu item or button is never an
  authorization control. UI visibility MUST follow server-provided permissions.
- Patient portal identities, when built, are a separate model and MUST NOT reuse staff roles.

Rationale: permissions as data let the product grow from clinics to hospitals without rewriting
authorization, and least privilege limits the damage of a compromised account.

### III. Clinical Safety Gate and Record Integrity

- Clinician-authored diagnoses, signed notes, prescriptions and clinical orders MUST be blocked
  unless the organization's clinical module is enabled AND the acting user holds an authorized
  practitioner identity with the matching permission. The clinical module is off by default.
- Existing clinical features (visits, prescriptions, AI handwriting reading, note tidy-up) stay
  in the codebase behind that module switch until they are reworked into the v2 encounter and
  sign-off model.
- Patient history MUST record provenance: source (patient-reported, representative-reported,
  imported, clinician-recorded), author, recorded time and review status. The system MUST
  distinguish "not assessed", "unknown", "patient reports none" and "clinician-confirmed none",
  and MUST NOT display missing data as a negative finding.
- Signed or clinically meaningful data MUST NOT be silently overwritten. Corrections create
  amendments or entered-in-error markers that preserve the original and its audit history.
- AI output MUST NOT be saved without explicit human review and MUST be labelled as AI-assisted.
- Voice dictation (browser speech recognition, English and Urdu) is a supported input method for
  free-text fields in every enabled workflow, including patient-reported history in the
  administrative release. Transcripts are editable before saving; no audio is stored.

Rationale: non-clinical staff must never gain clinical authority by accident, and clinical
records are only trustworthy when their origin and history are visible.

### IV. Separate Lifecycles and Auditable Money

- Appointment, encounter, clinical note, order, invoice, payment and refund each have their own
  status model. A single "visit status" MUST NOT stand in for clinical and financial outcomes.
- Money MUST be stored as integer minor units together with an explicit ISO 4217 currency code.
  No floating point for money anywhere.
- Invoices, payments, payment allocations and refunds are separate records linked by stable IDs.
  A refund or adjustment is a new linked record; a settled payment is never edited in place.
- Payment-related writes and provider callbacks MUST accept idempotency keys. Uncertain provider
  outcomes are verified before any retry.
- Discounts, write-offs and refunds MUST record who approved them.
- Sensitive reads and all sensitive writes MUST be written to the audit log. Audit entries and
  application logs MUST NOT contain patient clinical content.

Rationale: independent lifecycles keep clinical truth and financial truth from corrupting each
other, and auditable money is a precondition for clinics trusting the product.

### V. Simple Modular Monolith, Configurable by Market

- One NestJS + TypeScript REST API composed of explicit domain modules. Each module owns its
  tables and business rules; other modules use its application interfaces, not its tables.
- One PostgreSQL database. One React + Vite single-page web app served as static files.
- No microservices, Redis or message queue until a concrete, documented need exists (for
  example automatic message sending with retries). Introduce a jobs table with idempotency keys
  first.
- Do not add hospital-specific fields to clinic entities before the hospital module that needs
  them; add new entities and modules when required.
- Currency, locale, language, timezone, date format, tax rules, patient-number and national-ID
  formats MUST be configurable per organization. Defaults for the first market are Pakistan:
  PKR, English and Urdu (with right-to-left support), Asia/Karachi, WhatsApp click-to-send.
- Every architecture-level choice is recorded as a decision record in `docs/v2/decisions`.

Rationale: a single deployable is what a small team can operate safely; configurability prevents
Pakistan-specific assumptions from blocking other markets later.

### VI. Tested on the Real Engine

- API tests MUST run against real PostgreSQL (the embedded server in development and CI), because
  row-level security and constraints are part of the design.
- Type check, lint, build and the full test suite MUST pass before a change is committed.
- Business rules for tenancy, permissions, status transitions and money MUST have automated tests.
- Only synthetic data is allowed outside production.

Rationale: emulated databases do not enforce row-level security, so only real-engine tests prove
isolation.

## Security and Privacy Requirements

- Multi-factor authentication is REQUIRED for Super Admin and SHOULD be offered to tenant
  administrators and privileged finance users.
- Invitations MUST be single-use, expiring and stored as hashes. Password reset, session
  revocation and staff offboarding MUST invalidate access promptly.
- Session tokens live in httpOnly, SameSite cookies (Secure in production). No token, password or
  patient data in URLs, query strings, analytics events, notification previews or logs.
- File and export downloads MUST use short-lived, authorized access checks.
- Encryption in transit is required; encryption at rest is required in hosted environments.
- Before the first external organization is activated: cross-tenant and cross-facility tests
  pass, invitation/reset/revocation/offboarding flows are tested, backups exist and a restore has
  been tested, setup needs no manual production data edits, and audit events cover tenant
  lifecycle, role changes, financial adjustments and privileged support access.

## Development Workflow and Quality Gates

- Each feature follows the Spec Kit flow: `/speckit-specify` → (`/speckit-clarify`) →
  `/speckit-plan` → `/speckit-tasks` → (`/speckit-analyze`) → `/speckit-implement`.
- Every plan MUST answer the v2 §21.4 review checklist: data ownership (tenant and facility),
  permissions per action, sensitivity, lifecycle and who changes each state, audit / approval /
  idempotency needs, behaviour on duplicates and partial failure, absence of unnecessary hospital
  assumptions, and defined UX states.
- Screens meet the v2 §17.17 UX acceptance criteria, target WCAG 2.2 AA, use the shared design
  tokens (v2 §17.2) and components, and never convey status by colour alone.
- Commits are small and each leaves the repository passing all gates in Principle VI.

## Governance

- This constitution supersedes other practice documents. The v2 document is the product
  reference; decision records explain how it is applied.
- Amendments are made by pull request that updates this file, states the reason, and bumps the
  version: MAJOR for removing or redefining a principle, MINOR for a new principle or materially
  expanded guidance, PATCH for clarifications.
- Every plan's Constitution Check and every review MUST verify compliance. Any deviation MUST be
  recorded in the plan's Complexity Tracking table with the simpler alternative that was rejected.

**Version**: 1.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14
