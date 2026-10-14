# Research: v2 Administrative Clinic MVP (002)

## R1. Money representation

- **Decision**: `bigint` minor units (paisa for PKR, 2 decimals) plus `currency char(3)` on every amount column. Invoices, payments and refunds store `currency` and must match the facility organization's currency; cross-currency arithmetic is refused in code and by a check.
- **Rationale**: Spec FR-021 and constitution IV require exact amounts with explicit currency. v1 stored whole rupees; minor units keep room for other currencies without a migration.
- **Display**: UI rounds to whole rupees only for display; stored values are exact.
- **Alternatives**: `numeric(14,2)` (rejected: floating-point risk in JS); whole rupees only (rejected by constitution IV wording).

## R2. Patient-name matching (Roman Urdu and Urdu)

- **Decision**: Reuse v1's tested `name-key.ts` (phonetic normalization for Muhammad/Mohammed/Mohamad and Roman Urdu variants), storing `name_key` on each patient and name word keys in a GIN-indexed `text[]`. Urdu script names are indexed as typed plus normalized (diacritics and tatweel removed). Phone digits are normalized with v1's `phone.ts`.
- **Search**: exact patient number or phone first; then name word keys with `pg_trgm` similarity ≥ 0.4 as fallback. Results are limited to the caller's organization by RLS and to patients with a visit or registration in a granted facility, except that all patients are visible to receptionists in the organization (patients are shared across branches per FR-004).
- **Rationale**: SC-001 needs a misspelt name found in under 10 seconds; the logic already exists and is tested in v1.
- **Alternatives**: Full-text search with dictionaries (rejected: no Urdu dictionary); external search engine (rejected: Principle V).

## R3. Patient number sequence per organization

- **Decision**: `organization_sequences` row per (organization, key) incremented under `for update`; patient number = organization `patient_prefix` + zero-padded number (default `P-`, 6 digits). Prefix editable by the organization admin before the first patient is created.
- **Rationale**: Gap-free ordering is not required, but uniqueness under concurrency is (SC-003). A row lock is simpler than sequences that can skip on rollback and is per organization.
- **Alternatives**: Postgres sequences per organization (rejected: thousands of sequences to manage); UUID-only numbers (rejected: staff need to say them aloud).

## R4. Double-booking prevention

- **Decision**: `appointments` store `during tstzrange` and an exclusion constraint `EXCLUDE USING gist (practitioner_id WITH =, during WITH &&) WHERE (status IN ('booked','confirmed','checked_in','in_progress'))` (btree_gist is already installed). Buffer time is folded into the stored range at booking. Conflicts surface as `slot_taken` (v1 already maps this error).
- **Rationale**: Enforced in the database for every writer, including concurrent requests (SC-003, FR-014).
- **Alternatives**: Application-level check with a lock (rejected: races across processes; only the constraint is airtight).

## R5. Queue tickets

- **Decision**: `queue_counters (organization_id, facility_id, practitioner_id, service_day)` row incremented under lock to issue the ticket number. Queue state transitions are validated in one place (`queue.transitions.ts`) and every transition is audited.
- **Rationale**: Ticket numbers restart per practitioner, facility and day (edge case), and concurrent check-ins must not share a number.

## R6. Payments: idempotency and approvals

- **Decision**: `payments.idempotency_key` with unique (organization_id, idempotency_key); the API requires an `Idempotency-Key` header on payment and refund writes (missing → 400). Same key with same body returns the original; same key with a different body returns 409. Invoice balance is locked with `for update` in the same transaction. Discounts and refunds above a role's limit create an `approval_requests` row that a permitted user approves; the approval is recorded on the record.
- **Rationale**: FR-022/FR-023/FR-024 and constitution IV. Matches v1's payment-idempotency design, extended to refunds.
- **Alternatives**: Client-side only de-duplication (rejected: double clicks and retries happen across tabs).

## R7. Day closing

- **Decision**: `day_closings (organization_id, facility_id, business_date)` unique. Closing computes expected totals per payment method from payments on that date, records counted cash and the difference. Payments dated to a closed day are refused; reopening requires `billing.reopen_day` and a reason.
- **Rationale**: FR-026. Business date uses the facility timezone.

## R8. Documents and short-lived downloads

- **Decision**: Files stored outside the web root under `UPLOAD_DIR` (local disk for staging; object storage later behind the same interface). Downloads use an HMAC token containing attachment id, organization, requesting person and expiry (5 minutes), checked again against the permission on download. Upload limit 15 MB; types restricted to images and PDF by magic-number sniffing, not the browser-declared type.
- **Rationale**: FR-030. Signed links need no session in the URL; the token is never logged.
- **Alternatives**: Public URLs (rejected: Principle I); storing blobs in PostgreSQL (rejected: backup size and streaming).

## R9. WhatsApp click-to-send and consent

- **Decision**: `wa.me` links with the message prefilled from templates; the send is recorded in `message_log` only when staff press the link's confirm step. Lists exclude patients whose consent for WhatsApp is not granted. No automatic sending.
- **Rationale**: FR-029 and the product decision in v1 0003 (click-to-send).

## R10. CSV import and export

- **Decision**: Reuse v1's `csv.ts` parser (legacy) moved to `apps/api/src/common/csv.ts`. Import is two steps: `preview` validates every row and detects duplicates against phone and name keys, and returns counts and row errors; `commit` writes only the rows the preview accepted, in one transaction, with the preview id as an idempotency key. Export streams a zip-free CSV bundle per table, authorized by `data.export` and audited.
- **Rationale**: FR-032 and the v1 import experience staff already know.

## R11. Clinical gate

- **Decision**: A `@Clinical()` decorator on routes that create or read clinical content. The access guard checks the organization module list (`clinical`) and the Practitioner permission set; if either is missing the route returns 403 `module_disabled`. No clinical routes exist in 002; the guard and its tests are built now so 1B only adds routes.
- **Rationale**: FR-033 and constitution III.

## R12. Reporting

- **Decision**: Reports are read-only SQL over the transactional tables inside the request's organization context, with a facility filter and a date range. CSV export uses the same query with `text/csv` and an audit entry. Heavy history (many years) is out of scope for the MVP; indexes on (organization_id, facility_id, date) are added per table.
- **Rationale**: No analytics store exists (Principle V).

## R13. Dashboards

- **Decision**: One endpoint per role dashboard, composed of the same report queries, limited by permissions. No caching in MVP.

## R14. Practitioners

- **Decision**: `practitioners` table independent of login accounts (FR-012). Each has facility links, specialty and registration number. In 1B, an optional `person_id` links a practitioner to a Practitioner-role login.
- **Rationale**: v2 §18.2 says doctors have no login in this release.
