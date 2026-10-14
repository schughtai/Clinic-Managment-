import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, get, messageOf, post } from '../../../api/client';
import { can, useMe } from '../../../auth/session';
import { Alert, Badge, Button, Dialog, ErrorState, PageHeader, Select, Spinner } from '../../../design/components';
import { VoiceTextField } from '../../../design/components/VoiceTextField';
import { type Translate, useT } from '../../../i18n';
import {
  ageText,
  displayName,
  formatPhone,
  HISTORY_LABELS,
  type HistoryEntry,
  type HistorySection,
  type HistorySectionView,
  type PatientDetail,
  SEX_LABELS,
  STATE_LABELS,
} from './shared';

/** Fields shown in the entry dialog for each history section. `required` fields must be filled. */
const SECTION_FIELDS: Record<HistorySection, { key: string; label: string; required?: boolean; multiline?: boolean }[]> = {
  allergy: [
    { key: 'substance', label: 'Substance', required: true },
    { key: 'reaction', label: 'Reaction' },
  ],
  condition: [
    { key: 'name', label: 'Condition', required: true },
    { key: 'since', label: 'Since' },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
  surgery: [
    { key: 'procedure', label: 'Procedure', required: true },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
  medication: [
    { key: 'name', label: 'Medicine', required: true },
    { key: 'dose', label: 'Dose' },
    { key: 'frequency', label: 'How often' },
  ],
  family: [
    { key: 'relation', label: 'Relation', required: true },
    { key: 'condition', label: 'Condition', required: true },
  ],
};

const SEVERITY_LABELS: Record<string, string> = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

/** One line for a stored entry, for example "Penicillin · severe". */
export function entrySummary(entry: HistoryEntry, t: Translate): string {
  const c = entry.content;
  if (entry.section === 'allergy') {
    const severity = typeof c.severity === 'string' ? ` · ${t(SEVERITY_LABELS[c.severity] ?? c.severity)}` : '';
    return `${String(c.substance)}${severity}`;
  }
  if (entry.section === 'condition') return [c.name, c.since].filter(Boolean).map(String).join(' · ');
  if (entry.section === 'surgery') return [c.procedure, c.notes].filter(Boolean).map(String).join(' · ');
  if (entry.section === 'medication') return [c.name, c.dose, c.frequency].filter(Boolean).map(String).join(' · ');
  return `${String(c.relation)}: ${String(c.condition)}`;
}

export function PatientPage() {
  const t = useT();
  const me = useMe();
  const client = useQueryClient();
  const { slug = '', id = '' } = useParams();
  const [adding, setAdding] = useState<HistorySection | null>(null);
  const patient = useQuery({ queryKey: ['patient', slug, id], queryFn: () => get<PatientDetail>(`/orgs/${slug}/patients/${id}`) });
  const canSeeHistory = can(me.data, 'history.read_summary');
  const history = useQuery({
    queryKey: ['history', slug, id],
    queryFn: () => get<HistorySectionView[]>(`/orgs/${slug}/patients/${id}/history`),
    enabled: canSeeHistory,
  });

  if (patient.isPending) return <Spinner />;
  if (patient.isError) return <ErrorState message={messageOf(patient.error)} onRetry={() => void patient.refetch()} />;
  const p = patient.data;
  const name = displayName(p);
  const allergies = history.data?.find((s) => s.section === 'allergy')?.entries ?? [];
  const age = ageText(p, t);

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${p.patientNumber} · ${t(SEX_LABELS[p.sex])} · ${age === '—' ? t('Age not recorded') : `${t('Age')} ${age}`}`}
        actions={
          <Link to={`/app/${slug}/patients`}>
            <Button>{t('Back to patients')}</Button>
          </Link>
        }
      />

      {canSeeHistory && allergies.length > 0 ? (
        <Alert tone="danger" title={t('Allergies')}>
          {allergies.map((entry) => entrySummary(entry, t)).join(' · ')}
        </Alert>
      ) : null}

      <section className="card" aria-labelledby="identity-heading" style={{ marginBottom: 16 }}>
        <h2 id="identity-heading" className="h3">
          {t('Identity and contact')}
        </h2>
        <dl className="details">
          {p.nameUr !== null && p.nameEn !== null ? (
            <>
              <dt>{t('Name (Urdu)')}</dt>
              <dd dir="rtl">{p.nameUr}</dd>
            </>
          ) : null}
          <dt>{t('Phone')}</dt>
          <dd>
            {p.phones.length === 0
              ? '—'
              : p.phones.map((phone) => (
                  <div key={phone.phone}>
                    {formatPhone(phone.phone)} <span className="small muted">({t(phone.label)})</span>
                  </div>
                ))}
          </dd>
          <dt>{t('Address')}</dt>
          <dd>{p.address ?? '—'}</dd>
          <dt>{t('Emergency contact')}</dt>
          <dd>
            {p.emergencyContactName ?? '—'}
            {p.emergencyContactPhone !== null ? ` · ${p.emergencyContactPhone}` : ''}
          </dd>
        </dl>
      </section>

      {canSeeHistory ? (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="h3">
            {t('Medical history')}
          </h2>
          {history.isPending ? (
            <Spinner />
          ) : history.isError ? (
            <ErrorState message={messageOf(history.error)} onRetry={() => void history.refetch()} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {history.data.map((section) => (
                <HistoryCard
                  key={section.section}
                  section={section}
                  canWrite={can(me.data, 'history.write')}
                  onAdd={() => setAdding(section.section)}
                  onAssess={async (state) => {
                    await post(`/orgs/${slug}/patients/${id}/assessments`, { section: section.section, state });
                    await client.invalidateQueries({ queryKey: ['history', slug, id] });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <Alert tone="info">{t('Medical history is not shown for your role.')}</Alert>
      )}

      {adding !== null ? (
        <HistoryDialog
          slug={slug}
          patientId={id}
          section={adding}
          onClose={() => setAdding(null)}
          onSaved={async () => {
            await client.invalidateQueries({ queryKey: ['history', slug, id] });
            setAdding(null);
          }}
        />
      ) : null}
    </>
  );
}

function HistoryCard({
  section,
  canWrite,
  onAdd,
  onAssess,
}: {
  section: HistorySectionView;
  canWrite: boolean;
  onAdd: () => void;
  onAssess: (state: 'unknown' | 'patient_reports_none') => Promise<void>;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const hasEntries = section.entries.length > 0;
  const tone = section.state === 'has_entries' ? 'success' : section.state === 'not_assessed' ? 'warning' : 'neutral';

  return (
    <article className="card" aria-labelledby={`section-${section.section}`}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 id={`section-${section.section}`} className="h4">
          {t(HISTORY_LABELS[section.section])}
        </h3>
        <Badge tone={tone}>{t(STATE_LABELS[section.state])}</Badge>
      </header>
      {hasEntries ? (
        <ul>
          {section.entries.map((entry) => (
            <li key={entry.id}>{entrySummary(entry, t)}</li>
          ))}
        </ul>
      ) : null}
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {canWrite ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>
            {t('Add')}
          </Button>
          {!hasEntries ? (
            <>
              <Button
                size="sm"
                onClick={() => onAssess('patient_reports_none').catch((caught: unknown) => setError(messageOf(caught)))}
              >
                {t('Patient reports none')}
              </Button>
              <Button size="sm" onClick={() => onAssess('unknown').catch((caught: unknown) => setError(messageOf(caught)))}>
                {t('Unknown')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function HistoryDialog({
  slug,
  patientId,
  section,
  onClose,
  onSaved,
}: {
  slug: string;
  patientId: string;
  section: HistorySection;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const fields = SECTION_FIELDS[section];
  const [values, setValues] = useState<Record<string, string>>({});
  const [severity, setSeverity] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    const content: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.key]?.trim();
      if (value) content[field.key] = value;
    }
    if (section === 'allergy' && severity !== '') content.severity = severity;
    try {
      await post(`/orgs/${slug}/patients/${patientId}/history`, { section, content, source: 'clinician_recorded' });
      await onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fieldErrors = caught.fieldErrors();
        const mapped: Record<string, string> = {};
        for (const [path, message] of Object.entries(fieldErrors)) mapped[path.replace(/^content\./, '')] = message;
        setErrors(mapped);
      }
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`${t('Add')} · ${t(HISTORY_LABELS[section])}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" form="history-form" loading={busy} disabled={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <form id="history-form" onSubmit={submit} noValidate style={{ display: 'grid', gap: 12 }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {fields.map((field) =>
          field.multiline ? (
            <VoiceTextField
              key={field.key}
              name={field.key}
              label={t(field.label)}
              multiline
              required={field.required}
              value={values[field.key] ?? ''}
              onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              error={errors[field.key]}
            />
          ) : (
            <VoiceTextField
              key={field.key}
              name={field.key}
              label={t(field.label)}
              required={field.required}
              maxLength={160}
              value={values[field.key] ?? ''}
              onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              error={errors[field.key]}
            />
          ),
        )}
        {section === 'allergy' ? (
          <label>
            {t('Severity')}
            <Select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              options={[
                { value: '', label: t('Not recorded') },
                { value: 'mild', label: t('Mild') },
                { value: 'moderate', label: t('Moderate') },
                { value: 'severe', label: t('Severe') },
              ]}
            />
          </label>
        ) : null}
      </form>
    </Dialog>
  );
}
