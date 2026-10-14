# Security review: 001 Platform and Tenant Foundation

Reviewed 2026-10-14 against the constitution's Security and Privacy section and v2 §12.

- [x] Tenant isolation in the database: row-level security on every organization-owned table;
      facility visibility through `has_facility`; tests in `apps/api/test/rls.test.ts`.
- [x] Tenant isolation over HTTP: every organization and platform route checked for other
      organizations, other roles, missing authenticator step and no session
      (`apps/api/test/isolation.test.ts`, 44 checks).
- [x] Application role cannot bypass row-level security; production start refuses a superuser or
      BYPASSRLS role (`db-role.test.ts`).
- [x] All 18 security-definer functions pin `search_path` and are executable only by `clinic_app`.
- [x] Sessions: random 32-byte tokens, stored as SHA-256, httpOnly + SameSite=Lax cookies, Secure in
      production, 12-hour expiry, revoked on sign-out, reset, deactivation and suspension.
- [x] Super Admin requires TOTP; secrets sealed with AES-256-GCM; replayed codes refused; recovery
      codes hashed and single-use.
- [x] Invitation and reset tokens: hashed, single-use, expiring (72 h / 24 h), carried in the URL
      fragment so they never reach servers or logs; acceptance is race-safe (row lock).
- [x] Rate limits: strict limit on login, MFA, invitation and reset routes; lockout after 5 failures.
- [x] Same response for unknown accounts and wrong passwords, with equal hashing time.
- [x] Unsafe requests from foreign origins refused (origin check) on top of SameSite cookies.
- [x] Logs: request path only (no query strings or bodies); cookies, passwords, tokens and
      PostgreSQL error detail/parameters redacted.
- [x] Audit: append-only for the application role; detail keys that look like secrets refused; test
      scans every entry for tokens and passwords (`audit.test.ts`).
- [x] Privilege escalation: roles with permissions the caller lacks, or with a switched-off module,
      cannot be granted; the last administrator cannot be removed.
- [x] Production configuration refuses the development MFA key and non-https origins.
- [x] `npm audit --omit=dev`: 0 findings. Development-only findings remain in Vitest 3 (Node 20).

Open items (tracked, not blockers for staging with synthetic data):

- [ ] Backups enabled and one restore tested on staging (tasks T057).
- [ ] Legal review of hosting region for real patient data (Railway has no Pakistan region).
- [ ] Independent security review before the first external organization.
- [ ] Rate-limit counters are in memory: run one API instance until they move to a shared store.
