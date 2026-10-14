# Data Model: v2 Administrative Clinic MVP (002)

Migration `0002_clinic_mvp.sql`. Conventions from 001: `organization_id` on every table with RLS
`organization_id = current_org()` (plus `or is_platform()` never added here); tables bound to a
branch also carry `facility_id` with `has_facility(facility_id)` in the select policy. Money columns
are `amount_minor bigint` with `currency char(3)`. Every write is audited.

## Practitioners and schedules (org-owned; facility-bound rows carry facility_id)

| Table | Key fields and rules |
|---|---|
| `practitioners` | id, organization_id, name 1–120, specialty ≤ 80, registration_no ≤ 40 (nullable), person_id null (1B link), active. |
| `practitioner_facilities` | practitioner_id, facility_id, organization_id; composite FKs. |
| `working_hours` | organization_id, facility_id, practitioner_id, day 0–6, opens, closes (closes > opens), valid_from, valid_to null. Overlapping ranges on the same day refused. |
| `leave_periods` | practitioner_id, starts_at, ends_at (ends > starts), reason ≤ 200. |
| `facility_holidays` | facility_id, on_date unique per facility, name. |
| `appointment_types` | organization_id, name, duration_minutes 5–240, buffer_minutes 0–60, default_fee_minor ≥ 0, currency. |

## Patients (org-owned; visible across branches of the organization)

| Table | Key fields and rules |
|---|---|
| `organization_settings_billing` | organization_id pk, patient_prefix text default 'P-', patient_seq bigint default 0, invoice_seq per facility in `facility_sequences`. (Locked on first patient.) |
| `facility_sequences` | organization_id, facility_id, key ('invoice', 'queue:<practitioner>:<day>'), value bigint. |
| `patients` | id, organization_id, patient_number unique per organization, name_en 1–120 (nullable), name_ur ≤ 120 (nullable), name_key text, name_words text[] (GIN), sex in ('female','male','other','unknown'), date_of_birth date null, approximate_age int 0–130 null (exactly one of dob or approximate_age, or neither when unknown), address ≤ 300, emergency_contact_name ≤ 120, emergency_contact_phone (8–15 digits), merged_into uuid null, created_by, created_at. Phone numbers in `patient_phones`. |
| `patient_phones` | patient_id, phone digits 8–15, label ('mobile','home','emergency'), unique (organization_id, phone) where primary. |
| `patient_merges` | from_patient_id unique, into_patient_id, merged_by, merged_at, reason. |
| `patient_consents` | patient_id, channel in ('whatsapp','sms','phone'), granted bool, recorded_by, recorded_at; `sharing_within_organization` as a channel value `'organization_sharing'`. Latest row per channel is current. |
| `history_entries` | patient_id, section in ('allergy','condition','surgery','medication','family'), content jsonb (typed per section, validated), source in ('patient_reported','representative_reported','imported','clinician_recorded'), author_id, recorded_at, status in ('active','resolved','historical','entered_in_error'), review_status in ('unreviewed','reviewed'), reviewed_by null, supersedes_id null (correction chain), created_at. Rows are never updated except review fields; corrections insert a new row that supersedes. |
| `history_assessments` | patient_id, section, state in ('not_assessed','unknown','patient_reports_none','has_entries'), recorded_by, recorded_at; latest per section wins. |
| `attachments` | patient_id, facility_id null, kind in ('referral','lab_report','scan','other'), document_date null, file_name ≤ 200, mime, size_bytes ≤ 15 000 000, sha256, storage_key (unique), uploaded_by, uploaded_at, deleted_at null. |
| `import_batches` | organization_id, status in ('previewed','committed','cancelled'), counts jsonb, errors jsonb (row numbers and messages), created_by, created_at, committed_at. |
| `message_log` | organization_id, facility_id null, patient_id, template key, channel 'whatsapp', kind in ('appointment_reminder','follow_up','balance'), sent_by, marked_at, reference_id. Unique for an open reminder (kind, reference_id) to prevent double send (FR-029). |

## Appointments and queue (facility-bound)

| Table | Key fields and rules |
|---|---|
| `appointments` | id, organization_id, facility_id, practitioner_id, patient_id, appointment_type_id, status in ('booked','confirmed','checked_in','in_progress','completed','cancelled','no_show'), starts_at, ends_at, during tstzrange (starts..ends + buffer), cancel_reason ≤ 200 (required when cancelled), rescheduled_from null, created_by. Exclusion constraint on (practitioner_id WITH =, during WITH &&) WHERE status in the active set. |
| `appointment_events` | appointment_id, from_status, to_status, actor_id, at, reason. |
| `queue_tickets` | id, organization_id, facility_id, practitioner_id, patient_id, appointment_id null, service_day date, number int, status in ('waiting','called','in_consultation','completed','missed'), checked_in_at, called_at, completed_at, created_by. Unique (facility, practitioner, service_day, number). |
| `queue_events` | ticket_id, from_status, to_status, actor_id, at. |

## Billing (facility-bound unless noted)

| Table | Key fields and rules |
|---|---|
| `services` | organization_id, code ≤ 20 unique per org, name 1–120, default_price_minor ≥ 0, currency, active. |
| `service_prices` | service_id, facility_id, price_minor ≥ 0, currency, effective_from (price changes never rewrite issued lines). |
| `invoices` | id, organization_id, facility_id, patient_id, number null until issue (unique per facility), status in ('draft','issued','partially_paid','paid','void'), currency, subtotal_minor, discount_minor ≥ 0, tax_minor ≥ 0, total_minor, paid_minor, balance_minor (= total − paid − refunded net), void_reason, voided_by, issued_at, created_by. Check: total_minor = subtotal − discount + tax ≥ 0. |
| `invoice_lines` | invoice_id, position, service_id null, description ≤ 200, quantity 1–999, unit_price_minor ≥ 0, discount_minor ≥ 0, line_total_minor = quantity × unit − discount ≥ 0. Locked after issue (trigger). |
| `payments` | id, organization_id, facility_id, invoice_id, amount_minor > 0, currency, method in ('cash','card','bank_transfer','mobile_wallet','other'), reference ≤ 80, received_by, received_at, business_date, idempotency_key ≤ 64, request_hash. Unique (organization_id, idempotency_key). Never updated or deleted. |
| `refunds` | id, organization_id, facility_id, payment_id, invoice_id, amount_minor > 0, reason ≤ 300, requested_by, approved_by, approved_at, business_date, idempotency_key, request_hash. Cumulative refunds per payment ≤ payment amount (checked under lock). Never updated. |
| `approval_requests` | id, organization_id, facility_id, kind in ('discount','refund'), target_id, amount_minor, requested_by, approver_id null, status in ('pending','approved','rejected'), decided_at, reason. |
| `day_closings` | organization_id, facility_id, business_date, expected_by_method jsonb, counted_cash_minor, difference_minor, closed_by, closed_at, reopened_at null, reopened_reason, unique (facility_id, business_date) where open. |

## Organization-level permissions added in 002

`patients.read`, `patients.create`, `patients.update`, `patients.merge`, `history.read_summary`,
`history.write`, `history.review`, `documents.read`, `documents.upload`, `consent.manage`,
`schedule.read`, `schedule.manage`, `appointments.read`, `appointments.manage`, `queue.manage`,
`services.manage`, `invoices.read`, `invoices.manage`, `payments.record`, `refunds.request`,
`refunds.approve`, `discounts.approve`, `billing.close_day`, `billing.reopen_day`,
`reports.read`, `reports.export`, `reminders.send`, `data.import`, `data.export`.

Role templates (extend 001's list): Receptionist gets patients.*, history.write (no review),
documents.*, consent.manage, schedule.read, appointments.*, queue.manage, invoices.read, payments.record,
refunds.request, reminders.send, dashboard, facility.read. Finance gets invoices.*, payments.record,
refunds.request/approve (limit configured), discounts.approve, billing.close_day, reports.*,
patients.read (identifiers only; the Finance restriction on clinical history is enforced by not
granting history.read_summary). Admin gets all of the above.

## Clinical module hooks (no tables in 002)

Routes created in 1B are tagged `@Clinical()`. Tables for encounters and notes come in 1B.
