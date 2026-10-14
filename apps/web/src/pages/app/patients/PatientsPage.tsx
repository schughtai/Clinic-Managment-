import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { get, messageOf } from '../../../api/client';
import { can, useMe } from '../../../auth/session';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner, TextInput } from '../../../design/components';
import { useT } from '../../../i18n';
import { ageText, displayName, type PatientSummary, SEX_LABELS } from './shared';

/** Search by name (any spelling), patient number or phone. Results are the same for every branch. */
export function PatientsPage() {
  const t = useT();
  const me = useMe();
  const { slug = '' } = useParams();
  const [query, setQuery] = useState('');
  const term = query.trim();
  const patients = useQuery({
    queryKey: ['patients', slug, term],
    queryFn: () => get<PatientSummary[]>(`/orgs/${slug}/patients?q=${encodeURIComponent(term)}`),
  });

  return (
    <>
      <PageHeader
        title={t('Patients')}
        subtitle={t('Search by name, patient number or phone. Every branch sees the same patients.')}
        actions={
          can(me.data, 'patients.create') ? (
            <Link to={`/app/${slug}/patients/new`}>
              <Button variant="primary" icon="plus">
                {t('New patient')}
              </Button>
            </Link>
          ) : undefined
        }
      />
      <TextInput
        type="search"
        aria-label={t('Search patients')}
        placeholder={t('Name, patient number or phone')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ maxWidth: 480, marginBottom: 16 }}
      />

      {term === '' ? (
        <EmptyState title={t('Start typing to find a patient')} message={t('Results appear as you type.')} />
      ) : patients.isPending ? (
        <Spinner />
      ) : patients.isError ? (
        <ErrorState message={messageOf(patients.error)} onRetry={() => void patients.refetch()} />
      ) : patients.data.length === 0 ? (
        <EmptyState
          title={t('No patient matches')}
          message={t('Check the spelling, or try the phone number or patient number.')}
          action={
            can(me.data, 'patients.create') ? (
              <Link to={`/app/${slug}/patients/new`}>
                <Button variant="primary" icon="plus">
                  {t('New patient')}
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Number')}</th>
                <th>{t('Name')}</th>
                <th>{t('Sex')}</th>
                <th>{t('Age')}</th>
              </tr>
            </thead>
            <tbody>
              {patients.data.map((patient) => (
                <tr key={patient.id}>
                  <td data-label={t('Number')}>
                    <Link to={`/app/${slug}/patients/${patient.id}`}>{patient.patientNumber}</Link>
                  </td>
                  <td data-label={t('Name')}>
                    <strong>{displayName(patient)}</strong>
                    {patient.nameEn !== null && patient.nameUr !== null ? <div className="small muted" dir="rtl">{patient.nameUr}</div> : null}
                  </td>
                  <td data-label={t('Sex')}>
                    <Badge>{t(SEX_LABELS[patient.sex])}</Badge>
                  </td>
                  <td data-label={t('Age')}>{ageText(patient, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
