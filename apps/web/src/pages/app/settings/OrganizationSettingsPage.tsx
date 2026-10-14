import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, get, messageOf, put } from '../../../api/client';
import { ME_KEY } from '../../../auth/session';
import { Alert, Button, ErrorState, Field, PageHeader, Select, Spinner, TextInput } from '../../../design/components';
import { VoiceTextField } from '../../../design/components/VoiceTextField';
import { useT } from '../../../i18n';

export interface OrganizationSettings {
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  defaultLanguage: 'en' | 'ur';
  timezone: string;
  dateFormat: string;
  status: string;
  modules: string[];
}

/** Common choices first; any IANA zone or ISO currency is accepted by the server. */
export const TIMEZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kuala_Lumpur', 'Europe/London', 'UTC'];
const CURRENCIES = ['PKR', 'AED', 'SAR', 'MYR', 'GBP', 'USD'];

export function OrganizationSettingsPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const settings = useQuery({ queryKey: ['settings', slug], queryFn: () => get<OrganizationSettings>(`/orgs/${slug}/settings`) });
  if (settings.isPending) return <Spinner />;
  if (settings.isError) return <ErrorState message={messageOf(settings.error)} onRetry={() => void settings.refetch()} />;
  return (
    <>
      <PageHeader title={t('Organization')} subtitle={t('Profile and regional settings used across all branches.')} />
      <SettingsForm slug={slug} initial={settings.data} />
    </>
  );
}

function SettingsForm({ slug, initial }: { slug: string; initial: OrganizationSettings }) {
  const t = useT();
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: initial.name,
    legalName: initial.legalName ?? '',
    phone: initial.phone === null ? '' : `+${initial.phone}`,
    email: initial.email ?? '',
    address: initial.address ?? '',
    currency: initial.currency,
    defaultLanguage: initial.defaultLanguage,
    timezone: initial.timezone,
    dateFormat: initial.dateFormat,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await put(`/orgs/${slug}/settings`, form);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['settings', slug] }),
        client.invalidateQueries({ queryKey: ['dashboard', slug] }),
        client.invalidateQueries({ queryKey: ME_KEY }),
      ]);
      setMessage({ tone: 'success', text: t('Saved') });
    } catch (caught) {
      if (caught instanceof ApiError) setErrors(caught.fieldErrors());
      setMessage({ tone: 'danger', text: t(messageOf(caught)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(event) => void save(event)} noValidate>
      {message !== null ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <section className="card stack">
        <h2>{t('Profile')}</h2>
        <div className="grid-2">
          <Field label={t('Organization name')} required error={errors.name}>
            {(props) => <TextInput {...props} value={form.name} onChange={(event) => set('name', event.target.value)} />}
          </Field>
          <Field label={t('Legal name')} error={errors.legalName}>
            {(props) => <TextInput {...props} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} />}
          </Field>
          <Field label={t('Phone')} error={errors.phone} hint={t('Needed before activation.')}>
            {(props) => <TextInput {...props} type="tel" value={form.phone} onChange={(event) => set('phone', event.target.value)} placeholder="0300 1234567" />}
          </Field>
          <Field label={t('Email')} error={errors.email}>
            {(props) => <TextInput {...props} type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />}
          </Field>
        </div>
        <VoiceTextField label={t('Address')} value={form.address} onChange={(value) => set('address', value)} multiline maxLength={300} error={errors.address} hint={t('Needed before activation.')} />
      </section>
      <section className="card stack">
        <h2>{t('Regional settings')}</h2>
        <div className="grid-2">
          <Field label={t('Currency')} error={errors.currency}>
            {(props) => (
              <Select
                {...props}
                value={form.currency}
                onChange={(event) => set('currency', event.target.value)}
                options={[...new Set([form.currency, ...CURRENCIES])].map((code) => ({ value: code, label: code }))}
              />
            )}
          </Field>
          <Field label={t('Default language')}>
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
          <Field label={t('Timezone')} error={errors.timezone}>
            {(props) => (
              <Select
                {...props}
                value={form.timezone}
                onChange={(event) => set('timezone', event.target.value)}
                options={[...new Set([form.timezone, ...TIMEZONES])].map((zone) => ({ value: zone, label: zone }))}
              />
            )}
          </Field>
          <Field label={t('Date format')}>
            {(props) => (
              <Select
                {...props}
                value={form.dateFormat}
                onChange={(event) => set('dateFormat', event.target.value)}
                options={['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy'].map((value) => ({ value, label: value }))}
              />
            )}
          </Field>
        </div>
      </section>
      <div className="row">
        <Button type="submit" variant="primary" loading={busy}>
          {t('Save changes')}
        </Button>
      </div>
    </form>
  );
}
