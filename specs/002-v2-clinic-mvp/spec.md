# Feature Specification: v2 Administrative Clinic MVP (Phase 1A)

**Feature Branch**: `002-v2-clinic-mvp`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "v2 doc" — implement the initial release described in
`docs/v2/clinic_management_app_hospital_ready.md` (sections 2, 4.2, 4.3, 4.6, 4.9, 5–8, 9 Phase 1A,
14 Epics 2, 3, 6, 8, 16–21), keeping voice input as requested by the product owner.

**Depends on**: `specs/001-platform-tenant-foundation` (organizations, facilities, sign-in,
memberships, roles and permissions, invitations, audit, web app shell). This spec covers
everything else in the v2 initial release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receptionist finds or registers a patient without creating duplicates (Priority: P1)

At the front desk a Receptionist searches by name, phone number or patient number. Search
tolerates common Roman Urdu spelling variants (Muhammad / Mohammed / Mohamad) and Urdu script. If
the patient is not found they register them: name, date of birth or approximate age, sex, phone,
address and emergency contact. Before saving, the system shows possible duplicates and the
Receptionist must either pick an existing record or confirm "this is a new person". Each new
patient receives a patient number unique within the organization.

**Why this priority**: Every other workflow (appointments, queue, billing) starts from a correct
patient record.

**Independent Test**: Register "Mohammed Ali, 0300 1234567", then search "Muhammad Ali" and the
phone number; both find the record. Registering the same name and phone again shows a duplicate
warning.

**Acceptance Scenarios**:

1. **Given** a patient "Muhammad Ali", **When** the Receptionist searches "mohamad ali", **Then** the
   patient is in the results with patient number, age and masked phone to tell similar people apart.
2. **Given** a new registration matching an existing patient's phone and similar name, **When** the
   Receptionist saves, **Then** the possible duplicate is shown and saving needs an explicit choice.
3. **Given** two branches of one organization, **When** a patient registered at branch A visits
   branch B, **Then** staff with access to B find the same patient record (one record per
   organization, v2 §20.3).
4. **Given** a patient in organization X, **When** a user of organization Y searches the same phone,
   **Then** nothing is found.
5. **Given** an admin with merge permission and two records for one person, **When** they merge
   them, **Then** appointments, history, documents and invoices move to the surviving record, the
   other is marked merged with a link, and the merge is audited.

---

### User Story 2 - Patient-reported history with provenance and voice input (Priority: P1)

During registration or check-in the Receptionist records history the patient reports: allergies
(substance, reaction, severity), chronic conditions, past surgeries, current medicines and family
history. Each entry is labelled "patient-reported" (or "reported by representative", "imported")
with who recorded it and when. Every section shows one of: not assessed, unknown, patient reports
none, or the entries. Any free-text field can be filled by speaking, in English or Urdu, and the
transcript can be edited before saving.

**Why this priority**: v2 makes patient-reported history part of the administrative release, and
the product owner requires voice input.

**Independent Test**: Record an allergy by voice, mark "no chronic conditions" as patient reports
none, leave surgeries untouched, and confirm the profile shows the allergy as patient-reported with
author and time, conditions as "patient reports none", and surgeries as "not assessed".

**Acceptance Scenarios**:

1. **Given** a new patient, **When** their profile opens, **Then** every history section shows "Not
   assessed" — never "None" or "No known allergies".
2. **Given** the Receptionist taps the microphone on an allergy reaction field and speaks, **When**
   speech ends, **Then** the text appears in the field for editing and nothing is saved until they
   press Save.
3. **Given** a browser without speech recognition, **When** the field is shown, **Then** the
   microphone is hidden or disabled with a short explanation, and typing still works.
4. **Given** a recorded allergy, **When** it is corrected, **Then** the earlier value is preserved in
   the entry's history with who changed it and when; **When** it was recorded by mistake, **Then** it
   is marked "entered in error" rather than deleted.
5. **Given** an allergy exists, **When** any permitted user opens the patient, **Then** an allergy
   banner is visible with a text label and icon, not colour alone.
6. **Given** the Finance role, **When** a Finance user opens a patient, **Then** they see only the
   identifiers needed for billing, not history.

---

### User Story 3 - Appointments, walk-ins and the live queue (Priority: P1)

The admin sets up practitioners (doctors who are scheduled, without system logins in this release),
their weekly hours per facility, leave days, appointment types with durations and fees, and buffer
time. The Receptionist books, reschedules and cancels appointments in free slots, registers
walk-ins, checks patients in and gets a queue number, then moves them through waiting → called →
in consultation → completed, or marks missed / no-show.

**Why this priority**: Booking and queueing is the core daily front-desk job.

**Independent Test**: Configure one practitioner 09:00–13:00 with 15-minute appointments, book
two patients, try to double-book 09:15 from two browsers at once (one fails), check one in, walk
in another, and move both through the queue.

**Acceptance Scenarios**:

1. **Given** a practitioner's hours, leave and existing bookings, **When** the Receptionist picks a
   date, **Then** only free slots (respecting duration and buffer) are offered.
2. **Given** two staff booking the same slot simultaneously, **When** both save, **Then** exactly one
   succeeds and the other sees "slot just taken" with refreshed availability.
3. **Given** a booked appointment, **When** the patient arrives and is checked in, **Then** the
   appointment becomes Checked-in and a queue ticket number for that practitioner and day is issued.
4. **Given** a walk-in, **When** registered, **Then** a queue ticket is issued without an appointment
   slot.
5. **Given** each queue change, **When** it happens, **Then** the new status, time and staff member are
   recorded.
6. **Given** a waiting-room display screen, **When** it shows the queue, **Then** it shows ticket
   numbers and, only if the organization enables it, first names — never full names by default.
7. **Given** an appointment status, **When** it changes, **Then** it uses only: Booked, Confirmed,
   Checked-in, In-progress, Completed, Cancelled, No-show; cancelling needs confirmation and a reason.

---

### User Story 4 - Finance invoices, collects payments and issues refunds (Priority: P1)

The admin or Finance maintains a service price list per facility. Finance (or a Receptionist with
the collection permission) creates an invoice for a patient from listed services, applies an
allowed discount, issues it, records full or partial payments by cash, card, bank transfer or
mobile wallet, and prints or shares a receipt. Refunds are separate linked records with a reason
and approval. At day end, Finance closes the day per facility: expected cash by method versus
counted cash.

**Why this priority**: Billing is the clinic's revenue and part of the four-role release.

**Independent Test**: Invoice consultation PKR 1,500 + dressing PKR 500 with a 10% discount, take
PKR 1,000 cash then PKR 800 by wallet, refund PKR 300, close the day, and check every total.

**Acceptance Scenarios**:

1. **Given** a draft invoice, **When** issued, **Then** it gets the next invoice number in the
   facility's sequence and its lines can no longer change; status follows Draft → Issued →
   Partially paid → Paid, or Void.
2. **Given** an issued invoice with PKR 1,000 due, **When** a payment of PKR 1,200 is entered,
   **Then** it is refused (no overpayment).
3. **Given** the same payment submitted twice by a double click or network retry, **When** both
   arrive, **Then** only one payment is recorded.
4. **Given** a paid invoice, **When** Finance refunds part of it, **Then** a refund record links to
   the original payment with reason and approver, the original payment is unchanged, and the
   invoice's net paid amount and balance reflect the refund.
5. **Given** a discount above the user's approval limit, **When** they apply it, **Then** it is
   refused unless a user with approval permission approves it.
6. **Given** an invoice with no payments, **When** voided with a reason, **Then** it is excluded
   from dues and totals; an invoice with payments cannot be voided until they are fully refunded.
7. **Given** amounts, **When** displayed, **Then** they use the organization currency (PKR by
   default) and are stored exactly, with no rounding drift.

---

### User Story 5 - Role dashboards and reports (Priority: P2)

Each role's dashboard answers "what needs my attention now": the Receptionist sees today's
appointments, waiting patients, next free slots and a walk-in button; Finance sees today's
collections, outstanding balances and unclosed days; the admin sees appointment volume, no-show
rate, collections, outstanding balances and practitioner utilization, per facility or all
facilities. Reports cover appointments and no-shows, waiting time, revenue, collections by method,
outstanding balances, refunds and discounts, and can be exported as CSV by permitted users.

**Why this priority**: Owners decide whether the product is worth paying for based on these.

**Independent Test**: With seeded data for one week, check each dashboard figure against a manual
count and export the revenue report.

**Acceptance Scenarios**:

1. **Given** any dashboard metric, **When** clicked, **Then** it opens the filtered detail list.
2. **Given** a report, **When** viewed, **Then** its period and facility scope are shown.
3. **Given** no data, **When** a report opens, **Then** a helpful empty state is shown, never mock
   figures.
4. **Given** a Receptionist, **When** they try to open financial reports, **Then** access is denied.

---

### User Story 6 - Reminders and follow-ups by WhatsApp click-to-send (Priority: P2)

Staff see lists of tomorrow's appointments, due follow-ups and patients with outstanding balances,
and send each a reminder through a prepared WhatsApp message they open and send themselves.
Reminders respect the patient's contact consent. Each sent reminder is logged so it is not sent
twice by mistake. Message templates are configurable per organization in English and Urdu.

**Why this priority**: Reduces no-shows and unpaid balances; automatic sending is a later release.

**Independent Test**: Book for tomorrow, open reminders, press send, confirm a WhatsApp link opens
with the filled template, and the row shows "sent by X at time"; a patient without consent is not
listed.

**Acceptance Scenarios**:

1. **Given** a patient who declined messages, **When** reminder lists are built, **Then** they are
   excluded and the reason is visible on their profile.
2. **Given** a reminder already marked sent, **When** someone tries again, **Then** they are warned.
3. **Given** a template, **When** a message is prepared, **Then** it contains no clinical details.

---

### User Story 7 - Documents and consent on the patient record (Priority: P3)

Staff upload referral letters, outside lab reports and scans (images or PDF) to a patient's
record, with a type and date. They record consent and privacy preferences (contact by WhatsApp,
SMS, phone; data sharing within the organization). Downloads use short-lived links checked against
the user's permissions.

**Why this priority**: Useful for completeness; the core desk flow works without it.

**Independent Test**: Upload a PDF, open it as an authorized user, copy the download link, and
confirm it no longer works after expiry or for a user of another organization.

**Acceptance Scenarios**:

1. **Given** a file over 15 MB or not an image/PDF, **When** uploaded, **Then** it is refused with a
   clear reason.
2. **Given** a document link, **When** used after 5 minutes or by an unauthorized user, **Then** it
   fails without revealing whether the document exists.

---

### User Story 8 - Data import, export and clinical-module gate (Priority: P3)

The admin imports patients from a CSV (with a preview, validation errors per row and duplicate
checks) and downloads a full export of the organization's data. The clinical module (encounters,
notes, prescriptions, handwriting reading) stays unavailable unless a Super Admin enables it for
the organization; even then, clinical actions require a member holding the Practitioner role. In
this release the gate is enforced and tested; reworked clinical features arrive in Phase 1B.

**Why this priority**: Import speeds onboarding; the gate protects clinical safety.

**Independent Test**: Import a 200-row CSV with 5 bad rows and 3 duplicates and check the report;
call any clinical action as an admin in an organization with the module off and get access denied.

**Acceptance Scenarios**:

1. **Given** an import file, **When** previewed, **Then** valid, invalid and possible-duplicate rows
   are counted and nothing is saved until confirmed.
2. **Given** the clinical module is off, **When** any user (including an admin) attempts a clinical
   action, **Then** it is refused and no clinical navigation is shown.
3. **Given** a full export, **When** requested, **Then** it contains only that organization's data,
   is available through a short-lived link, and the export is audited.

---

### Edge Cases

- A patient without a phone number: registration is allowed; duplicate checks use name, sex and
  date of birth only, and the warning says the check is weaker.
- Date of birth unknown: an approximate age is stored and shown as approximate.
- Practitioner leave is added over existing bookings: the bookings are listed for rescheduling;
  they are not cancelled automatically.
- Facility timezone differs from a user's device: all times show in the facility's timezone with
  the zone indicated.
- Queue tickets restart each day per practitioner and facility.
- A payment succeeds but the receipt fails to print: the payment stands and the receipt can be
  reprinted.
- Day closing after late payments: a closed day can be reopened only by permission, with reason
  and audit; later payments fall into the next open day.
- Refund larger than the remaining refundable amount of a payment: refused.
- Speech recognition mis-hears a drug or allergy name: the user edits the text; nothing from
  speech is saved without the Save action.
- A merged patient's old patient number is searched: the surviving record is found and labelled.

## Requirements *(mandatory)*

### Functional Requirements

**Patient registry**

- **FR-001**: System MUST register patients with name (English and/or Urdu script), sex, date of
  birth or approximate age, phone(s), address, emergency contact and a patient number unique within
  the organization and formatted by organization setting.
- **FR-002**: Patient search MUST match name spelling variants (Roman Urdu phonetic matching), Urdu
  script, phone number and patient number, within the user's organization only.
- **FR-003**: Registration MUST check for possible duplicates (phone plus similar name, or similar
  name plus same date of birth and sex) and require an explicit decision.
- **FR-004**: Patients MUST be shared across facilities of the same organization and never across
  organizations.
- **FR-005**: Users with merge permission MUST be able to merge two patient records with full audit
  and a link from the merged record to the survivor.
- **FR-006**: Demographic fields a role may edit MUST be controlled by permission.

**Patient-reported history**

- **FR-007**: The system MUST store structured history entries for allergies, conditions, past
  surgeries, current medications and family history, each with source, author, recorded time,
  review status (unreviewed in this release) and status (active, resolved, entered in error).
- **FR-008**: Each history section MUST have an assessment state: not assessed, unknown, patient
  reports none, or has entries; "clinician-confirmed none" is reserved for the clinical module.
- **FR-009**: Changes to history entries MUST preserve previous values with author and time;
  deletion is replaced by "entered in error".
- **FR-010**: Allergy information MUST be shown as a labelled banner on the patient header for
  roles allowed to see history.
- **FR-011**: Every free-text field in patient, history, appointment-note and reminder-template
  forms MUST offer voice dictation in English and Urdu where the browser supports it, filling the
  field for review without saving and without storing audio.

**Scheduling and queue**

- **FR-012**: Admins MUST be able to manage practitioners (name, specialty, registration number,
  facilities) as schedulable resources independent of login accounts.
- **FR-013**: Admins MUST be able to set weekly working hours per practitioner per facility, leave
  periods, facility holidays, appointment types (duration, default fee) and buffer time.
- **FR-014**: The system MUST compute free slots from hours, leave, holidays, existing bookings,
  duration and buffer, and MUST guarantee no two active appointments overlap for one practitioner.
- **FR-015**: Staff MUST be able to book, reschedule (keeping a history), cancel (with reason) and
  mark no-show; appointment statuses are Booked, Confirmed, Checked-in, In-progress, Completed,
  Cancelled, No-show.
- **FR-016**: Check-in and walk-in MUST issue a queue ticket numbered per practitioner, facility and
  day; queue statuses are Waiting, Called, In consultation, Completed, Missed; each transition is
  recorded with actor and time.
- **FR-017**: A waiting-room display view MUST show ticket numbers and status, with patient first
  names only if the organization enables it.
- **FR-018**: Follow-up appointments MUST be bookable from a completed appointment and listed as
  due follow-ups.

**Billing and finance**

- **FR-019**: Services MUST have a code, name, price per facility and active flag; price changes
  apply only to new invoice lines.
- **FR-020**: Invoices MUST have lines from services (price editable only with permission), an
  invoice-level or line discount, optional tax per organization setting, and statuses Draft,
  Issued, Partially paid, Paid, Void; issued invoices receive a sequential number per facility.
- **FR-021**: Every amount MUST be kept exactly, in the smallest unit of its currency and together
  with the currency, and totals MUST always equal the sum of lines minus discounts plus tax.
- **FR-022**: Payments MUST record method (cash, card, bank transfer, mobile wallet, other),
  amount, reference, receiver and time, MUST NOT exceed the balance, and MUST be idempotent per
  client request.
- **FR-023**: Refunds MUST be separate records linked to a payment, with reason, requester and
  approver; total refunds per payment MUST NOT exceed the payment; payment records are never edited.
- **FR-024**: Discounts and refunds above a role's configured limit MUST require approval by a user
  with approval permission, and the approver MUST be recorded.
- **FR-025**: Receipts MUST be printable and shareable by WhatsApp click-to-send without clinical
  details.
- **FR-026**: Day closing per facility MUST show expected totals by method, accept counted cash,
  record the difference and closer, and lock that day's payments; reopening requires permission and
  a reason.

**Dashboards, reports and reminders**

- **FR-027**: Dashboards MUST be role-specific (Receptionist, Finance, Admin) with metrics linking to
  filtered detail views and showing period and facility scope.
- **FR-028**: Reports MUST include appointments by status, no-show rate, average waiting time,
  practitioner utilization, revenue, collections by method, outstanding balances, discounts and
  refunds; permitted users can export them as CSV.
- **FR-029**: Reminder lists MUST cover tomorrow's appointments, due follow-ups and outstanding
  balances, prepare WhatsApp click-to-send messages from organization templates (English/Urdu),
  respect contact consent, and log each send with actor and time.

**Documents, consent, import/export**

- **FR-030**: Staff MUST be able to attach images and PDFs (up to 15 MB) to a patient with type and
  date; downloads MUST use links that expire within 5 minutes and re-check permissions.
- **FR-031**: The system MUST record per-patient consent for contact channels and in-organization
  sharing, with who recorded it and when.
- **FR-032**: Admins MUST be able to import patients from CSV with preview, row errors and
  duplicate checks, and export all organization data; both actions are audited.

**Clinical gate and audit**

- **FR-033**: All clinical actions (encounter notes, diagnoses, prescriptions, clinical orders,
  handwriting reading) MUST be refused unless the clinical module is enabled for the organization
  and the user holds the Practitioner role's permissions; no clinical navigation is shown otherwise.
- **FR-034**: Viewing patient history, documents and exports, and all changes to patients,
  appointments, invoices, payments, refunds, discounts and day closings MUST be audited without
  storing clinical content in the audit entry.
- **FR-035**: Every screen MUST meet the v2 UX acceptance criteria (§17.17), work at phone, tablet
  and desktop widths, and be available in English and Urdu.

### Key Entities

- **Patient**: long-lived identity within an organization; demographics, patient number, merge link.
- **Patient identifier**: additional numbers (e.g. national ID) with issuing type, optional.
- **History section state**: per patient and section, the assessment state.
- **History entry** (allergy, condition, surgery, medication statement, family history): structured
  content, source, author, recorded time, status, review status, revisions.
- **Consent**: channel and sharing preferences with recorder and time.
- **Attachment**: patient document with type, date, uploader, stored privately.
- **Practitioner**: schedulable doctor profile, optionally linked to a member later.
- **Working hours, leave, holiday, appointment type**: scheduling rules.
- **Appointment**: booking with status history; separate from any future encounter.
- **Queue ticket**: per practitioner, facility and day, with status transitions.
- **Service**: billable item with per-facility price.
- **Invoice / invoice line**: billable services with status and number.
- **Payment, refund, approval**: separate linked financial records.
- **Day closing**: per facility and day.
- **Reminder log and message template**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Receptionist can find an existing patient using a misspelt Roman Urdu name in under
  10 seconds, and register a new patient with history in under 3 minutes.
- **SC-002**: Booking an appointment for a known patient takes under 30 seconds.
- **SC-003**: In concurrency tests, 0 double bookings and 0 duplicate payments occur.
- **SC-004**: Invoice, payment, refund and day-closing totals match a manual calculation in 100% of
  test cases.
- **SC-005**: 100% of isolation tests pass for patients, history, documents, appointments, invoices,
  reports, exports and reminder lists across organizations and ungranted facilities.
- **SC-006**: No patient profile ever shows "none" for a history section that was not assessed.
- **SC-007**: In a pilot clinic, front-desk staff complete a full day (registration, booking,
  queue, billing, closing) without paper fallbacks.

## Assumptions

- Feature 001 is delivered first; this feature uses its organizations, facilities, permissions,
  audit and web app shell.
- Practitioners have no login in this release; the Doctor / Practitioner role and clinical
  workflows (encounters, signing, prescriptions, orders) are Phase 1B and will be specified
  separately; v1 clinical code is kept but unreachable unless the gate allows it.
- Patient portal, lab orders, pharmacy, automatic messaging, online payment gateways and insurance
  are out of scope (v2 Phase 2+).
- Card and wallet payments are recorded manually; no gateway integration yet.
- Tax defaults to none for Pakistan clinics and is configurable.
- Patient numbers default to a facility-independent sequence per organization (e.g. P-000123).
- Voice dictation uses the browser's built-in speech recognition, which may send audio to the
  browser vendor; the organization is told this before staff use it.
- Hosting, backups, monitoring and restore tests are operational work tracked alongside this
  feature, as required by the constitution before the first external organization.
