# Clinic Management Platform

A multi-tenant clinic management system for small private clinics in Pakistan. One system serves many clinics, and each clinic sees only its own data. It handles patients, appointments and queues, visit notes with voice and handwriting input, prescriptions, billing, daily closing, reminders and reports, in English and Urdu.

Status: first working version, ready for pilot clinics. See "Limitations" before using it with real patients.

## Quick start (development)

You need Node 20.10 or newer. Nothing else: the database is a real PostgreSQL that starts from an npm package.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first start downloads PostgreSQL, creates the database, applies migrations and adds a demo clinic.

Demo sign-in (synthetic data, development only). The password for all three is `demo-password-123`.

| Role | Phone |
| --- | --- |
| Owner | 0300 1000001 |
| Doctor | 0300 1000002 |
| Receptionist | 0300 1000003 |

Data is kept in `apps/api/data` between runs. Delete that folder to start fresh.

## What is in the box

- **Front desk:** patient search that finds Muhammad, Mohammed and Mohamad together, and finds Urdu names. Appointments with slots, walk-in tokens and a live queue. Invoices in whole rupees, partial payments, dues, daily cash closing. Click-to-send WhatsApp reminders and payment reminders.
- **Doctors:** visit notes with vitals, a patient timeline, prescriptions with templates, a printable prescription and a WhatsApp copy.
- **Voice and handwriting:** a microphone button on every note field (browser speech to text, English or Urdu). Photos of handwritten notes, or writing on a touch screen, saved with the visit. With AI switched on, handwriting is read into editable text and dictated notes can be tidied into fields. Nothing from AI is saved without the doctor's review.
- **Owner:** staff accounts and roles, doctors and working hours, leave days, patient import from CSV, full data download, activity log, per-doctor report.

## Project layout

```
apps/api    NestJS API, PostgreSQL migrations, tests
apps/web    Vue 3 + Vite web app
docs        Business document, MVP plan, decision records, progress log
```

Decision records in `docs/decisions` explain the main choices: architecture, sign-in, AI features, money rules, the development database and the web stack.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web app together |
| `npm test` | 206 API tests on a real PostgreSQL |
| `npm run typecheck` | Type check both apps |
| `npm run lint` | Lint the API |
| `npm run build` | Production build of both apps |
| `npm run db:migrate` | Apply migrations on a deployed database |

## Deploying

1. **Database.** Any managed PostgreSQL 14 or newer with the UTF8 encoding. Allow the `pg_trgm` and `btree_gist` extensions. Create one administrator login for migrations. The migration run creates the restricted `clinic_app` role.
2. **Configuration.** Copy `apps/api/.env.example` and fill it in. The server refuses to start in production with a placeholder secret, a non-https origin or a missing database URL.
3. **Migrate, then start.** `npm run build`, then `npm run db:migrate` with both database URLs set, then `npm run start --workspace apps/api`.
4. **Web app.** Serve `apps/web/dist` as static files on the same domain as the API, and forward `/api` to the API server. Using one domain keeps cookies simple. Single-page routing needs unknown paths to return `index.html`.
5. **Photos.** Set `UPLOAD_DIR` to a persistent disk. On a host with temporary storage, photos would be lost on every restart.
6. **First clinic.** Set `SIGNUP_CODE`, then call `POST /api/auth/register-clinic` with that code to create a clinic and its owner. Remove the code afterwards to close signup.
7. **Health checks.** `GET /api/health` (alive) and `GET /api/health/ready` (database reachable).
8. **Backups.** Turn on automated daily backups with your database host and test a restore before real patients are entered. This is not done for you.
9. **Roll back.** Migrations only add. Roll back the API by redeploying the previous build, which works with the newer schema. A destructive change would need its own migration and plan.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Restricted application login (`clinic_app`) |
| `ADMIN_DATABASE_URL` | Administrator login, used only for migrations |
| `SESSION_SECRET` | 32 or more random characters |
| `ALLOWED_ORIGINS` | Web app address, https in production |
| `TRUST_PROXY` | Number of reverse proxies in front of the API |
| `SIGNUP_CODE` | Allows creating a clinic. Empty means signup is off |
| `UPLOAD_DIR` | Folder for handwriting photos |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI features, which each clinic must still enable |

## Security notes

- Clinics are separated by PostgreSQL row-level security, not only by code. Tests prove one clinic cannot read or change another's data.
- Sessions are httpOnly cookies. Passwords are hashed with bcrypt. Sign-in has rate limits and account lockout.
- Every sensitive read and every change is written to an append-only activity log.
- Clinical notes are visible to doctors and owners only. Reception has no access to them.
- Passing the automated tests does not make the system secure. Before real patients, have a security review done and a lawyer check the customer terms. Pakistan has no enacted data protection law yet, but a draft treats health data as sensitive.

## Limitations

- **AI features are untested against the live service.** They are written and tested with a stand-in. Try handwriting on real notes from your clinic before relying on it, especially Urdu handwriting. Accuracy has not been measured.
- **Voice typing** uses the browser and works in Chrome and Edge. The browser sends audio to its vendor, so it needs internet and is not private.
- **WhatsApp is click-to-send.** A person presses send. There is no automatic sending.
- **Urdu screens** were translated without a native-speaker review. Many labels fall back to English.
- **Sign-in is phone and password.** One-time codes by SMS are not built.
- **No refunds.** An invoice that has taken money cannot be cancelled.
- **No offline mode.** The app needs a connection.
- **Single server.** Rate limits live in memory. Use one API process, or move the counters to a shared store first.
- Patients without a phone number cannot be checked for duplicates on import.
- Lab, pharmacy and hospital modules are not built. The plan is in `docs/mvp-plan.md`.

## Known development-only advisories

`npm audit` reports 3 findings in Vitest 3, which is used only for tests. Nothing from it ships. Moving to Node 22 allows upgrading to Vitest 5. Production dependencies have no known findings (`npm audit --omit=dev`).
