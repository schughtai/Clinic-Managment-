# Tasks: v2 Administrative Clinic MVP (002)

Format: `- [ ] Txxx [P?] [USn?] description (path)`. Tests come first in each phase. Every
task keeps typecheck, lint, test and build green. Isolation tests extend `apps/api/test/isolation.test.ts`
for each route added.

## Phase 1: Foundation for 002

- [X] T001 Write migration `apps/api/src/db/migrations/0002_clinic_mvp.sql`: `organization_settings_billing`, `facility_sequences`, practitioners and their links, working hours, leave, holidays, appointment types (data-model.md; check constraints as listed)
- [X] T002 Add to `0002_clinic_mvp.sql`: patients, patient_phones, patient_merges, patient_consents, history_entries, history_assessments, attachments, import_batches, message_log, with RLS and indexes (`name_words` GIN, `pg_trgm` on name_key)
- [X] T003 Add to `0002_clinic_mvp.sql`: appointments with `during tstzrange` and the exclusion constraint on `(practitioner_id WITH =, during WITH &&)` for active statuses; appointment_events, queue_tickets (unique per facility/practitioner/day/number), queue_events
- [X] T004 Add to `0002_clinic_mvp.sql`: services, service_prices, invoices (total check), invoice_lines (immutable trigger after issue), payments (no update/delete grants), refunds (no update/delete grants), approval_requests, day_closings
- [X] T005 [P] RLS tests `apps/api/test/rls002.test.ts`: every new org table hides other organizations; facility-bound tables hide ungranted facilities; payments and refunds cannot be updated or deleted by `clinic_app`; invoice lines cannot change after issue
- [X] T006 Extend permission catalogue `apps/api/src/modules/identity/permissions.ts` with the 002 codes (data-model.md) and update the role templates per data-model.md
- [X] T007 [P] Money helpers `apps/api/src/modules/billing/money.ts` (minor units, currency match, percentage discount rounding half-up once, totals never negative) with unit tests `money.test.ts`
- [X] T008 [P] Idempotency helper `apps/api/src/modules/billing/idempotency.ts`: required `Idempotency-Key` header, request hash, replay returns original, same key with different body → 409; tests `idempotency.test.ts`
- [X] T009 Clinical gate `apps/api/src/modules/clinical/clinical.guard.ts` with `@Clinical()` decorator: refuses with 403 `module_disabled` unless the organization has the `clinical` module and the caller holds a Practitioner-role permission set; test on a test-only controller in `clinical-gate.test.ts`
- [ ] T010 Add a `DEMO` seed extension in `apps/api/src/db/seed.ts`: two practitioners, a service list in PKR, patients, appointments for today, one invoice and payment (synthetic only)
- [ ] T011 Register new modules in `apps/api/src/app.module.ts`; make `npm test` green with the migration applied

**Checkpoint**: migration applies; RLS, money, idempotency and clinical-gate tests pass.

## Phase 2: Practitioners, schedules and slots (supports US3)

- [ ] T012 [P] Pure slot calculation `apps/api/src/modules/schedule/slots.ts` (hours, leave, holidays, buffers, timezone of facility) with unit tests `slots.test.ts` covering edges: leave covering a whole day, overlapping hours refused, buffer at day end
- [ ] T013 Practitioners CRUD and facility links `apps/api/src/modules/schedule/practitioners.service.ts` and controller; permission `schedule.read` / `schedule.manage`; audit
- [ ] T014 Weekly hours replacement per practitioner per facility, leave create/delete, holidays, appointment types `apps/api/src/modules/schedule/schedule.service.ts`; validation tests
- [ ] T015 Slot endpoint `GET /facilities/:id/slots` in `schedule.controller.ts` using slots.ts; isolation tests for the new routes added to `isolation.test.ts`

## Phase 3: Patients and history (US1, US2)

- [ ] T016 [P] Name keys and search `apps/api/src/modules/patients/name-search.ts` reusing v1 `name-key.ts`, with tests for Muhammad/Mohammed/Mohamad and Urdu script normalization (`name-search.test.ts`)
- [ ] T017 Patient numbers under a row lock: `apps/api/src/modules/patients/numbering.ts`; test concurrent creation yields unique numbers (`patient-numbers.test.ts`)
- [ ] T018 Patients service: create (duplicate check returns 409 `possible_duplicates` unless confirmed), update (audited changed field names), get, search by number, phone and name; controller `patients.controller.ts`
- [ ] T019 Merge `apps/api/src/modules/patients/merge.service.ts`: moves appointments, invoices, history, attachments; records `patient_merges`; old number resolves to survivor; test
- [ ] T020 Consent service and routes (channels, organization sharing) `apps/api/src/modules/patients/consent.service.ts`
- [ ] T021 History: typed content validation per section (`history.schemas.ts`), insert-only entries, supersede on correction, review, assessment states; tests that no update path exists and that "not assessed" is shown for untouched sections (`history.test.ts`)
- [ ] T022 Patient screens `apps/web/src/pages/patients/PatientsPage.tsx`, `NewPatientPage.tsx`, `PatientPage.tsx` with search, duplicate warning, identity banner, allergy banner (icon and text), history sections with assessment states; `VoiceTextField` on every free-text field
- [ ] T023 [P] Web tests: duplicate warning shows; voice field fills without saving; Finance user does not see history section

## Phase 4: Appointments, queue and walk-ins (US3)

- [ ] T024 Appointment transitions `apps/api/src/modules/appointments/transitions.ts` (unit tests) and service: book (409 `slot_taken` with refreshed slots), reschedule keeping history, cancel with reason, status changes; each recorded in `appointment_events`
- [ ] T025 Concurrency test `apps/api/test/concurrency.test.ts`: two parallel bookings for the same slot → exactly one succeeds; 20 parallel bookings for one practitioner → no overlaps
- [ ] T026 Queue tickets `apps/api/src/modules/queue/queue.service.ts`: next number under lock per practitioner/facility/day; walk-ins; check-in from appointment; transitions with audit; display endpoint without full names
- [ ] T027 Queue concurrency test: 30 parallel ticket requests give 30 distinct numbers
- [ ] T028 Appointment and queue screens `apps/web/src/pages/schedule/`, `apps/web/src/pages/queue/` with day calendar, free slots, walk-in button, queue actions with actor names, waiting-room display view
- [ ] T029 Isolation tests for appointment and queue routes

## Phase 5: Billing and finance (US4)

- [ ] T030 Services and per-facility prices `apps/api/src/modules/billing/services.service.ts`; new prices affect only new lines (test)
- [ ] T031 Invoices: draft, lines from services, issue with per-facility number under lock, lines locked after issue, void only with no payments or refunds (`invoices.service.ts`, tests)
- [ ] T032 Discounts: within limit applied directly; above limit create `approval_requests` (202 `approval_pending`); self-approval refused (`approvals.service.ts`, tests)
- [ ] T033 Payments `apps/api/src/modules/billing/payments.service.ts`: idempotent via T008, row lock on invoice, overpayment refused, status derived (unpaid/partial/paid), tests including 10 parallel identical requests → one payment
- [ ] T034 Refunds `refunds.service.ts`: linked to payment, cumulative ≤ payment, approval above limit, invoice balance updated; original payment unchanged (test)
- [ ] T035 Day closing `day-closing.service.ts`: expected totals by method for facility timezone date, counted cash and difference, lock payments on closed day, reopen with reason and permission (tests with the US4 example figures from quickstart)
- [ ] T036 Receipt view with WhatsApp option (`receipt` endpoint and page)
- [ ] T037 Billing screens `apps/web/src/pages/billing/` (invoice editor, payment dialog with idempotency, refund approval, day closing)
- [ ] T038 Isolation tests for billing routes; finance cannot alter signed or closed records

## Phase 6: Dashboards, reports and reminders (US5, US6)

- [ ] T039 Report queries `apps/api/src/modules/reports/reports.service.ts`: appointments, no-shows, waiting time, utilization, revenue, collections by method, outstanding, refunds, discounts; facility and date filters
- [ ] T040 CSV export `csv.ts` with audit entry; `reports.export` permission; test columns and escaping
- [ ] T041 Role dashboards `GET /orgs/:slug/dashboard?role=` sections gated by permission; web dashboards for reception, finance and admin
- [ ] T042 Reminders `apps/api/src/modules/reminders/reminders.service.ts`: lists for tomorrow's appointments, due follow-ups, balances; consent filter; WhatsApp link generation with templates (English and Urdu); `mark-sent` with unique guard (409 `already_sent`) (tests)
- [ ] T043 Reminder screen `apps/web/src/pages/reminders/` with open-link and mark-sent actions
- [ ] T044 Isolation tests for report and reminder routes; receptionist 403 on financial reports

## Phase 7: Documents, import and export (US7, US8)

- [ ] T045 Storage interface and local disk adapter `apps/api/src/modules/documents/storage.ts`; file size ≤ 15 MB; magic-number check (`magic-numbers.ts`) with tests rejecting a renamed executable
- [ ] T046 Download tokens `download-token.ts`: HMAC over attachment, organization, requester and expiry (5 minutes); re-check permission on download; tests for expiry, wrong user, wrong organization
- [ ] T047 Attachment routes and web upload/list in `PatientPage.tsx`
- [ ] T048 Patient CSV import: preview (row errors, duplicate candidates) and commit (accepted rows only, one transaction); reuse v1 `csv.ts` moved to `apps/api/src/common/csv.ts`; tests on the 200-row example with 5 bad rows and 3 duplicates
- [ ] T049 Full export `export.service.ts`: organization-only data, short-lived link, audited; test that another organization's data never appears
- [ ] T050 Import and export screens `apps/web/src/pages/data/`

## Phase 8: Polish and acceptance

- [ ] T051 Urdu strings for every new screen (`apps/web/src/i18n/ur.ts`); native review noted in docs
- [ ] T052 Accessibility and 375 px pass for every new page; contrast check for any new colour
- [ ] T053 Complete `isolation.test.ts` for every route in `contracts/api.md`
- [ ] T054 Run the quickstart walkthrough on staging; record results and measured times (SC-001, SC-002) in `docs/v2/PROGRESS.md`
- [ ] T055 Update README and security checklist for 002 (`specs/002-v2-clinic-mvp/checklists/security.md`)
