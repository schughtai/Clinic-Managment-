# Implementation Plan: v2 Administrative Clinic MVP (002)

**Branch**: `claude/hi-clinic-management-5cbc61` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

## Summary

Build the administrative clinic workflows on the 001 foundation: patients and patient-reported
history with provenance, voice input, practitioners and schedules, appointments and a double-booking
safe queue, service pricing, invoices, payments and refunds with idempotency and approvals, day
closing, role dashboards, reports with CSV export, WhatsApp click-to-send reminders, documents with
short-lived downloads, consent, CSV import and full export. The clinical gate is built now and
enforced by a route decorator; clinical features come in 1B.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 20.10+
**Primary Dependencies**: as 001 (NestJS 11, pg, zod, React 19, Vite 6, TanStack Query). New: none; CSV parsing reuses v1's tested `csv.ts`; magic-number sniffing is a small local function.
**Storage**: PostgreSQL with RLS (organization and facility policies), `btree_gist` for the appointment exclusion constraint, `pg_trgm` for name similarity; files on disk under `UPLOAD_DIR` behind a storage interface.
**Testing**: Vitest + supertest on real PostgreSQL; concurrency tests with parallel requests; Vitest + Testing Library for web components.
**Target Platform**: as 001 (Railway staging, one service).
**Performance Goals**: patient search under 300 ms at 50,000 patients per organization (index-backed); slot calculation under 200 ms per practitioner per day.
**Constraints**: money in minor units with currency; no clinical content in logs or audit details; download links 5 minutes; uploads 15 MB.
**Scale/Scope**: about 40 new tables and views, about 70 endpoints, about 15 screens.

## Constitution Check

| Principle | Compliance | Status |
|---|---|---|
| I. Tenant isolation | Every table carries organization_id with RLS; facility-bound tables also carry facility_id with has_facility; attachments and downloads check the requester's grants; isolation suite covers every route | PASS |
| II. Least privilege | New permission codes added to the catalogue; role templates extended; approvals separate from requests; Finance cannot read clinical history | PASS |
| III. Clinical gate | `@Clinical()` guard built and tested now; no clinical routes in 002; history is patient-reported and labelled | PASS |
| IV. Lifecycles and money | Appointment, queue, invoice, payment and refund states independent; minor units with currency; refunds are records; idempotency keys; approvals recorded; audit on every sensitive read and write | PASS |
| V. Modular monolith | Modules `patients`, `history`, `schedule`, `appointments`, `queue`, `billing`, `reports`, `reminders`, `documents`, `data`; one database; no queues | PASS |
| VI. Real engine | Constraint, concurrency and RLS behaviour tested on PostgreSQL | PASS |
| Security and privacy | Downloads signed and short-lived; WhatsApp links carry no clinical details; logs redacted | PASS |

## Project Structure

```text
apps/api/src/modules/
  patients/      patients.service.ts, patients.controller.ts, name-search.ts, merge.service.ts
  history/       history.service.ts, history.controller.ts, history.schemas.ts
  documents/     attachments.service.ts, storage.ts, download-token.ts, magic-numbers.ts
  schedule/      practitioners.service.ts, hours.ts, slots.ts, schedule.controller.ts
  appointments/  appointments.service.ts, appointments.controller.ts, transitions.ts
  queue/         queue.service.ts, queue.controller.ts, transitions.ts
  billing/       services.service.ts, invoices.service.ts, payments.service.ts, refunds.service.ts, approvals.service.ts, day-closing.service.ts, idempotency.ts, money.ts
  reports/       reports.service.ts, reports.controller.ts, csv.ts
  reminders/     reminders.service.ts, templates.ts
  data/          import.service.ts, export.service.ts
  clinical/      clinical.guard.ts (decorator and checks; no routes yet)
apps/api/src/db/migrations/0002_clinic_mvp.sql
apps/api/test/  one file per module plus concurrency.test.ts and isolation002.test.ts
apps/web/src/pages/patients/, pages/schedule/, pages/queue/, pages/billing/, pages/reports/, pages/reminders/, pages/data/
```

**Structure Decision**: modules follow 001's pattern; the `slots.ts` and `money.ts` helpers are pure functions with unit tests; database rules (exclusion, unique keys, check constraints) carry the invariants that must hold under concurrency.

## Delivery order (input for /speckit-tasks)

1. Migration 0002, permission catalogue and role template updates, money and idempotency helpers, clinical guard (tests first).
2. Practitioners, hours, leave, appointment types, slot calculation (pure) with tests.
3. Patients: registration, search, duplicate check, numbers, consent; history with provenance; voice field reuse on history forms.
4. Appointments and queue with exclusion constraint and concurrency tests.
5. Services, invoices, payments, refunds, approvals, day closing with concurrency and totals tests.
6. Dashboards and reports with CSV export; reminders with consent and double-send guard.
7. Documents with download tokens; CSV import preview/commit; full export.
8. Web screens per story; Urdu strings; 375 px checks; isolation suite completed; quickstart walkthrough.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Minor-unit money with a currency column instead of whole rupees (v1 0004) | Constitution IV and spec FR-021 require exact amounts with explicit currency | Whole rupees would need a migration when a second currency is added; the paisa cost is one integer column |
