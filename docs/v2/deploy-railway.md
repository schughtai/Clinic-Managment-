# Deploying to Railway (staging)

Staging runs the latest build with **synthetic data only**. Real patients need the gates in the
constitution first: staff lifecycle and organization lifecycle features, a tested restore, and a
legal review of where data is stored.

## Shape

One Railway project with two services:

| Service | What it is |
|---|---|
| `Postgres` | Railway's PostgreSQL template (PostgreSQL 16+, UTF8, `pg_trgm` and `btree_gist` available) |
| `clinic` | This repository. Builds both apps; the API serves the web app and `/api` on one domain |

`railway.json` in the repository root sets the build, the pre-deploy migration, the start command
and the health check (`/api/health/ready`, which also checks the database).

## Variables on the `clinic` service

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway's superuser. **Only migrations and operator commands use it.** |
| `DATABASE_URL` | `postgresql://clinic_app:<APP_DB_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `MFA_ENCRYPTION_KEY` | 64 hex characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ALLOWED_ORIGINS` | `https://<your-service>.up.railway.app` (the public domain Railway generates) |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `1` |
| `WEB_DIST_DIR` | `../web/dist` |
| `LOG_LEVEL` | `info` |

`<APP_DB_PASSWORD>` is a long random value you choose. The migration command creates the
`clinic_app` role with exactly this password, taken from `DATABASE_URL`.

**Why two URLs:** Railway's `DATABASE_URL` connects as a superuser, and superusers skip row-level
security. The API checks its role at start-up and refuses to run as a superuser or with BYPASSRLS
(`apps/api/src/db/db.service.ts`), so a wrong variable fails loudly instead of leaking data.

## First deploy

1. Create the project, add PostgreSQL, add the GitHub repository (branch of your choice) as a
   service, set the variables above, and generate a public domain.
2. Deploy. The pre-deploy step runs `npm run db:migrate`; then `npm start` starts the API.
3. Create the Super Admin from your computer with the Railway CLI linked to the project:

   ```bash
   railway run --service clinic npm run platform:create-admin:prod -- --name "Owner" --email you@example.com --password-env OWNER_PASSWORD
   ```

   (`railway run` injects the service variables; set `OWNER_PASSWORD` in your shell first.)
4. Open the domain, sign in, and scan the authenticator QR code.

## Backups and restore (required before the first real clinic)

1. On the Postgres service, enable **Backups** (daily, with the retention your plan allows).
2. Restore test, at least once and after major schema changes:
   - restore the latest backup into a new scratch Postgres service;
   - run `select count(*) from organizations; select count(*) from persons;` and compare;
   - connect as `clinic_app` and check that `select count(*) from organizations` returns 0
     without a context (row-level security still on after restore);
   - delete the scratch service.
3. Record the date, backup used, counts and result in `docs/v2/PROGRESS.md`.

## Data residency and encryption

Railway regions are in the US, EU and Asia (Singapore). None are in Pakistan. Before storing real
patient data, get the legal review the constitution requires for cross-border health data. Record
here whether storage is encrypted at rest for the chosen plan (check Railway's security page).

## Rolling back

Redeploy the previous successful deployment from the Railway dashboard. Migrations only add; if a
release adds a migration, rolling back the code leaves the new tables unused but harmless.
