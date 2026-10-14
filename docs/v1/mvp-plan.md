# Clinic Management Platform: MVP Plan

Version 0.1 · 14 October 2026 · Draft for discussion

Companion to `business-document.md`. Sizes (S, M, L) are rough effort guesses for one developer and should be replaced with real numbers after the first build step.

---

## 1. MVP goal

Give a small private clinic a system it can use for a full working day: bookings, patient history, prescriptions, billing and WhatsApp reminders. The MVP is the smallest product that three clinics will pay for.

The MVP is built only after the validation gate in section 8 is passed. Until then, only a clickable demo exists.

## 2. Scope

**In the MVP**

- Many clinics on one system, with separate data per clinic.
- Roles: owner, doctor, receptionist.
- Patient registration and search, including Roman Urdu search.
- Appointments, walk-in tokens and a live queue.
- Doctor schedules and leave.
- WhatsApp confirmations and reminders.
- Consultation notes, vitals and diagnosis.
- Prescription writer with templates, printable and sendable on WhatsApp.
- Visit history.
- Invoices, discounts, partial payments and dues.
- Payment types recorded: cash, bank, JazzCash, Easypaisa.
- Daily cash closing and a basic income report.
- Spreadsheet import of patients.
- Urdu and English screens.
- Audit log, daily backups and data export.

**Not in the MVP**

- Lab and pharmacy modules, which come in phase 2.
- Inpatient, theatre, emergency, radiology and hospital accounts, which come in phase 3.
- Panel and corporate billing, staff commission and expense tracking.
- Online payments, telemedicine, a doctor marketplace, insurance claims and native mobile apps.
- AI diagnosis or treatment advice.

## 3. Users and roles

| Role | Can do | Cannot do |
| --- | --- | --- |
| Owner | Everything in the clinic, including users, prices and reports | See other clinics |
| Doctor | See patients and history, write notes and prescriptions, view own schedule | Change prices or users |
| Receptionist | Register patients, book, bill, send reminders | See clinical notes unless the owner allows it |

## 4. Feature list and build order

Each step ends with something usable. Do them in this order.

| Step | Build | Size | Done when |
| --- | --- | --- | --- |
| 1 | Foundation: repository, database, clinic and user accounts, phone sign-in with one-time code, roles, clinic ID on every table with row-level security, audit log | L | A test proves one clinic cannot read another's data |
| 2 | Patients: registration, search, duplicate warning, history page | M | Receptionist finds a patient in under 10 seconds |
| 3 | Appointments: doctor schedules, booking, walk-in tokens, live queue | M | Booking takes under 30 seconds and blocks times outside working hours |
| 4 | Consultation and prescriptions: notes, vitals, templates, print and PDF | M | A prescription is written and printed in under one minute |
| 5 | Billing: invoices, discounts, partial payments, dues, payment types, daily closing | M | Daily closing matches recorded payments |
| 6 | WhatsApp: provider integration, confirmations, reminders, prescription link, delivery status | M | A reminder sends and its status is visible |
| 7 | Import and onboarding: spreadsheet import, clinic setup checklist, demo data | S | A 500-patient list imports in one session |
| 8 | Owner reports, data export, backups and a tested restore | S | Owner exports all data; a restore works from a backup |
| 9 | Hardening: offline tolerance for refresh and short outages, error monitoring, load check, security review | M | No cross-clinic access in tests; pages survive a refresh mid-entry |
| 10 | Pilot support: bug fixes from the first three clinics | M | Pilot clinics run a full day without paper |

## 5. Technical approach

**Stack.** NestJS backend as one modular app, Nuxt 3 frontend, PostgreSQL, Redis for the message queue, S3-compatible file storage. This reuses the pattern from the existing storyteller repository. Split into separate services only when load or team size demands it.

**Multi-tenancy.** One database, a clinic ID on every table, enforced with row-level security as well as in code. A clinic record holds its plan, enabled modules and settings. Automated tests must fail any attempt to read another clinic's data.

**Sign-in.** Phone number with a one-time code, since not all staff have Google accounts. No tokens in web addresses. Sessions expire.

**Modules.** Core modules: accounts, clinical, billing, messaging. Optional modules for later phases have their own tables and endpoints and are hidden for clinics that have not enabled them.

**Messaging.** Use an official WhatsApp business provider. Confirm cost per message in Pakistan and the approval time before fixing the Clinic plan price. Provide a click-to-send fallback.

**Languages.** Urdu and English screens, right-to-left layout for Urdu, and Roman Urdu search on patient names.

**Reliability.** Daily automatic backups, a monthly tested restore, and basic error monitoring. A read-only view of today's appointments if the system is slow.

**Gaps to fix if the old repository is reused.** Users kept in memory, a login token passed in the web address, a placeholder token-signing secret, and a server that accepts requests from any website.

## 6. Quality and testing

- Automated tests for cross-clinic access on every endpoint.
- Tests for billing totals, partial payments and daily closing.
- Manual test script for a full clinic day, run before each pilot.
- Load check with a realistic day of bookings for one clinic and ten clinics.
- Security review of sign-in, access control and backups before the first paying clinic.

## 7. Launch plan

1. Pilot with three clinics in one city, with free setup and a paid commitment.
2. Visit each pilot clinic on day one, day three and day seven.
3. Collect a weekly list of problems and fix the top three.
4. After two stable weeks, ask each clinic for two referrals.
5. Open sales to more clinics in the same city.

## 8. Validation gate before building

Build only a clickable demo until this is done.

| Week | Work | Output |
| --- | --- | --- |
| 1 | Pick one city. List 40 clinics. Build the clickable demo. Try three competitor demos. | Target list, demo, competitor notes |
| 2 | Visit 20 clinics. Ask how they keep records, take bookings and bill. Show the demo. | Interview notes |
| 3 | Offer free setup for a paid commitment. Test Rs 3,000, Rs 5,000 and Rs 8,000. Ask for two referrals each. | Offers made and answers |
| 4 | Count commitments, objections and price answers. Check WhatsApp cost. | Go or stop memo |

Decision at day 30:

| Result | Decision |
| --- | --- |
| 3 or more paid or signed pilots at Rs 4,000 or above | Build the MVP |
| 3 pilots at lower prices | Build only if onboarding can be done cheaply; revisit price |
| Fewer than 3 pilots | Stop, or switch vertical and repeat the test |

Questions for each clinic:

1. How do you keep patient records and prescriptions today?
2. How do patients book, and who answers the phone?
3. How do you track dues and daily cash?
4. Which software have you tried, and what made you stop?
5. What would you pay for a system that saved you an hour a day?
6. Would you pay now for a pilot, and what would make that a yes?

## 9. MVP success criteria

| Metric | Target |
| --- | --- |
| Paid pilot commitments | 3 within 30 days |
| Time to first booking after signup | Under 1 hour |
| Clinics active weekly | 80% of paying clinics |
| Monthly churn | Under 5% |
| Reminder delivery success | 95% |
| Support requests per clinic per month | Under 3 |
| Paying clinics six months after launch | 30 |

All targets are hypotheses to adjust after the first interviews.

## 10. Risks specific to the MVP

| Risk | Mitigation |
| --- | --- |
| Building before demand is proven | Hold the validation gate; demo only until three pilots commit |
| Scope creep from pilot clinics | Keep a written not-in-MVP list; charge for custom work |
| WhatsApp provider cost or approval delay | Check before pricing; click-to-send fallback |
| Cross-clinic data leak | Row-level security and automated tests from step 1 |
| Power and network cuts | Offline tolerance in step 9; test on a slow connection |
| One person doing everything | One city, one vertical, one step at a time |

## 11. Open questions

- Which city launches first?
- Which WhatsApp provider, and at what cost per message in Pakistan?
- Where to host so pages are fast for clinics in Pakistan, and what backup storage costs?
- Should receptionists see clinical notes by default?
- Which specialties are easiest to reach in the first city?
- Is a lawyer's review of the customer terms needed before the first paying clinic?
