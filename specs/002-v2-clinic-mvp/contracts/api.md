# API Contract: 002 Administrative Clinic MVP

Base `/api`. Organization routes are `/api/orgs/:slug/...` and follow 001's rules: access by
permission, facility scope from the session context, unknown or ungranted resources return 404,
suspended organizations return 403. Money is `{ "amountMinor": 12345, "currency": "PKR" }`.
Writes that move money require an `Idempotency-Key` header (missing → 400 `idempotency_required`).

## Patients

| Method & path | Permission | Notes |
|---|---|---|
| GET /patients?q=&facility= | patients.read | Spelling-tolerant; matches number, phone, name keys. Returns number, name, age, masked phone. |
| POST /patients | patients.create | Body: names, sex, dob or approximateAge, phones, address, emergency. Response 409 `possible_duplicates` with candidates unless `confirmNew: true`. |
| GET /patients/:id | patients.read | Identity and summary; history only with history.read_summary. |
| PUT /patients/:id | patients.update | Demographics. Edits are audited with changed field names. |
| POST /patients/:id/merge | patients.merge | `{ intoPatientId, reason }`. Moves appointments, invoices, history, attachments. |
| GET /patients/:id/history | history.read_summary | Entries by section with assessment state per section. |
| POST /patients/:id/history | history.write | `{ section, content, source, status, recordedAt }`. Inserts; never updates. |
| POST /patients/:id/history/:entryId/correct | history.write | Inserts a superseding entry; the original is kept. |
| POST /patients/:id/history/:entryId/review | history.review | Marks reviewed. |
| PUT /patients/:id/history/:section/assessment | history.write | `{ state }` among not_assessed, unknown, patient_reports_none, has_entries. |
| GET /patients/:id/consents / PUT /patients/:id/consents | consent.manage | Channels and organization sharing. |
| GET /patients/:id/attachments | documents.read | List. |
| POST /patients/:id/attachments | documents.upload | Multipart; ≤ 15 MB; magic-number check. |
| GET /attachments/:id/download-link | documents.read | Returns a URL valid 5 minutes. |
| GET /attachments/:id/file?token= | (token) | Serves the file if the token is valid, unexpired and the requester still has documents.read. |

## Schedules and appointments

| Method & path | Permission |
|---|---|
| GET/POST /practitioners, PUT /practitioners/:id | schedule.read / schedule.manage |
| PUT /practitioners/:id/hours | schedule.manage (replaces weekly hours for one facility) |
| POST /practitioners/:id/leave, DELETE /leave/:id | schedule.manage |
| GET /facilities/:facilityId/slots?practitioner=&type=&date= | appointments.read. Returns free slots from hours, leave, holidays, existing bookings and buffers. |
| GET/POST /appointment-types | schedule.read / schedule.manage |
| GET /appointments?facility=&date=&practitioner= | appointments.read |
| POST /appointments | appointments.manage. 409 `slot_taken` on conflict with refreshed slots in the body. |
| POST /appointments/:id/reschedule | appointments.manage. Keeps history. |
| POST /appointments/:id/cancel | appointments.manage. `{ reason }` required. |
| POST /appointments/:id/status | appointments.manage. `{ to: 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'no_show' }`. |

## Queue

| Method & path | Permission |
|---|---|
| POST /queue/tickets | queue.manage. `{ patientId, practitionerId, appointmentId? }`. Issues the next number for the day; a walk-in has no appointment. |
| GET /queue?facility=&practitioner=&day= | queue.manage (display view without full names: `GET /queue/display` returns numbers only unless the organization enables first names). |
| POST /queue/tickets/:id/transition | queue.manage. `{ to: 'called' | 'in_consultation' | 'completed' | 'missed' }`. |

## Services and invoices

| Method & path | Permission |
|---|---|
| GET/POST /services, PUT /services/:id | services.manage (read: invoices.read) |
| PUT /services/:id/prices/:facilityId | services.manage. Affects new lines only. |
| GET /invoices?facility=&status=&patient= | invoices.read |
| POST /invoices | invoices.manage. Draft with lines. |
| PUT /invoices/:id | invoices.manage. Draft only. |
| POST /invoices/:id/issue | invoices.manage. Assigns the facility number; locks lines. |
| POST /invoices/:id/discount | invoices.manage. Over the user's limit → 202 `approval_pending` with request id. |
| POST /invoices/:id/void | invoices.manage. `{ reason }`; only with no payments and no refunds. |
| POST /invoices/:id/payments | payments.record. Idempotency-Key required. Body `{ amountMinor, currency, method, reference? }`. Overpayment → 409 `overpayment`. |
| POST /invoices/:id/refunds | refunds.request. Idempotency-Key required. Over limit → approval request. |
| POST /approvals/:id/approve or /reject | discounts.approve / refunds.approve. Cannot approve own request (409 `self_approval`). |
| GET /invoices/:id/receipt | invoices.read. Printable view with WhatsApp link option. |

## Day closing

| Method & path | Permission |
|---|---|
| GET /facilities/:id/day-closings/preview?date= | billing.close_day. Expected totals by method. |
| POST /facilities/:id/day-closings | billing.close_day. `{ date, countedCashMinor }`. Refuses a second close (409 `already_closed`). |
| POST /facilities/:id/day-closings/:id/reopen | billing.reopen_day. `{ reason }`. |

## Dashboards, reports, reminders

| Method & path | Permission |
|---|---|
| GET /orgs/:slug/dashboard?role= | dashboard.read. Sections only for permitted data. |
| GET /reports/appointments, /reports/no-shows, /reports/waiting-time, /reports/utilization | reports.read. `?from=&to=&facility=`. |
| GET /reports/revenue, /reports/collections, /reports/outstanding, /reports/refunds | invoices.read + reports.read. |
| GET /reports/:name.csv | reports.export. Audited. |
| GET /reminders?kind=&date= | reminders.send. Lists exclude patients without WhatsApp consent. |
| POST /reminders/:id/mark-sent | reminders.send. Records the send after the staff member opens the link. 409 `already_sent` on repeat. |

## Import and export

| Method & path | Permission |
|---|---|
| POST /imports/patients/preview | data.import. CSV upload; returns counts, row errors and duplicate candidates. |
| POST /imports/patients/:id/commit | data.import. Writes accepted rows; idempotent on batch id. |
| POST /exports | data.export. Returns a short-lived download link to a CSV bundle (patients, appointments, invoices, payments, refunds). |

## Error codes added

`idempotency_required`, `slot_taken`, `possible_duplicates`, `approval_pending`, `self_approval`,
`overpayment`, `already_closed`, `already_sent`, `invalid_transition`, `file_too_large`,
`file_type_not_allowed`, `link_expired`, `day_closed`.
