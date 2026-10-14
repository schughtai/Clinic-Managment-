import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, get, messageOf, post, put } from '../../../api/client';
import { ME_KEY } from '../../../auth/session';
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, Field, PageHeader, Select, Spinner, TextInput } from '../../../design/components';
import { VoiceTextField } from '../../../design/components/VoiceTextField';
import { type Translate, useT } from '../../../i18n';
import { TIMEZONES } from './OrganizationSettingsPage';

export interface OpeningRange {
  day: number;
  opens: string;
  closes: string;
}

export interface Facility {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  openingHours: OpeningRange[];
  active: boolean;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function summarizeHours(hours: OpeningRange[], t: Translate): string {
  if (hours.length === 0) return t('No opening hours yet');
  const byDay = new Map<number, string[]>();
  for (const range of [...hours].sort((a, b) => a.day - b.day || a.opens.localeCompare(b.opens))) {
    byDay.set(range.day, [...(byDay.get(range.day) ?? []), `${range.opens}–${range.closes}`]);
  }
  return [...byDay.entries()].map(([day, ranges]) => `${t(DAY_NAMES[day]!).slice(0, 3)} ${ranges.join(', ')}`).join(' · ');
}

export function FacilitiesPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const [editing, setEditing] = useState<Facility | 'new' | null>(null);
  const facilities = useQuery({ queryKey: ['facilities', slug], queryFn: () => get<Facility[]>(`/orgs/${slug}/facilities`) });

  return (
    <>
      <PageHeader
        title={t('Branches')}
        subtitle={t('Each branch has its own address, hours and staff access.')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            {t('Add branch')}
          </Button>
        }
      />
      {facilities.isPending ? (
        <Spinner />
      ) : facilities.isError ? (
        <ErrorState message={messageOf(facilities.error)} onRetry={() => void facilities.refetch()} />
      ) : facilities.data.length === 0 ? (
        <EmptyState title={t('No branches you can see')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Address')}</th>
                <th>{t('Opening hours')}</th>
                <th>{t('Status')}</th>
                <th>
                  <span className="visually-hidden">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {facilities.data.map((facility) => (
                <tr key={facility.id}>
                  <td data-label={t('Name')}>
                    <strong>{facility.name}</strong>
                    {facility.city !== null ? <div className="small muted">{facility.city}</div> : null}
                  </td>
                  <td data-label={t('Address')}>{facility.address ?? <span className="muted">—</span>}</td>
                  <td data-label={t('Opening hours')} className="small">
                    {summarizeHours(facility.openingHours, t)}
                  </td>
                  <td data-label={t('Status')}>
                    <Badge tone={facility.active ? 'success' : 'neutral'}>{facility.active ? t('Active') : t('Inactive')}</Badge>
                  </td>
                  <td>
                    <Button size="sm" onClick={() => setEditing(facility)}>
                      {t('Edit')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null ? <FacilityDrawer slug={slug} facility={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function FacilityDrawer({ slug, facility, onClose }: { slug: string; facility: Facility | null; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: facility?.name ?? '',
    address: facility?.address ?? '',
    city: facility?.city ?? '',
    phone: facility?.phone === null || facility?.phone === undefined ? '' : `+${facility.phone}`,
    timezone: facility?.timezone ?? '',
    active: facility?.active ?? true,
  });
  const [hours, setHours] = useState<OpeningRange[]>(
    facility?.openingHours ?? [1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '09:00', closes: '17:00' })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = { ...form, openingHours: hours };
      if (facility === null) await post(`/orgs/${slug}/facilities`, body);
      else await put(`/orgs/${slug}/facilities/${facility.id}`, body);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['facilities', slug] }),
        client.invalidateQueries({ queryKey: ['dashboard', slug] }),
        client.invalidateQueries({ queryKey: ME_KEY }),
      ]);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setErrors(caught.fieldErrors());
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      drawer
      title={facility === null ? t('Add branch') : t('Edit branch')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button type="submit" form="facility-form" variant="primary" loading={busy} disabled={form.name.trim() === ''}>
            {t('Save')}
          </Button>
        </>
      }
    >
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form id="facility-form" className="stack" onSubmit={(event) => void save(event)} noValidate>
        <Field label={t('Branch name')} required error={errors.name}>
          {(props) => <TextInput {...props} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
        </Field>
        <VoiceTextField label={t('Address')} value={form.address} onChange={(address) => setForm({ ...form, address })} maxLength={300} error={errors.address} />
        <div className="grid-2">
          <Field label={t('City')} error={errors.city}>
            {(props) => <TextInput {...props} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />}
          </Field>
          <Field label={t('Phone')} error={errors.phone}>
            {(props) => <TextInput {...props} type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
          </Field>
        </div>
        <Field label={t('Timezone')} hint={t('Leave as organization default unless this branch is elsewhere.')} error={errors.timezone}>
          {(props) => (
            <Select
              {...props}
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              options={[{ value: '', label: t('Organization default') }, ...TIMEZONES.map((zone) => ({ value: zone, label: zone }))]}
            />
          )}
        </Field>
        <OpeningHoursEditor value={hours} onChange={setHours} error={errors.openingHours ?? errors[''] ?? Object.entries(errors).find(([key]) => key.startsWith('openingHours'))?.[1]} />
        <Checkbox label={t('Branch is open for business')} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
      </form>
    </Dialog>
  );
}

/** One row per range; days can have several ranges, such as a lunch break. */
export function OpeningHoursEditor({ value, onChange, error }: { value: OpeningRange[]; onChange: (value: OpeningRange[]) => void; error?: string | undefined }) {
  const t = useT();
  const update = (index: number, patch: Partial<OpeningRange>) => onChange(value.map((range, i) => (i === index ? { ...range, ...patch } : range)));
  return (
    <fieldset className="stack-sm">
      <legend>{t('Opening hours')}</legend>
      {value.length === 0 ? <p className="small muted">{t('No opening hours yet')}</p> : null}
      {value.map((range, index) => (
        <div key={index} className="row">
          <Select
            aria-label={t('Day')}
            value={String(range.day)}
            onChange={(event) => update(index, { day: Number(event.target.value) })}
            style={{ inlineSize: 'auto' }}
            options={DAY_NAMES.map((day, number) => ({ value: String(number), label: t(day) }))}
          />
          <TextInput aria-label={t('Opens')} type="time" value={range.opens} onChange={(event) => update(index, { opens: event.target.value })} style={{ inlineSize: 'auto' }} />
          <span aria-hidden>–</span>
          <TextInput aria-label={t('Closes')} type="time" value={range.closes} onChange={(event) => update(index, { closes: event.target.value })} style={{ inlineSize: 'auto' }} />
          <Button size="sm" variant="tertiary" icon="x" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, i) => i !== index))} />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" onClick={() => onChange([...value, { day: 1, opens: '09:00', closes: '17:00' }])}>
          {t('Add hours')}
        </Button>
      </div>
      {error !== undefined ? (
        <span className="error" role="alert">
          {t(error)}
        </span>
      ) : null}
    </fieldset>
  );
}
