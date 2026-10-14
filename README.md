# Clinic Management Platform (v2, hospital-ready)

A multi-tenant SaaS for clinics that can grow into a hospital system. One platform hosts many
organizations (clinic businesses), each with one or more branches, and each organization sees
only its own data. The product reference is
[docs/v2/clinic_management_app_hospital_ready.md](docs/v2/clinic_management_app_hospital_ready.md);
the rules every change follows are in the [constitution](.specify/memory/constitution.md).

Status: **feature 001 (platform and tenant foundation) is built.** Patients, appointments, queue
and billing (feature 002) are specified in [specs/002-v2-clinic-mvp](specs/002-v2-clinic-mvp/spec.md)
and come next. v1 code that is not rebuilt yet lives, unbuilt, in [legacy/](legacy/README.md).

## Roles in this release

| Role | What they do |
| --- | --- |
| **Super Admin** (platform) | Creates organizations, invites their first administrator, suspends or reactivates them, switches modules. Must use an authenticator app. Has no access to patient data. |
| **Clinic / Hospital Admin** | Organization profile, branches and hours, staff invitations, roles and branch access, password resets, audit log, activation. |
| **Receptionist** | Dashboard now; patients, appointments and queue arrive with feature 002. |
| **Finance** | Dashboard now; invoices, payments and refunds arrive with feature 002. |

Doctors appear on schedules but sign in only once the clinical module and Practitioner role are
built (v2 Phase 1B). The clinical module is off for every organization by default.

## Quick start (development)

You need Node 20.10 or newer. Nothing else: PostgreSQL starts from an npm package.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first start creates the database and synthetic demo data.
All demo accounts use the password `demo-password-123`.

| Who | Sign in with |
| --- | --- |
| Super Admin | `owner@demo.test` — authenticator key `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (add it to any authenticator app, or run with `DEV_PRINT_TOTP=true` to print codes) |
| Shifa Health Clinic admin | `0300 1000001` |
| Shifa receptionist (Gulberg branch only) | `0300 1000002` |
| Shifa finance | `0300 1000003` |
| City Medical Centre admin | `0300 1000004` |

Data is kept in `apps/api/data`. Delete that folder to start fresh.

## What is in the box

- **Sign-in:** phone or email and password, lockout after 5 wrong attempts, server-side sessions
  that end immediately on sign-out, reset, deactivation or suspension. Authenticator codes are
  required for Super Admins and optional for everyone else, with single-use recovery codes.
- **Platform console:** organizations with status, branches and staff counts; create an
  organization with its first branch; invite its administrator; suspend, reactivate, deactivate;
  clinical module switch; administrator password reset; platform audit log.
- **Organization workspace:** setup checklist and activation, organization and regional settings
  (currency, language, timezone, date format), branches with weekly opening hours, staff
  invitations with roles and branch access, change access, deactivate and reactivate, reset links,
  read-only roles, filtered audit log. Invitation and reset links are shown once and can be sent by
  WhatsApp click-to-send.
- **Design:** v2 design tokens, keyboard-friendly components, English and Urdu (right-to-left),
  phone-width layouts, and a voice dictation field (browser speech, English or Urdu) used for
  addresses and reasons now and for every note field in later features.

## Project layout

```
apps/api     NestJS API, SQL migrations, operator commands, tests on real PostgreSQL
apps/web     React 19 + Vite web app (served by the API in production)
specs/       Spec Kit features: spec, plan, research, data model, API contract, tasks
docs/v2      Product document, decision records 0007+, deployment and operations guides
docs/v1      v1 documents and decision records 0001–0006
legacy/      v1 code awaiting port (not built)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web app together, with demo data |
| `npm test` | API tests on a real PostgreSQL (row-level security, isolation of every route) and web tests |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks and production build of both apps |
| `npm run db:migrate` | Apply migrations (needs `ADMIN_DATABASE_URL` and `DATABASE_URL`) |
| `npm run platform:create-admin -- --name "Owner" --email you@example.com` | Create the first Super Admin |
| `npm run platform:reset-mfa -- --email you@example.com` | Remove a Super Admin's authenticator after an identity check |

## Deploying

See [docs/v2/deploy-railway.md](docs/v2/deploy-railway.md) (one service plus PostgreSQL; staging
runs on Railway) and [docs/v2/operations.md](docs/v2/operations.md). In short: two database URLs
(administrator for migrations, restricted `clinic_app` for the app — the app refuses to start as a
superuser), `MFA_ENCRYPTION_KEY`, an https `ALLOWED_ORIGINS`, and `WEB_DIST_DIR` so the API serves
the web app on the same domain.

## Security notes

- Organizations are separated by PostgreSQL row-level security as well as by code, and branches
  are filtered the same way. Tests check every route for cross-organization access.
- Super Admin status is separate from organization membership and opens no patient data.
- Tokens for sessions, invitations and resets are random, stored only as hashes, and never appear
  in server logs (invitation and reset tokens travel in the URL fragment).
- Audit logs are append-only and refuse keys that look like secrets.
- Passing tests does not make the system secure. Before real patients: a security review, a
  tested backup restore, and a legal review of where data is hosted.

## Limitations

- Patients, appointments, queue and billing are not in this release (feature 002).
- No email or SMS provider: invitation and reset links are shared by hand or WhatsApp.
- Custom roles cannot be created yet; the four role templates are fixed.
- Rate limits live in memory: run one API process.
- Urdu text needs review by a native reader.
