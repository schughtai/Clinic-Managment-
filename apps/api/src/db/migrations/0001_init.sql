-- Core schema. Every clinic-owned table carries clinic_id and is protected by row-level security.
-- The application connects as the non-owner role clinic_app, so the policies always apply to it.

create extension if not exists pg_trgm;
create extension if not exists btree_gist;

alter default privileges in schema public grant select, insert, update, delete on tables to clinic_app;
alter default privileges in schema public grant usage, select on sequences to clinic_app;

-- The clinic the current transaction acts for. Set by the application with set_config(..., true).
create function current_clinic() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.clinic_id', true), '')::uuid $$;

create function touch_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- clinics and users

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  address text check (address is null or char_length(address) <= 300),
  city text check (city is null or char_length(city) <= 80),
  timezone text not null default 'Asia/Karachi',
  locale text not null default 'en' check (locale in ('en', 'ur')),
  ai_enabled boolean not null default false,
  modules text[] not null default '{}',
  patient_seq integer not null default 0 check (patient_seq >= 0),
  invoice_seq integer not null default 0 check (invoice_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clinics_touch before update on clinics for each row execute function touch_updated_at();
alter table clinics enable row level security;
create policy clinics_select on clinics for select using (id = current_clinic());
create policy clinics_update on clinics for update using (id = current_clinic()) with check (id = current_clinic());
revoke insert, delete on clinics from clinic_app;

create table users (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  password_hash text not null,
  role text not null check (role in ('owner', 'doctor', 'receptionist')),
  active boolean not null default true,
  token_version integer not null default 0,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_unique unique (phone)
);
create index users_clinic_idx on users (clinic_id);
create trigger users_touch before update on users for each row execute function touch_updated_at();
alter table users enable row level security;
create policy tenant_isolation on users using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- Sign-in happens before the clinic is known, so it goes through narrow functions
-- that run with the owner's rights instead of widening the table policy.

create function auth_find_user(p_phone text)
  returns table (
    id uuid, clinic_id uuid, name text, role text, password_hash text,
    active boolean, token_version integer, locked_until timestamptz
  )
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select u.id, u.clinic_id, u.name, u.role, u.password_hash, u.active, u.token_version, u.locked_until
    from users u where u.phone = p_phone
  $$;

create function auth_record_login(p_user_id uuid, p_success boolean, p_max_attempts integer, p_lock_minutes integer)
  returns void
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    if p_success then
      update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = p_user_id;
    else
      update users
        set failed_logins = failed_logins + 1,
            locked_until = case
              when failed_logins + 1 >= p_max_attempts then now() + make_interval(mins => p_lock_minutes)
              else locked_until
            end
        where id = p_user_id;
    end if;
  end
  $$;

create function register_clinic(p_clinic_name text, p_owner_name text, p_phone text, p_password_hash text)
  returns table (clinic_id uuid, user_id uuid)
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    new_clinic uuid;
    new_user uuid;
  begin
    insert into clinics (name, phone) values (p_clinic_name, p_phone) returning id into new_clinic;
    insert into users (clinic_id, name, phone, password_hash, role)
      values (new_clinic, p_owner_name, p_phone, p_password_hash, 'owner') returning id into new_user;
    return query select new_clinic, new_user;
  end
  $$;

revoke all on function auth_find_user(text), auth_record_login(uuid, boolean, integer, integer),
  register_clinic(text, text, text, text) from public;
grant execute on function auth_find_user(text), auth_record_login(uuid, boolean, integer, integer),
  register_clinic(text, text, text, text) to clinic_app;

-- ---------------------------------------------------------------- doctors and schedules

create table doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  specialty text check (specialty is null or char_length(specialty) <= 80),
  default_fee integer not null default 0 check (default_fee >= 0 and default_fee <= 10000000),
  slot_minutes integer not null default 15 check (slot_minutes between 5 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint doctors_user_unique unique (user_id)
);
create index doctors_clinic_idx on doctors (clinic_id, active);
alter table doctors enable row level security;
create policy tenant_isolation on doctors using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  doctor_id uuid not null references doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 is Sunday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index doctor_schedules_doctor_idx on doctor_schedules (doctor_id, weekday);
alter table doctor_schedules enable row level security;
create policy tenant_isolation on doctor_schedules using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table doctor_leaves (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  doctor_id uuid not null references doctors (id) on delete cascade,
  leave_date date not null,
  note text check (note is null or char_length(note) <= 200),
  constraint doctor_leaves_unique unique (doctor_id, leave_date)
);
alter table doctor_leaves enable row level security;
create policy tenant_isolation on doctor_leaves using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- ---------------------------------------------------------------- patients

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  patient_no integer not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_key text not null,
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  gender text check (gender is null or gender in ('male', 'female', 'other')),
  birth_year smallint check (birth_year is null or birth_year between 1880 and 2200),
  guardian_name text check (guardian_name is null or char_length(guardian_name) <= 120),
  address text check (address is null or char_length(address) <= 300),
  allergies text check (allergies is null or char_length(allergies) <= 1000),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_no_unique unique (clinic_id, patient_no)
);
create index patients_phone_idx on patients (clinic_id, phone);
create index patients_created_idx on patients (clinic_id, created_at desc);
create index patients_name_trgm on patients using gin (name gin_trgm_ops);
create index patients_key_trgm on patients using gin (name_key gin_trgm_ops);
create trigger patients_touch before update on patients for each row execute function touch_updated_at();
alter table patients enable row level security;
create policy tenant_isolation on patients using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- ---------------------------------------------------------------- appointments

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  patient_id uuid not null references patients (id),
  doctor_id uuid not null references doctors (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('appointment', 'walkin')),
  status text not null default 'booked'
    check (status in ('booked', 'arrived', 'in_consult', 'done', 'cancelled', 'no_show')),
  token_date date,
  token_no integer check (token_no is null or token_no > 0),
  reason text check (reason is null or char_length(reason) <= 300),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((token_no is null) = (token_date is null))
);
create index appointments_clinic_time_idx on appointments (clinic_id, starts_at);
create index appointments_doctor_time_idx on appointments (doctor_id, starts_at);
create index appointments_patient_idx on appointments (patient_id, starts_at desc);
create unique index appointments_token_unique on appointments (doctor_id, token_date, token_no) where token_no is not null;
-- A doctor cannot hold two active booked slots that overlap in time. Walk-ins use tokens and are exempt.
alter table appointments add constraint appointments_no_overlap
  exclude using gist (doctor_id with =, tstzrange(starts_at, ends_at) with &&)
  where (kind = 'appointment' and status in ('booked', 'arrived', 'in_consult'));
create trigger appointments_touch before update on appointments for each row execute function touch_updated_at();
alter table appointments enable row level security;
create policy tenant_isolation on appointments using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- ---------------------------------------------------------------- visits and prescriptions

create table visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  patient_id uuid not null references patients (id),
  doctor_id uuid not null references doctors (id),
  appointment_id uuid references appointments (id) on delete set null,
  visited_at timestamptz not null default now(),
  complaint text check (complaint is null or char_length(complaint) <= 20000),
  history text check (history is null or char_length(history) <= 20000),
  examination text check (examination is null or char_length(examination) <= 20000),
  diagnosis text check (diagnosis is null or char_length(diagnosis) <= 20000),
  plan text check (plan is null or char_length(plan) <= 20000),
  vitals jsonb not null default '{}'::jsonb,
  input_source text not null default 'typed' check (input_source in ('typed', 'voice', 'handwriting', 'mixed')),
  ai_assisted boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_patient_idx on visits (patient_id, visited_at desc);
create index visits_clinic_idx on visits (clinic_id, visited_at desc);
create unique index visits_appointment_unique on visits (appointment_id) where appointment_id is not null;
create trigger visits_touch before update on visits for each row execute function touch_updated_at();
alter table visits enable row level security;
create policy tenant_isolation on visits using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table visit_attachments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  visit_id uuid not null references visits (id) on delete cascade,
  kind text not null check (kind in ('handwriting')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  storage_key text not null,
  sha256 text not null,
  transcription text check (transcription is null or char_length(transcription) <= 20000),
  ai_transcribed boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index visit_attachments_visit_idx on visit_attachments (visit_id);
alter table visit_attachments enable row level security;
create policy tenant_isolation on visit_attachments using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  visit_id uuid not null references visits (id) on delete cascade,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  advice text check (advice is null or char_length(advice) <= 5000),
  follow_up_on date,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prescriptions_visit_unique unique (visit_id)
);
create trigger prescriptions_touch before update on prescriptions for each row execute function touch_updated_at();
alter table prescriptions enable row level security;
create policy tenant_isolation on prescriptions using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table prescription_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  advice text check (advice is null or char_length(advice) <= 5000),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint prescription_templates_name_unique unique (clinic_id, name)
);
alter table prescription_templates enable row level security;
create policy tenant_isolation on prescription_templates using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- ---------------------------------------------------------------- billing (whole rupees, see decision 0004)

create table invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  invoice_no integer not null,
  patient_id uuid not null references patients (id),
  visit_id uuid references visits (id) on delete set null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
  subtotal integer not null check (subtotal >= 0),
  discount integer not null default 0 check (discount >= 0),
  total integer not null check (total >= 0),
  paid integer not null default 0 check (paid >= 0),
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_no_unique unique (clinic_id, invoice_no),
  check (discount <= subtotal),
  check (total = subtotal - discount),
  check (paid <= total)
);
create index invoices_patient_idx on invoices (patient_id, created_at desc);
create index invoices_clinic_created_idx on invoices (clinic_id, created_at desc);
create index invoices_dues_idx on invoices (clinic_id, created_at) where status in ('unpaid', 'partial');
create trigger invoices_touch before update on invoices for each row execute function touch_updated_at();
alter table invoices enable row level security;
create policy tenant_isolation on invoices using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  quantity integer not null check (quantity between 1 and 10000),
  unit_price integer not null check (unit_price >= 0 and unit_price <= 100000000),
  amount integer not null,
  check (amount = quantity * unit_price)
);
create index invoice_items_invoice_idx on invoice_items (invoice_id);
alter table invoice_items enable row level security;
create policy tenant_isolation on invoice_items using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  invoice_id uuid not null references invoices (id),
  amount integer not null check (amount > 0),
  method text not null check (method in ('cash', 'bank', 'jazzcash', 'easypaisa')),
  reference text check (reference is null or char_length(reference) <= 100),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 100),
  received_by uuid references users (id) on delete set null,
  received_at timestamptz not null default now()
);
create index payments_clinic_time_idx on payments (clinic_id, received_at);
create index payments_invoice_idx on payments (invoice_id);
create unique index payments_idempotency_unique on payments (clinic_id, idempotency_key) where idempotency_key is not null;
alter table payments enable row level security;
create policy tenant_isolation on payments using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table day_closings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  closing_date date not null,
  expected_cash integer not null check (expected_cash >= 0),
  counted_cash integer not null check (counted_cash >= 0),
  difference integer not null,
  totals jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  closed_by uuid references users (id) on delete set null,
  closed_at timestamptz not null default now(),
  constraint day_closings_unique unique (clinic_id, closing_date),
  check (difference = counted_cash - expected_cash)
);
alter table day_closings enable row level security;
create policy tenant_isolation on day_closings using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

-- ---------------------------------------------------------------- messaging and audit

create table message_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  patient_id uuid references patients (id) on delete set null,
  appointment_id uuid references appointments (id) on delete set null,
  kind text not null check (kind in ('appointment_reminder', 'appointment_confirmation', 'prescription_link', 'payment_reminder', 'custom')),
  to_phone text not null check (to_phone ~ '^[0-9]{8,15}$'),
  body text not null check (char_length(body) <= 2000),
  status text not null default 'prepared' check (status in ('prepared', 'marked_sent')),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  marked_sent_at timestamptz
);
create index message_log_appointment_idx on message_log (clinic_id, appointment_id);
alter table message_log enable row level security;
create policy tenant_isolation on message_log using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());

create table audit_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references clinics (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  entity text check (entity is null or char_length(entity) <= 40),
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  request_id text check (request_id is null or char_length(request_id) <= 100),
  created_at timestamptz not null default now()
);
create index audit_log_clinic_time_idx on audit_log (clinic_id, created_at desc);
create index audit_log_entity_idx on audit_log (clinic_id, entity, entity_id);
alter table audit_log enable row level security;
create policy tenant_isolation on audit_log using (clinic_id = current_clinic()) with check (clinic_id = current_clinic());
-- The audit trail is append-only for the application.
revoke update, delete, truncate on audit_log from clinic_app;
