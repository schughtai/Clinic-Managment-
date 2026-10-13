# Build progress

First working version is complete. A step is marked done only after it was run and checked.

## Steps

| # | Step | Status |
| --- | --- | --- |
| 0 | Repo foundation, decision records, workspace config | done |
| 1 | Database layer, row-level security, auth, staff, doctors | done |
| 2 | Patients with Roman Urdu search, appointments, slots, tokens, queue | done |
| 3 | Visits, prescriptions, handwriting photos with AI reading, dictation clean-up | done |
| 4 | Billing, closing, reports, import, export, WhatsApp click-to-send, audit view | done |
| 4b | Development runner and demo data (`npm run dev`) | done |
| 5 | Web app, Vue 3 and Vite (decision 0006) | done |
| 6 | Browser check, CI workflow, README, final report | done |

## What was verified, and how

| Check | Result |
| --- | --- |
| API tests on a real PostgreSQL (`npm test`) | 206 passed |
| Type check, both apps (`npm run typecheck`) | clean |
| Lint, API (`npm run lint`) | clean |
| Production build, both apps (`npm run build`) | clean |
| Compiled API started in production mode | ready, refuses a placeholder secret and a non-https origin, cookie is HttpOnly, Secure and SameSite |
| Fresh start from an empty folder with `npm run dev` | API ready in 9 seconds, sign-in works through the web server |
| Browser: sign-in, dashboard figures, search by other spellings (Roman Urdu and Urdu script), visit screen with voice buttons, handwriting upload, prescription print | worked |
| `npm audit --omit=dev` | 0 findings |
| `npm audit` (all) | 3 findings in Vitest 3, test tooling only |

## Not verified

- AI reading of handwriting and note tidy-up against the live service. No API key was available. The code is tested with a stand-in provider only.
- Actually speaking into the microphone. The buttons render and the browser support check works, but speech recognition needs a person and a microphone.
- Pressing Print in a real print dialog, and WhatsApp links opening the WhatsApp app.
- Urdu screens on a real right-to-left layout beyond the sign-in and print pages.
- The web app on a phone-sized screen.
- Load, backup and restore behaviour.

## Next steps

1. Run `npm run dev`, sign in as each demo role and click through the main journeys.
2. Add an API key, turn on AI in Settings as the owner, and try real handwritten notes, including Urdu.
3. Have a native Urdu reader review `apps/web/src/locale-ur.ts`.
4. Choose a host, set up automated database backups, and test a restore.
5. Run the clinic validation plan in `docs/mvp-plan.md` before onboarding paying clinics.
