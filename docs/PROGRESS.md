# Build progress

Updated by the overnight build. A step is marked done only after it was run and checked.

## How to resume

1. Read this file and run `git log --oneline` in `D:\clinic`.
2. Backend tests: `cd apps/api && npx vitest run` (206 tests, about 35 seconds). Type check: `npx tsc -p tsconfig.json --noEmit`. Lint: `npx eslint "src/**/*.ts" "test/**/*.ts"`.
3. Continue with the first web page that does not exist yet (list below).
4. Write files with the editor tool, not shell heredocs. Shell heredocs fail on this machine when the text contains quotes.

## Steps

| # | Step | Status |
| --- | --- | --- |
| 0 | Repo foundation, decision records, workspace config | done |
| 1 | Database layer, row-level security, auth, staff, doctors | done |
| 2 | Patients with Roman Urdu search, appointments, slots, tokens, queue | done |
| 3 | Visits, prescriptions, handwriting photos with AI reading, dictation clean-up (API) | done |
| 4 | Billing, closing, reports, import, export, WhatsApp click-to-send, audit view | done, 206 API tests pass |
| 4b | Development runner (`npm run dev` in `apps/api`) and demo data | done, checked by hand against the running server |
| 5 | Web app (Vue 3 + Vite, decision 0006) | in progress, see below |
| 6 | Browser smoke test, CI workflow, README, final report | not started |

## Web app (`apps/web`) status

Done and written, not yet type-checked or run in a browser:

- `src/api.ts`, `types.ts`, `i18n.ts` (English text is the key, Urdu in `locale-ur.ts`), `session.ts`, `toast.ts`, `format.ts`, `image.ts`, `style.css`, `main.ts`, `router.ts`, `App.vue`
- Components: `StatusPill`, `PatientPicker`, `DictationButton` (browser speech to text), `HandwritingInput` (photo or draw, then upload)
- Pages: `LoginPage`, `DashboardPage`, `PatientsPage`, `PatientNewPage`

Still to write (the router already points at all of these):

- `PatientPage` (details, edit, visit timeline for owner and doctor, invoices for front desk, buttons to book, walk in, new visit, new invoice)
- `VisitPage` (new and edit: fields with dictation, vitals, AI tidy-up, handwriting upload and transcription review, prescription editor with templates, print and WhatsApp)
- `AppointmentsPage` (day list, book with slots, walk-in)
- `BillingPage` (list and create invoice with live total), `InvoicePage` (pay with idempotency key, void, WhatsApp reminder)
- `ReportsPage` (daily, close the day, doctor report), `RemindersPage`, `SettingsPage` (clinic, staff, doctors and schedules, import and export, audit, change password), `PrintPrescriptionPage`

Then: `cd apps/web && npx vue-tsc --noEmit`, `npx vite build`, start API and web, and check the main journeys in a browser.

## Known facts to keep

- Demo sign-in details are printed by the dev runner and listed in the README. They are synthetic.
- Node on this machine is 20.10, so Vite 6 and Vitest 3 are used. The 3 remaining audit findings are in Vitest and affect developers only.
- Nothing is pushed anywhere. There is no remote.
