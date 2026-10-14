import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, messageOf, post } from '../../../api/client';
import { Alert, Button, Checkbox, Field, PageHeader, Select, TextInput } from '../../../design/components';
import { VoiceTextField } from '../../../design/components/VoiceTextField';
import { type Translate, useT } from '../../../i18n';
import { SEX_LABELS, type Sex, type PhoneLabel } from './shared';

interface DuplicateCandidate {
  id: string;
  patientNumber: string;
  name: string | null;
  reason: 'phone' | 'name';
}

interface Form {
  nameEn: string;
  nameUr: string;
  sex: Sex;
  ageMode: 'dob' | 'approx' | 'unknown';
  dateOfBirth: string;
  approximateAge: string;
  phone: string;
  phoneLabel: PhoneLabel;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

const EMPTY: Form = {
  nameEn: '',
  nameUr: '',
  sex: 'unknown',
  ageMode: 'unknown',
  dateOfBirth: '',
  approximateAge: '',
  phone: '',
  phoneLabel: 'mobile',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

const sexOptions = (t: Translate) => (Object.keys(SEX_LABELS) as Sex[]).map((value) => ({ value, label: t(SEX_LABELS[value]) }));

/** Registration. A likely duplicate is shown before saving; the receptionist decides whether to save anyway. */
export function NewPatientPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { slug = '' } = useParams();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = {
        nameEn: form.nameEn,
        nameUr: form.nameUr,
        sex: form.sex,
        dateOfBirth: form.ageMode === 'dob' && form.dateOfBirth !== '' ? form.dateOfBirth : undefined,
        approximateAge: form.ageMode === 'approx' && form.approximateAge !== '' ? Number(form.approximateAge) : undefined,
        address: form.address,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        phones: form.phone.trim() === '' ? [] : [{ phone: form.phone, label: form.phoneLabel }],
        confirmDuplicates,
      };
      const created = await post<{ id: string }>(`/orgs/${slug}/patients`, body);
      await client.invalidateQueries({ queryKey: ['patients', slug] });
      navigate(`/app/${slug}/patients/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'possible_duplicates') {
        const details = caught.details as { duplicates?: DuplicateCandidate[] } | undefined;
        setDuplicates(details?.duplicates ?? []);
      } else {
        if (caught instanceof ApiError) setErrors(caught.fieldErrors());
        setError(messageOf(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('New patient')} subtitle={t('Enter the name in English or Urdu. Other fields can be filled in later.')} />
      <form onSubmit={submit} noValidate style={{ maxWidth: 680, display: 'grid', gap: 16 }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

        {duplicates.length > 0 ? (
          <Alert tone="warning" title={t('Check for an existing patient first')}>
            <p>{t('These records look similar. If one is the same person, open it instead of creating a new record.')}</p>
            <ul>
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link to={`/app/${slug}/patients/${candidate.id}`}>
                    {candidate.patientNumber} · {candidate.name ?? '—'}
                  </Link>{' '}
                  <span className="small">({candidate.reason === 'phone' ? t('same phone number') : t('similar name')})</span>
                </li>
              ))}
            </ul>
            <Checkbox
              label={t('This is a different person. Save as a new patient.')}
              checked={confirmDuplicates}
              onChange={(event) => setConfirmDuplicates(event.target.checked)}
            />
          </Alert>
        ) : null}

        <Field label={t('Name (English)')} error={errors.nameEn}>
          {(props) => <TextInput {...props} value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} maxLength={120} autoComplete="off" />}
        </Field>
        <Field label={t('Name (Urdu)')} error={errors.nameUr}>
          {(props) => <TextInput {...props} dir="rtl" value={form.nameUr} onChange={(e) => set('nameUr', e.target.value)} maxLength={120} />}
        </Field>

        <Field label={t('Sex')}>
          {(props) => <Select {...props} options={sexOptions(t)} value={form.sex} onChange={(e) => set('sex', e.target.value as Sex)} />}
        </Field>

        <Field label={t('Age')} error={errors.dateOfBirth ?? errors.approximateAge}>
          {(props) => (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Select
                {...props}
                aria-label={t('Age')}
                value={form.ageMode}
                onChange={(e) => set('ageMode', e.target.value as Form['ageMode'])}
                options={[
                  { value: 'unknown', label: t('Not known') },
                  { value: 'dob', label: t('Date of birth') },
                  { value: 'approx', label: t('Approximate age') },
                ]}
              />
              {form.ageMode === 'dob' ? (
                <TextInput type="date" aria-label={t('Date of birth')} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              ) : null}
              {form.ageMode === 'approx' ? (
                <TextInput
                  type="number"
                  min={0}
                  max={130}
                  aria-label={t('Approximate age')}
                  value={form.approximateAge}
                  onChange={(e) => set('approximateAge', e.target.value)}
                />
              ) : null}
            </div>
          )}
        </Field>

        <Field label={t('Phone')} hint={t('For example 0300 1234567')} error={errors['phones.0.phone']}>
          {(props) => (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <TextInput {...props} type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              <Select
                aria-label={t('Phone type')}
                value={form.phoneLabel}
                onChange={(e) => set('phoneLabel', e.target.value as PhoneLabel)}
                options={[
                  { value: 'mobile', label: t('Mobile') },
                  { value: 'home', label: t('Home') },
                  { value: 'emergency', label: t('Emergency') },
                  { value: 'other', label: t('Other') },
                ]}
              />
            </div>
          )}
        </Field>

        <VoiceTextField label={t('Address')} multiline maxLength={300} value={form.address} onChange={(value) => set('address', value)} error={errors.address} />
        <VoiceTextField
          label={t('Emergency contact name')}
          maxLength={120}
          value={form.emergencyContactName}
          onChange={(value) => set('emergencyContactName', value)}
          error={errors.emergencyContactName}
        />
        <Field label={t('Emergency contact phone')} error={errors.emergencyContactPhone}>
          {(props) => (
            <TextInput {...props} type="tel" inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
          )}
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link to={`/app/${slug}/patients`}>
            <Button>{t('Cancel')}</Button>
          </Link>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || (duplicates.length > 0 && !confirmDuplicates)}>
            {t('Save patient')}
          </Button>
        </div>
      </form>
    </>
  );
}
