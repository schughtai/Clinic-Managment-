import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, get, messageOf, post } from '../../api/client';
import { Alert, Button, Dialog, EmptyState, ErrorState, Field, PageHeader, Select, Spinner, TextInput } from '../../design/components';
import { OrgStatusBadge } from '../../design/components/OrgStatusBadge';
import { useT } from '../../i18n';

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  facilityCount: number;
  activeStaffCount: number;
  lastActivityAt: string | null;
  modules: string[];
  createdAt: string;
}

export function OrganizationsPage() {
  const t = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (q.trim() !== '') params.set('q', q.trim());
  if (status !== '') params.set('status', status);
  const list = useQuery({
    queryKey: ['platform', 'organizations', q.trim(), status],
    queryFn: () => get<OrganizationSummary[]>(`/platform/organizations?${params.toString()}`),
  });

  return (
    <>
      <PageHeader
        title={t('Organizations')}
        subtitle={t('Clinics and hospital groups using the platform.')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('New organization')}
          </Button>
        }
      />
      <div className="row" style={{ marginBlockEnd: 'var(--s-4)' }}>
        <div style={{ flex: '1 1 240px' }}>
          <TextInput type="search" placeholder={t('Search by name or web address')} aria-label={t('Search')} value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <Select
          aria-label={t('Status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          style={{ inlineSize: 'auto' }}
          options={[
            { value: '', label: t('All statuses') },
            { value: 'setup_required', label: t('Setup required') },
            { value: 'active', label: t('Active') },
            { value: 'suspended', label: t('Suspended') },
            { value: 'deactivated', label: t('Deactivated') },
          ]}
        />
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={q !== '' || status !== '' ? t('No organizations match') : t('No organizations yet')}
          message={q !== '' || status !== '' ? undefined : t('Create the first clinic to get started.')}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Status')}</th>
                <th>{t('Branches')}</th>
                <th>{t('Active staff')}</th>
                <th>{t('Last sign-in')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((org) => (
                <tr key={org.id}>
                  <td data-label={t('Name')}>
                    <Link to={`/platform/organizations/${org.id}`}>{org.name}</Link>
                    <div className="small muted">{org.slug}</div>
                  </td>
                  <td data-label={t('Status')}>
                    <OrgStatusBadge status={org.status} />
                  </td>
                  <td data-label={t('Branches')} className="num">
                    {org.facilityCount}
                  </td>
                  <td data-label={t('Active staff')} className="num">
                    {org.activeStaffCount}
                  </td>
                  <td data-label={t('Last sign-in')} className="small">
                    {org.lastActivityAt === null ? '—' : new Date(org.lastActivityAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <CreateOrganizationDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function CreateOrganizationDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    currency: 'PKR',
    defaultLanguage: 'en',
    timezone: 'Asia/Karachi',
    facilityName: 'Main Branch',
    facilityCity: '',
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value, ...(key === 'name' && !slugEdited ? { slug: slugify(value) } : {}) }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const created = await post<{ id: string }>('/platform/organizations', {
        name: form.name,
        slug: form.slug,
        currency: form.currency,
        defaultLanguage: form.defaultLanguage,
        timezone: form.timezone,
        facility: { name: form.facilityName, city: form.facilityCity },
      });
      await client.invalidateQueries({ queryKey: ['platform', 'organizations'] });
      void navigate(`/platform/organizations/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fieldErrors());
        if (caught.code === 'slug_taken') setErrors({ slug: caught.message });
      }
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('New organization')}
      onClose={onClose}
      drawer
      actions={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" form="create-org" loading={busy} disabled={form.name.trim() === '' || form.slug === ''}>
            {t('Create organization')}
          </Button>
        </>
      }
    >
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form id="create-org" className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('Organization name')} required error={errors.name}>
          {(props) => <TextInput {...props} value={form.name} onChange={(event) => set('name', event.target.value)} />}
        </Field>
        <Field label={t('Web address')} required error={errors.slug} hint={t('Staff will open /app/{slug}.', { slug: form.slug || '…' })}>
          {(props) => (
            <TextInput
              {...props}
              value={form.slug}
              onChange={(event) => {
                setSlugEdited(true);
                set('slug', event.target.value.toLowerCase());
              }}
            />
          )}
        </Field>
        <div className="grid-2">
          <Field label={t('Currency')} error={errors.currency}>
            {(props) => <TextInput {...props} value={form.currency} maxLength={3} onChange={(event) => set('currency', event.target.value.toUpperCase())} />}
          </Field>
          <Field label={t('Language')}>
            {(props) => (
              <Select
                {...props}
                value={form.defaultLanguage}
                onChange={(event) => set('defaultLanguage', event.target.value)}
                options={[
                  { value: 'en', label: t('English') },
                  { value: 'ur', label: t('Urdu') },
                ]}
              />
            )}
          </Field>
        </div>
        <Field label={t('Timezone')} error={errors.timezone}>
          {(props) => <TextInput {...props} value={form.timezone} onChange={(event) => set('timezone', event.target.value)} />}
        </Field>
        <fieldset className="stack">
          <legend>{t('First branch')}</legend>
          <Field label={t('Branch name')} required error={errors['facility.name']}>
            {(props) => <TextInput {...props} value={form.facilityName} onChange={(event) => set('facilityName', event.target.value)} />}
          </Field>
          <Field label={t('City')}>{(props) => <TextInput {...props} value={form.facilityCity} onChange={(event) => set('facilityCity', event.target.value)} />}</Field>
        </fieldset>
      </form>
    </Dialog>
  );
}
