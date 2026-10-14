-- Feature 002: administrative clinic MVP. Patients and history, practitioners and schedules,
-- appointments and queue, billing (services, invoices, payments, refunds, approvals, day closing),
-- reminders, documents, import and export. Every organization-owned table has RLS on organization_id;
-- facility-bound tables also require has_facility(facility_id) to read.

-- ---------------------------------------------------------------- shared helpers

-- Writes that must not change once recorded are refused by the database, not only by the app.
create function refuse_update() returns trigger
  language plpgsql
  as $$ begin raise exception 'this record cannot be changed' using errcode = '42501'; end $$;

create function refuse_delete() returns trigger
  language plpgsql
  as $$ begin raise exception 'this record cannot be deleted' using errcode = '42501'; end $$;

-- ---------------------------------------------------------------- settings and counters

create table organization_settings_billing (
  organization_id uuid primary key references organizations (id),
  patient_prefix text not null default 'P-' check (patient_prefix ~ '^[A-Za-z0-9-]{0,8}$'),
  patient_seq bigint not null default 0 check (patient_seq >= 0),
  patient_numbers_locked boolean not null default false,
  first_names_on_display boolean not null default false,
  updated_at timestamptz not null default now()
);

create table facility_sequences (
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  key text not null check (char_length(key) between 1 and 80),
  value bigint not null default 0 check (value >= 0),
  primary key (facility_id, key)
);

-- ---------------------------------------------------------------- practitioners and schedules

create table practitioners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  specialty text check (specialty is null or char_length(specialty) <= 80),
  registration_no text check (registration_no is null or char_length(registration_no) <= 40),
  person_id uuid references persons (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practitioners_id_org_unique unique (id, organization_id)
);
create trigger practitioners_touch before update on practitioners for each row execute function touch_updated_at();

create table practitioner_facilities (
  practitioner_id uuid not null,
  facility_id uuid not null,
  organization_id uuid not null,
  primary key (practitioner_id, facility_id),
  foreign key (practitioner_id, organization_id) references practitioners (id, organization_id),
  foreign key (facility_id, organization_id) references facilities (id, organization_id)
);

create table working_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  practitioner_id uuid not null,
  day smallint not null check (day between 0 and 6),
  opens time not null,
  closes time not null,
  check (closes > opens),
  foreign key (practitioner_id, organization_id) references practitioners (id, organization_id)
);
create index working_hours_lookup on working_hours (practitioner_id, facility_id, day);

create table leave_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  practitioner_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 200),
  check (ends_at > starts_at),
  foreign key (practitioner_id, organization_id) references practitioners (id, organization_id)
);

create table facility_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  on_date date not null,
  name text not null check (char_length(name) between 1 and 120),
  unique (facility_id, on_date)
);

create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  duration_minutes int not null check (duration_minutes between 5 and 240),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 60),
  default_fee_minor bigint not null default 0 check (default_fee_minor >= 0),
  currency char(3) not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  unique (organization_id, name)
);

-- ---------------------------------------------------------------- patients

create table patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_number text not null check (char_length(patient_number) between 2 and 20),
  name_en text check (name_en is null or char_length(name_en) between 1 and 120),
  name_ur text check (name_ur is null or char_length(name_ur) between 1 and 120),
  name_key text not null,
  name_words text[] not null default '{}',
  sex text not null default 'unknown' check (sex in ('female', 'male', 'other', 'unknown')),
  date_of_birth date,
  approximate_age int check (approximate_age is null or approximate_age between 0 and 130),
  address text check (address is null or char_length(address) <= 300),
  emergency_contact_name text check (emergency_contact_name is null or char_length(emergency_contact_name) <= 120),
  emergency_contact_phone text check (emergency_contact_phone is null or emergency_contact_phone ~ '^[0-9]{8,15}$'),
  merged_into uuid,
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_number_unique unique (organization_id, patient_number),
  constraint patients_id_org_unique unique (id, organization_id),
  constraint patients_name_present check (name_en is not null or name_ur is not null),
  constraint patients_age_one_source check (date_of_birth is null or approximate_age is null),
  foreign key (merged_into, organization_id) references patients (id, organization_id)
);
create index patients_name_words_idx on patients using gin (name_words);
create index patients_name_key_trgm on patients using gin (name_key gin_trgm_ops);
create trigger patients_touch before update on patients for each row execute function touch_updated_at();

create table patient_phones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_id uuid not null,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  label text not null default 'mobile' check (label in ('mobile', 'home', 'emergency', 'other')),
  foreign key (patient_id, organization_id) references patients (id, organization_id) on delete cascade
);
create index patient_phones_lookup on patient_phones (organization_id, phone);

create table patient_merges (
  from_patient_id uuid primary key,
  into_patient_id uuid not null,
  organization_id uuid not null references organizations (id),
  merged_by uuid references persons (id),
  merged_at timestamptz not null default now(),
  reason text not null check (char_length(reason) between 1 and 300),
  foreign key (from_patient_id, organization_id) references patients (id, organization_id),
  foreign key (into_patient_id, organization_id) references patients (id, organization_id)
);

create table patient_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'sms', 'phone', 'organization_sharing')),
  granted boolean not null,
  recorded_by uuid references persons (id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create index patient_consents_latest on patient_consents (patient_id, channel, recorded_at desc);
create trigger patient_consents_no_update before update on patient_consents for each row execute function refuse_update();
create trigger patient_consents_no_delete before delete on patient_consents for each row execute function refuse_delete();

-- ---------------------------------------------------------------- history (insert-only)

create table history_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_id uuid not null,
  section text not null check (section in ('allergy', 'condition', 'surgery', 'medication', 'family')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  source text not null check (source in ('patient_reported', 'representative_reported', 'imported', 'clinician_recorded')),
  status text not null default 'active' check (status in ('active', 'resolved', 'historical', 'entered_in_error')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed')),
  author_id uuid references persons (id),
  recorded_at timestamptz not null default now(),
  reviewed_by uuid references persons (id),
  reviewed_at timestamptz,
  supersedes_id uuid references history_entries (id),
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  constraint history_review_consistent check ((review_status = 'reviewed') = (reviewed_by is not null))
);
create index history_entries_patient on history_entries (patient_id, section, recorded_at desc);
-- Only the review fields may change, and only once. Everything else is preserved for audit.
create function history_guard() returns trigger
  language plpgsql
  as $$
  begin
    if old.review_status = 'reviewed' then
      raise exception 'a reviewed entry cannot change' using errcode = '42501';
    end if;
    if (new.content, new.source, new.status, new.section, new.author_id, new.recorded_at, new.supersedes_id, new.patient_id)
       is distinct from (old.content, old.source, old.status, old.section, old.author_id, old.recorded_at, old.supersedes_id, old.patient_id) then
      raise exception 'history is preserved; record a correction instead' using errcode = '42501';
    end if;
    return new;
  end
  $$;
create trigger history_entries_guard before update on history_entries for each row execute function history_guard();
create trigger history_entries_no_delete before delete on history_entries for each row execute function refuse_delete();

create table history_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_id uuid not null,
  section text not null check (section in ('allergy', 'condition', 'surgery', 'medication', 'family')),
  state text not null check (state in ('not_assessed', 'unknown', 'patient_reports_none', 'has_entries')),
  recorded_by uuid references persons (id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create index history_assessments_latest on history_assessments (patient_id, section, recorded_at desc);
create trigger history_assessments_no_update before update on history_assessments for each row execute function refuse_update();
create trigger history_assessments_no_delete before delete on history_assessments for each row execute function refuse_delete();

-- ---------------------------------------------------------------- documents and import

create table attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  patient_id uuid not null,
  kind text not null check (kind in ('referral', 'lab_report', 'scan', 'other')),
  document_date date,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 15000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text not null unique,
  uploaded_by uuid references persons (id),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'cancelled')),
  counts jsonb not null default '{}',
  row_errors jsonb not null default '[]',
  rows_payload jsonb not null default '[]',
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table message_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid references facilities (id),
  patient_id uuid not null,
  kind text not null check (kind in ('appointment_reminder', 'follow_up', 'balance')),
  reference_id uuid not null,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  sent_by uuid references persons (id),
  marked_at timestamptz not null default now(),
  constraint message_log_once unique (organization_id, kind, reference_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);

-- ---------------------------------------------------------------- appointments and queue

create table appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  practitioner_id uuid not null,
  patient_id uuid not null,
  appointment_type_id uuid references appointment_types (id),
  status text not null default 'booked' check (status in ('booked', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  during tstzrange not null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  rescheduled_from uuid references appointments (id),
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_id_org_unique unique (id, organization_id),
  constraint appointments_times check (ends_at > starts_at),
  constraint appointments_cancel_reason check (status <> 'cancelled' or cancel_reason is not null),
  foreign key (practitioner_id, organization_id) references practitioners (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  -- Two active bookings for one practitioner can never overlap, whatever the writer.
  constraint appointments_no_overlap exclude using gist (
    practitioner_id with =, during with &&
  ) where (status in ('booked', 'confirmed', 'checked_in', 'in_progress'))
);
create index appointments_facility_day on appointments (facility_id, starts_at);
create trigger appointments_touch before update on appointments for each row execute function touch_updated_at();

create table appointment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  appointment_id uuid not null references appointments (id),
  from_status text,
  to_status text not null,
  actor_id uuid references persons (id),
  reason text,
  at timestamptz not null default now()
);
create trigger appointment_events_no_update before update on appointment_events for each row execute function refuse_update();
create trigger appointment_events_no_delete before delete on appointment_events for each row execute function refuse_delete();

create table queue_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  practitioner_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid references appointments (id),
  service_day date not null,
  number int not null check (number > 0),
  status text not null default 'waiting' check (status in ('waiting', 'called', 'in_consultation', 'completed', 'missed')),
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  completed_at timestamptz,
  created_by uuid references persons (id),
  constraint queue_number_unique unique (facility_id, practitioner_id, service_day, number),
  foreign key (practitioner_id, organization_id) references practitioners (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create index queue_day on queue_tickets (facility_id, service_day, status);

create table queue_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  ticket_id uuid not null references queue_tickets (id),
  from_status text,
  to_status text not null,
  actor_id uuid references persons (id),
  at timestamptz not null default now()
);
create trigger queue_events_no_update before update on queue_events for each row execute function refuse_update();
create trigger queue_events_no_delete before delete on queue_events for each row execute function refuse_delete();

-- ---------------------------------------------------------------- billing

create table services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  code text not null check (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  default_price_minor bigint not null default 0 check (default_price_minor >= 0),
  currency char(3) not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  unique (organization_id, code)
);

create table service_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  service_id uuid not null references services (id),
  facility_id uuid not null references facilities (id),
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null default now()
);
create index service_prices_lookup on service_prices (service_id, facility_id, effective_from desc);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  patient_id uuid not null,
  number text,
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  currency char(3) not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  issued_at timestamptz,
  voided_by uuid references persons (id),
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_total_arithmetic check (total_minor = subtotal_minor - discount_minor + tax_minor),
  constraint invoices_number_unique unique (facility_id, number),
  constraint invoices_id_org_unique unique (id, organization_id),
  constraint invoices_issued_has_number check (status = 'draft' or number is not null),
  foreign key (patient_id, organization_id) references patients (id, organization_id)
);
create trigger invoices_touch before update on invoices for each row execute function touch_updated_at();

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  invoice_id uuid not null references invoices (id) on delete cascade,
  position int not null check (position >= 1),
  service_id uuid references services (id),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  quantity int not null check (quantity between 1 and 999),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  check (line_total_minor = quantity * unit_price_minor - discount_minor),
  unique (invoice_id, position)
);
-- Lines are fixed once the invoice is issued; corrections are voids and new invoices.
create function invoice_lines_guard() returns trigger
  language plpgsql
  as $$
  declare
    target uuid;
    current_status text;
  begin
    if tg_op = 'DELETE' then
      target := old.invoice_id;
    else
      target := new.invoice_id;
    end if;
    select status into current_status from invoices where id = target;
    if current_status is distinct from 'draft' then
      raise exception 'an issued invoice cannot change' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end
  $$;
create trigger invoice_lines_guard_write before insert or update or delete on invoice_lines for each row execute function invoice_lines_guard();

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  invoice_id uuid not null references invoices (id),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'other')),
  reference text check (reference is null or char_length(reference) <= 80),
  received_by uuid references persons (id),
  received_at timestamptz not null default now(),
  business_date date not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 64),
  request_hash text not null,
  constraint payments_idempotency unique (organization_id, idempotency_key)
);
create index payments_invoice on payments (invoice_id);
create index payments_day on payments (facility_id, business_date);
create trigger payments_no_update before update on payments for each row execute function refuse_update();
create trigger payments_no_delete before delete on payments for each row execute function refuse_delete();

create table refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  payment_id uuid not null references payments (id),
  invoice_id uuid not null references invoices (id),
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  requested_by uuid references persons (id),
  approved_by uuid references persons (id),
  approved_at timestamptz,
  business_date date not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 64),
  request_hash text not null,
  created_at timestamptz not null default now(),
  constraint refunds_idempotency unique (organization_id, idempotency_key),
  constraint refunds_approved_by_someone_else check (approved_by is null or approved_by is distinct from requested_by)
);
create index refunds_payment on refunds (payment_id);
create trigger refunds_no_update before update on refunds for each row execute function refuse_update();
create trigger refunds_no_delete before delete on refunds for each row execute function refuse_delete();

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  kind text not null check (kind in ('discount', 'refund')),
  target_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  reason text check (reason is null or char_length(reason) <= 300),
  requested_by uuid references persons (id),
  approver_id uuid references persons (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approvals_decider check (status = 'pending' or (approver_id is not null and approver_id is distinct from requested_by))
);

create table day_closings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  facility_id uuid not null references facilities (id),
  business_date date not null,
  expected_by_method jsonb not null default '{}',
  expected_total_minor bigint not null default 0,
  counted_cash_minor bigint not null check (counted_cash_minor >= 0),
  difference_minor bigint not null,
  closed_by uuid references persons (id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references persons (id),
  reopened_at timestamptz,
  reopen_reason text check (reopen_reason is null or char_length(reopen_reason) <= 300)
);
-- One open closing per facility and day; a reopened closing stays in the record.
create unique index day_closings_open_unique on day_closings (facility_id, business_date) where reopened_at is null;

-- ---------------------------------------------------------------- privileges and row-level security

-- Sequence and counter tables are written by the application through row locks; history and money
-- tables are append-only for the application role (update and delete revoked above).
revoke update, delete on appointment_events, queue_events, history_assessments, patient_consents, payments, refunds from clinic_app;

-- Organization-scoped policy for every new table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_settings_billing', 'facility_sequences', 'practitioners', 'practitioner_facilities',
    'working_hours', 'leave_periods', 'facility_holidays', 'appointment_types', 'patients', 'patient_phones',
    'patient_merges', 'patient_consents', 'history_entries', 'history_assessments', 'attachments',
    'import_batches', 'message_log', 'appointments', 'appointment_events', 'queue_tickets', 'queue_events',
    'services', 'service_prices', 'invoices', 'invoice_lines', 'payments', 'refunds', 'approval_requests',
    'day_closings'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I using (organization_id = current_org()) with check (organization_id = current_org())',
                   t || '_org', t);
  end loop;
end
$$;

-- Facility-bound rows are visible only for granted facilities (the organization policy still applies).
do $$
declare
  t text;
begin
  foreach t in array array[
    'facility_sequences', 'working_hours', 'facility_holidays', 'appointments', 'queue_tickets', 'service_prices',
    'invoices', 'payments', 'refunds', 'approval_requests', 'day_closings', 'message_log'
  ] loop
    execute format('drop policy %I on %I', t || '_org', t);
    execute format('create policy %I on %I using (organization_id = current_org() and has_facility(facility_id)) with check (organization_id = current_org())',
                   t || '_org', t);
  end loop;
end
$$;

-- Child tables of patients or invoices inherit visibility through their parent, but they carry the
-- organization policy directly as well.

-- Patient numbering and billing counters are written only under row locks by the application.
grant select, insert, update on organization_settings_billing, facility_sequences to clinic_app;
