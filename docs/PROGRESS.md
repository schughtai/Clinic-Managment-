# Build progress

Updated by the overnight build. Newest status at the top. A step is only marked done after it was run and checked.

## How to resume

1. Read this file and `git log`.
2. Continue from the first step that is not marked done.
3. Run `npm test` in `apps/api` before and after each step.

## Steps

| # | Step | Status |
| --- | --- | --- |
| 0 | Repo foundation, decision records, workspace config | done |
| 1 | Database layer, migrations, row-level security, auth, clinic setup, staff, doctors | done (tests pass: 12 database, 34 helper, 20 auth, 12 staff) |
| 2 | Patients with Roman Urdu search, appointments, slots, walk-in tokens, queue | done (118 API tests pass in total) |
| 3 | Visits, prescriptions, handwriting and voice features | not started |
| 4 | Billing, daily closing, reports, import, export, reminders, audit | not started |
| 5 | Web app screens in Urdu and English | not started |
| 6 | Browser smoke test, CI workflow, documentation, final report | not started |

## Notes

- Nothing is pushed anywhere. There is no remote.
- Demo login details live in the seed script and the README, never in chat.
