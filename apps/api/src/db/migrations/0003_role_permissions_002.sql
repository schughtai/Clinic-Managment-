-- Feature 002: give existing Receptionist and Finance roles their administrative clinic permissions.
-- New organizations get the same lists from ROLE_TEMPLATES; this brings existing ones up to date.
-- Adds only; never removes a permission an administrator has already given.

update roles
set permissions = (
  select array_agg(distinct p order by p)
  from unnest(permissions || array[
    'patients.read', 'patients.create', 'patients.update', 'patients.merge',
    'history.write', 'documents.read', 'documents.upload', 'consent.manage',
    'schedule.read', 'appointments.read', 'appointments.manage', 'queue.manage',
    'invoices.read', 'payments.record', 'refunds.request', 'reminders.send'
  ]::text[]) as p
)
where key = 'receptionist';

update roles
set permissions = (
  select array_agg(distinct p order by p)
  from unnest(permissions || array[
    'patients.read', 'invoices.read', 'invoices.manage', 'payments.record', 'refunds.request',
    'refunds.approve', 'discounts.approve', 'billing.close_day', 'reports.read', 'reports.export'
  ]::text[]) as p
)
where key = 'finance';
