-- v2 foundation: platform → organizations → facilities, global persons with memberships,
-- permission-bundle roles, invitations, resets, server-side sessions and two audit logs.
--
-- The application connects as clinic_app, which owns nothing and cannot bypass row-level security.
-- Each transaction states who is acting with set_config(..., true):
--   app.org_id        organization of an organization route
--   app.facility_ids  '*' for every facility, or a comma-separated list of facility ids
--   app.person_id     the signed-in person
--   app.platform      'on' only for a Super Admin with a completed authenticator check on a platform route
-- Steps that happen before any of that is known (sign-in, accepting an invitation, resolving a
-- session) go through narrow security-definer functions owned by the migration role.

create extension if not exists pg_trgm;
create extension if not exists btree_gist;

alter default privileges in schema public grant select, insert, update, delete on tables to clinic_app;
alter default privileges in schema public grant usage, select on sequences to clinic_app;

-- ---------------------------------------------------------------- context helpers

create function current_org() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create function current_person() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.person_id', true), '')::uuid $$;

create function is_platform() returns boolean
  language sql stable
  as $$ select coalesce(current_setting('app.platform', true), '') = 'on' $$;

create function has_facility(p_facility uuid) returns boolean
  language sql stable
  as $$
    select case coalesce(current_setting('app.facility_ids', true), '')
      when '*' then true
      when '' then false
      else p_facility = any (string_to_array(current_setting('app.facility_ids', true), ',')::uuid[])
    end
  $$;

create function touch_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- persons

create table persons (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  email text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254)),
  password_hash text not null,
  failed_logins integer not null default 0 check (failed_logins >= 0),
  locked_until timestamptz,
  mfa_secret_enc bytea,
  mfa_pending_secret_enc bytea,
  mfa_enabled_at timestamptz,
  mfa_last_step bigint,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ur')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint persons_identifier_required check (phone is not null or email is not null),
  constraint persons_mfa_consistent check ((mfa_enabled_at is null) = (mfa_secret_enc is null))
);
create unique index persons_phone_unique on persons (phone) where phone is not null;
create unique index persons_email_unique on persons (email) where email is not null;
create trigger persons_touch before update on persons for each row execute function touch_updated_at();

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons (id) on delete cascade,
  code_hash bytea not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_codes_person_idx on mfa_recovery_codes (person_id);

create table platform_admins (
  person_id uuid primary key references persons (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references persons (id)
);

-- ---------------------------------------------------------------- organizations

create type org_status as enum ('provisioning', 'setup_required', 'active', 'suspended', 'deactivated');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (
    slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'
    and slug not in ('platform', 'app', 'api', 'login', 'invite', 'reset', 'choose', 'account')
  ),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  email text check (email is null or char_length(email) <= 254),
  address text check (address is null or char_length(address) <= 300),
  status org_status not null default 'provisioning',
  suspended_from org_status,
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  currency char(3) not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  default_language text not null default 'en' check (default_language in ('en', 'ur')),
  timezone text not null default 'Asia/Karachi' check (char_length(timezone) between 1 and 64),
  date_format text not null default 'dd/MM/yyyy' check (date_format in ('dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy')),
  modules text[] not null default '{}' check (modules <@ array['clinical']::text[]),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_unique unique (slug)
);
create trigger organizations_touch before update on organizations for each row execute function touch_updated_at();

-- Only the transitions in data-model.md are allowed, and only a platform context may change modules
-- or move an organization other than from setup_required to active.
create function organizations_guard() returns trigger
  language plpgsql
  as $$
  declare
    allowed boolean;
  begin
    if new.modules is distinct from old.modules and not is_platform() then
      raise exception 'only the platform can change modules' using errcode = '42501';
    end if;
    if new.status = old.status then
      return new;
    end if;
    allowed := case
      when old.status = 'provisioning' then new.status = 'setup_required'
      when old.status = 'setup_required' then new.status in ('active', 'suspended')
      when old.status = 'active' then new.status = 'suspended'
      when old.status = 'suspended' then new.status = 'deactivated' or new.status = old.suspended_from
      else false
    end;
    if not allowed then
      raise exception 'organization cannot move from % to %', old.status, new.status using errcode = '23514', constraint = 'organizations_status_transition';
    end if;
    if not is_platform() and not (old.status = 'setup_required' and new.status = 'active') and old.status <> 'provisioning' then
      raise exception 'only the platform can change this status' using errcode = '42501';
    end if;
    if new.status in ('suspended', 'deactivated') and (new.status_reason is null or btrim(new.status_reason) = '') then
      raise exception 'a reason is required' using errcode = '23514', constraint = 'organizations_status_reason';
    end if;
    if new.status = 'suspended' then
      new.suspended_from := old.status;
    elsif old.status = 'suspended' then
      new.suspended_from := null;
    end if;
    if new.status = 'active' and new.activated_at is null then
      new.activated_at := now();
    end if;
    return new;
  end
  $$;
create trigger organizations_guard before update on organizations for each row execute function organizations_guard();

-- ---------------------------------------------------------------- facilities, roles, memberships

create table facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'clinic_branch' check (kind in ('clinic_branch')),
  address text check (address is null or char_length(address) <= 300),
  city text check (city is null or char_length(city) <= 80),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  opening_hours jsonb not null default '[]' check (jsonb_typeof(opening_hours) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facilities_id_org_unique unique (id, organization_id)
);
create unique index facilities_name_unique on facilities (organization_id, lower(name));
create trigger facilities_touch before update on facilities for each row execute function touch_updated_at();

create table roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  permissions text[] not null default '{}',
  system boolean not null default false,
  requires_module text check (requires_module is null or requires_module in ('clinical')),
  created_at timestamptz not null default now(),
  constraint roles_key_unique unique (organization_id, key),
  constraint roles_id_org_unique unique (id, organization_id)
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  person_id uuid not null references persons (id),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  facility_scope text not null default 'all' check (facility_scope in ('all', 'selected')),
  deactivated_at timestamptz,
  deactivated_by uuid references persons (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_person_unique unique (organization_id, person_id),
  constraint memberships_id_org_unique unique (id, organization_id),
  constraint memberships_deactivation_consistent check ((status = 'deactivated') = (deactivated_at is not null))
);
create index memberships_person_idx on memberships (person_id);
create trigger memberships_touch before update on memberships for each row execute function touch_updated_at();

-- Composite keys make it impossible to attach another organization's role or facility.
create table membership_roles (
  membership_id uuid not null,
  role_id uuid not null,
  organization_id uuid not null,
  primary key (membership_id, role_id),
  foreign key (membership_id, organization_id) references memberships (id, organization_id) on delete cascade,
  foreign key (role_id, organization_id) references roles (id, organization_id)
);

create table membership_facilities (
  membership_id uuid not null,
  facility_id uuid not null,
  organization_id uuid not null,
  primary key (membership_id, facility_id),
  foreign key (membership_id, organization_id) references memberships (id, organization_id) on delete cascade,
  foreign key (facility_id, organization_id) references facilities (id, organization_id)
);

-- ---------------------------------------------------------------- invitations, resets, sessions

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  token_hash bytea not null,
  invitee_name text not null check (char_length(btrim(invitee_name)) between 1 and 120),
  invitee_phone text check (invitee_phone is null or invitee_phone ~ '^[0-9]{8,15}$'),
  invitee_email text check (invitee_email is null or (invitee_email = lower(invitee_email) and char_length(invitee_email) <= 254)),
  role_ids uuid[] not null check (cardinality(role_ids) >= 1),
  facility_scope text not null default 'all' check (facility_scope in ('all', 'selected')),
  facility_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  accepted_by uuid references persons (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint invitations_token_unique unique (token_hash),
  constraint invitations_identifier_required check (invitee_phone is not null or invitee_email is not null),
  constraint invitations_facilities_consistent check (facility_scope = 'all' or cardinality(facility_ids) >= 1)
);
create index invitations_org_idx on invitations (organization_id, status);

create table password_resets (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons (id) on delete cascade,
  organization_id uuid references organizations (id),
  token_hash bytea not null,
  created_by uuid references persons (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint password_resets_token_unique unique (token_hash)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  person_id uuid not null references persons (id) on delete cascade,
  auth_level text not null check (auth_level in ('password', 'mfa')),
  organization_id uuid references organizations (id),
  facility_id uuid references facilities (id),
  device_label text check (device_label is null or char_length(device_label) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  constraint sessions_token_unique unique (token_hash)
);
create index sessions_person_idx on sessions (person_id) where revoked_at is null;
create index sessions_org_idx on sessions (organization_id) where revoked_at is null;

-- ---------------------------------------------------------------- audit

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  occurred_at timestamptz not null default now(),
  actor_person_id uuid references persons (id),
  actor_label text not null check (char_length(actor_label) <= 160),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  facility_id uuid,
  request_id text check (request_id is null or char_length(request_id) <= 64),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object')
);
create index audit_events_org_time_idx on audit_events (organization_id, occurred_at desc);

create table platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_person_id uuid references persons (id),
  actor_label text not null check (char_length(actor_label) <= 160),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  organization_id uuid references organizations (id),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  request_id text check (request_id is null or char_length(request_id) <= 64),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object')
);
create index platform_audit_events_time_idx on platform_audit_events (occurred_at desc);

-- ---------------------------------------------------------------- privileges and row-level security

-- Tables only reachable through the functions below.
revoke all on platform_admins, sessions, password_resets, platform_audit_events from clinic_app;
grant select on platform_audit_events to clinic_app;

-- Append-only and never deleted.
revoke update, delete on audit_events from clinic_app;
revoke insert, delete on persons, organizations from clinic_app;
revoke delete on facilities, roles, memberships, invitations from clinic_app;

alter table persons enable row level security;
create policy persons_select on persons for select using (
  id = current_person()
  or is_platform()
  or exists (select 1 from memberships m where m.person_id = persons.id and m.organization_id = current_org())
);
create policy persons_update on persons for update using (id = current_person()) with check (id = current_person());

alter table mfa_recovery_codes enable row level security;
create policy mfa_recovery_codes_own on mfa_recovery_codes
  using (person_id = current_person()) with check (person_id = current_person());

alter table organizations enable row level security;
create policy organizations_select on organizations for select using (id = current_org() or is_platform());
create policy organizations_update on organizations for update
  using (id = current_org() or is_platform()) with check (id = current_org() or is_platform());

alter table facilities enable row level security;
create policy facilities_select on facilities for select
  using ((organization_id = current_org() and has_facility(id)) or is_platform());
create policy facilities_insert on facilities for insert with check (organization_id = current_org() or is_platform());
create policy facilities_update on facilities for update
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table roles enable row level security;
create policy roles_all on roles
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table memberships enable row level security;
create policy memberships_all on memberships
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table membership_roles enable row level security;
create policy membership_roles_all on membership_roles
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table membership_facilities enable row level security;
create policy membership_facilities_all on membership_facilities
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table invitations enable row level security;
create policy invitations_all on invitations
  using (organization_id = current_org() or is_platform()) with check (organization_id = current_org() or is_platform());

alter table audit_events enable row level security;
create policy audit_events_select on audit_events for select using (organization_id = current_org());
create policy audit_events_insert on audit_events for insert with check (organization_id = current_org());

alter table platform_audit_events enable row level security;
create policy platform_audit_events_select on platform_audit_events for select using (is_platform());

-- ---------------------------------------------------------------- sign-in functions

create function auth_find_person(p_identifier text)
  returns table (id uuid, display_name text, password_hash text, locked_until timestamptz, mfa_enabled boolean)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select p.id, p.display_name, p.password_hash, p.locked_until, p.mfa_enabled_at is not null
    from persons p
    where p.phone = p_identifier or p.email = lower(p_identifier)
    limit 1
  $$;

create function auth_record_login(p_person uuid, p_success boolean, p_max_attempts integer, p_lock_minutes integer)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    now_locked boolean;
  begin
    if p_success then
      update persons set failed_logins = 0, locked_until = null, last_login_at = now() where id = p_person;
      return false;
    end if;
    update persons
      set failed_logins = failed_logins + 1,
          locked_until = case when failed_logins + 1 >= p_max_attempts then now() + make_interval(mins => p_lock_minutes) else locked_until end
      where id = p_person
      returning locked_until is not null and locked_until > now() into now_locked;
    return coalesce(now_locked, false);
  end
  $$;

create function auth_is_platform_admin(p_person uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select exists (select 1 from platform_admins where person_id = p_person) $$;

-- The caller's memberships across every organization, for context selection. Only for oneself.
create function my_memberships()
  returns table (
    membership_id uuid, organization_id uuid, org_slug text, org_name text, org_status org_status,
    default_language text, facility_scope text, role_names text[], facilities jsonb
  )
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select m.id, o.id, o.slug, o.name, o.status, o.default_language, m.facility_scope,
      coalesce((select array_agg(r.name order by r.name) from membership_roles mr join roles r on r.id = mr.role_id
                where mr.membership_id = m.id and (r.requires_module is null or r.requires_module = any (o.modules))), '{}'),
      coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.name)
                from facilities f
                where f.organization_id = o.id and f.active
                  and (m.facility_scope = 'all'
                       or exists (select 1 from membership_facilities mf where mf.membership_id = m.id and mf.facility_id = f.id))),
               '[]'::jsonb)
    from memberships m
    join organizations o on o.id = m.organization_id
    where m.person_id = current_person() and m.status = 'active'
    order by o.name
  $$;

-- ---------------------------------------------------------------- session functions

create function session_create(p_hash bytea, p_person uuid, p_level text, p_hours integer, p_device text)
  returns uuid
  language sql security definer set search_path = pg_catalog, public
  as $$
    insert into sessions (token_hash, person_id, auth_level, expires_at, device_label)
    values (p_hash, p_person, p_level, now() + make_interval(hours => p_hours), p_device)
    returning id
  $$;

create function session_set_level(p_session uuid, p_level text) returns void
  language sql security definer set search_path = pg_catalog, public
  as $$ update sessions set auth_level = p_level where id = p_session and person_id = current_person() and revoked_at is null $$;

create function session_set_context(p_session uuid, p_org uuid, p_facility uuid) returns void
  language sql security definer set search_path = pg_catalog, public
  as $$
    update sessions set organization_id = p_org, facility_id = p_facility
    where id = p_session and person_id = current_person() and revoked_at is null
  $$;

create function session_revoke(p_hash bytea, p_reason text) returns void
  language sql security definer set search_path = pg_catalog, public
  as $$ update sessions set revoked_at = now(), revoke_reason = p_reason where token_hash = p_hash and revoked_at is null $$;

-- Ends a person's sessions, or only those whose context is p_org. Allowed for oneself, the platform,
-- or an organization the person belongs to.
create function session_revoke_person(p_person uuid, p_reason text, p_keep_session uuid, p_org uuid default null) returns integer
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    affected integer;
  begin
    if not (p_person = current_person() or is_platform()
            or exists (select 1 from memberships m where m.person_id = p_person and m.organization_id = current_org())) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    update sessions set revoked_at = now(), revoke_reason = p_reason
      where person_id = p_person and revoked_at is null and (p_keep_session is null or id <> p_keep_session)
        and (p_org is null or organization_id = p_org);
    get diagnostics affected = row_count;
    return affected;
  end
  $$;

create function session_revoke_org(p_org uuid, p_reason text) returns integer
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    affected integer;
  begin
    if not is_platform() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    update sessions set revoked_at = now(), revoke_reason = p_reason
      where organization_id = p_org and revoked_at is null;
    get diagnostics affected = row_count;
    return affected;
  end
  $$;

-- Everything the access guard needs in one round trip. Returns no row for an unknown, expired or
-- revoked session. Organization columns are filled only when the person has an active membership
-- in the organization with this slug, so a non-member cannot learn whether a slug exists.
create function request_context(p_hash bytea, p_slug text)
  returns table (
    session_id uuid, person_id uuid, display_name text, auth_level text, mfa_enabled boolean,
    is_platform_admin boolean, context_org uuid, context_facility uuid,
    org_id uuid, org_slug text, org_name text, org_status org_status, org_modules text[],
    membership_id uuid, facility_scope text, facility_ids uuid[], permissions text[]
  )
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    s sessions%rowtype;
  begin
    select * into s from sessions where token_hash = p_hash and revoked_at is null and expires_at > now();
    if not found then
      return;
    end if;
    if s.last_seen_at < now() - interval '1 minute' then
      update sessions set last_seen_at = now() where id = s.id;
    end if;
    return query
      select s.id, p.id, p.display_name, s.auth_level, p.mfa_enabled_at is not null,
        exists (select 1 from platform_admins a where a.person_id = p.id),
        s.organization_id, s.facility_id,
        x.id, x.slug, x.name, x.status, x.modules, x.membership_id, x.facility_scope,
        case when x.membership_id is null then null
             when x.facility_scope = 'all' then null
             else coalesce((select array_agg(mf.facility_id) from membership_facilities mf
                            join facilities f on f.id = mf.facility_id
                            where mf.membership_id = x.membership_id and f.active), '{}') end,
        case when x.membership_id is null then null
             else coalesce((select array_agg(distinct perm) from membership_roles mr
                            join roles r on r.id = mr.role_id
                            cross join lateral unnest(r.permissions) as perm
                            where mr.membership_id = x.membership_id
                              and (r.requires_module is null or r.requires_module = any (x.modules))), '{}') end
      from persons p
      left join lateral (
        select o.id, o.slug, o.name, o.status, o.modules, m.id as membership_id, m.facility_scope
        from organizations o
        join memberships m on m.organization_id = o.id and m.person_id = p.id and m.status = 'active'
        where p_slug is not null and o.slug = p_slug
      ) x on true
      where p.id = s.person_id;
  end
  $$;

-- ---------------------------------------------------------------- organization creation

create function platform_create_organization(
  p_name text, p_slug text, p_currency text, p_language text, p_timezone text, p_date_format text,
  p_facility jsonb, p_roles jsonb
) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    new_org uuid;
    role_spec jsonb;
  begin
    if not is_platform() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    insert into organizations (name, slug, currency, default_language, timezone, date_format, status)
      values (p_name, p_slug, p_currency, p_language, p_timezone, p_date_format, 'provisioning')
      returning id into new_org;
    insert into facilities (organization_id, name, address, city, phone, timezone)
      values (new_org, p_facility ->> 'name', p_facility ->> 'address', p_facility ->> 'city',
              p_facility ->> 'phone', p_facility ->> 'timezone');
    for role_spec in select * from jsonb_array_elements(p_roles) loop
      insert into roles (organization_id, key, name, permissions, system, requires_module)
        values (new_org, role_spec ->> 'key', role_spec ->> 'name',
                array(select jsonb_array_elements_text(role_spec -> 'permissions')), true,
                role_spec ->> 'requiresModule');
    end loop;
    update organizations set status = 'setup_required' where id = new_org;
    return new_org;
  end
  $$;

-- ---------------------------------------------------------------- invitations (public side)

create function invitation_lookup(p_hash bytea)
  returns table (organization_name text, invitee_name text, role_names text[], account_exists boolean, expires_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select o.name, i.invitee_name,
      array(select r.name from roles r where r.id = any (i.role_ids) order by r.name),
      exists (select 1 from persons p where p.phone = i.invitee_phone or p.email = i.invitee_email),
      i.expires_at
    from invitations i
    join organizations o on o.id = i.organization_id
    where i.token_hash = p_hash and i.status = 'pending' and i.expires_at > now()
      and o.status in ('setup_required', 'active')
  $$;

-- Accepts an invitation exactly once. If an account with the invited phone or email exists, the
-- caller must be signed in as that person (p_signed_in). Otherwise a new person is created with
-- p_password_hash. Raises 'invitation_invalid', 'sign_in_required' or 'already_member'.
create function invitation_accept(p_hash bytea, p_signed_in uuid, p_display_name text, p_password_hash text)
  returns table (person_id uuid, organization_id uuid, org_slug text)
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    inv invitations%rowtype;
    org organizations%rowtype;
    existing uuid;
    the_person uuid;
    the_membership uuid;
  begin
    select * into inv from invitations where token_hash = p_hash for update;
    if not found or inv.status <> 'pending' or inv.expires_at <= now() then
      raise exception 'invitation_invalid';
    end if;
    select * into org from organizations where id = inv.organization_id;
    if org.status not in ('setup_required', 'active') then
      raise exception 'invitation_invalid';
    end if;

    select p.id into existing from persons p
      where (inv.invitee_phone is not null and p.phone = inv.invitee_phone)
         or (inv.invitee_email is not null and p.email = inv.invitee_email)
      limit 1;

    if existing is not null then
      if p_signed_in is null or p_signed_in <> existing then
        raise exception 'sign_in_required';
      end if;
      the_person := existing;
    else
      if p_password_hash is null then
        raise exception 'password_required';
      end if;
      insert into persons (display_name, phone, email, password_hash)
        values (coalesce(nullif(btrim(p_display_name), ''), inv.invitee_name), inv.invitee_phone, inv.invitee_email, p_password_hash)
        returning id into the_person;
    end if;

    select m.id into the_membership from memberships m
      where m.organization_id = inv.organization_id and m.person_id = the_person;
    if the_membership is not null then
      if (select m.status from memberships m where m.id = the_membership) = 'active' then
        raise exception 'already_member';
      end if;
      update memberships set status = 'active', deactivated_at = null, deactivated_by = null, facility_scope = inv.facility_scope
        where id = the_membership;
      delete from membership_roles where membership_id = the_membership;
      delete from membership_facilities where membership_id = the_membership;
    else
      insert into memberships (organization_id, person_id, facility_scope)
        values (inv.organization_id, the_person, inv.facility_scope) returning id into the_membership;
    end if;

    insert into membership_roles (membership_id, role_id, organization_id)
      select the_membership, r, inv.organization_id from unnest(inv.role_ids) as r;
    if inv.facility_scope = 'selected' then
      insert into membership_facilities (membership_id, facility_id, organization_id)
        select the_membership, f, inv.organization_id from unnest(inv.facility_ids) as f;
    end if;

    update invitations set status = 'accepted', accepted_by = the_person, accepted_at = now() where id = inv.id;

    insert into audit_events (organization_id, actor_person_id, actor_label, action, target_type, target_id, details)
      values (inv.organization_id, the_person,
              (select display_name from persons where id = the_person),
              'invitation.accepted', 'membership', the_membership::text,
              jsonb_build_object('invitationId', inv.id, 'newAccount', existing is null));

    return query select the_person, inv.organization_id, org.slug;
  end
  $$;

-- ---------------------------------------------------------------- password resets

-- Issues a reset for a person and ends all their sessions. Allowed for the platform, or for an
-- organization the person belongs to (the API checks the staff permission first).
create function reset_issue(p_person uuid, p_hash bytea, p_hours integer, p_created_by uuid)
  returns timestamptz
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    expiry timestamptz := now() + make_interval(hours => p_hours);
  begin
    if not (is_platform()
            or exists (select 1 from memberships m where m.person_id = p_person and m.organization_id = current_org())) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    update password_resets set used_at = now() where person_id = p_person and used_at is null;
    insert into password_resets (person_id, organization_id, token_hash, created_by, expires_at)
      values (p_person, current_org(), p_hash, p_created_by, expiry);
    update sessions set revoked_at = now(), revoke_reason = 'password_reset'
      where person_id = p_person and revoked_at is null;
    return expiry;
  end
  $$;

create function reset_lookup(p_hash bytea) returns table (display_name text, expires_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select p.display_name, r.expires_at from password_resets r join persons p on p.id = r.person_id
    where r.token_hash = p_hash and r.used_at is null and r.expires_at > now()
  $$;

create function reset_complete(p_hash bytea, p_password_hash text) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  declare
    r password_resets%rowtype;
  begin
    select * into r from password_resets where token_hash = p_hash for update;
    if not found or r.used_at is not null or r.expires_at <= now() then
      raise exception 'reset_invalid';
    end if;
    update password_resets set used_at = now() where id = r.id;
    update persons set password_hash = p_password_hash, failed_logins = 0, locked_until = null where id = r.person_id;
    update sessions set revoked_at = now(), revoke_reason = 'password_reset' where person_id = r.person_id and revoked_at is null;
    if r.organization_id is not null then
      insert into audit_events (organization_id, actor_person_id, actor_label, action, target_type, target_id)
        values (r.organization_id, r.person_id, (select display_name from persons where id = r.person_id),
                'password.reset_completed', 'person', r.person_id::text);
    end if;
    return r.person_id;
  end
  $$;

-- ---------------------------------------------------------------- platform audit writer

-- Platform and security events can happen before a platform context exists (for example a failed
-- sign-in), so inserts go through this function. Reading still needs is_platform().
create function platform_audit(
  p_actor uuid, p_actor_label text, p_action text, p_org uuid, p_target_type text, p_target_id text,
  p_request_id text, p_details jsonb
) returns void
  language sql security definer set search_path = pg_catalog, public
  as $$
    insert into platform_audit_events (actor_person_id, actor_label, action, organization_id, target_type, target_id, request_id, details)
    values (p_actor, p_actor_label, p_action, p_org, p_target_type, p_target_id, p_request_id, coalesce(p_details, '{}'::jsonb))
  $$;

-- ---------------------------------------------------------------- function privileges

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to clinic_app', fn);
  end loop;
end
$$;
