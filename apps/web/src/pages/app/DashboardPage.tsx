import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, get, messageOf, post } from '../../api/client';
import { can, ME_KEY, useMe } from '../../auth/session';
import { Alert, Badge, Button, ErrorState, PageHeader, Spinner } from '../../design/components';
import { useT } from '../../i18n';

interface Dashboard {
  status: string;
  setupChecks: Array<{ key: string; ok: boolean; link: string }>;
  counts: { facilities: number; activeStaff: number; pendingInvitations: number };
}

const CHECK_LABEL: Record<string, string> = {
  profile: 'Organization profile (name, phone, address)',
  facility: 'A branch with address, timezone and opening hours',
  admin: 'An active administrator',
};

export function DashboardPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const me = useMe();
  const client = useQueryClient();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dashboard = useQuery({ queryKey: ['dashboard', slug], queryFn: () => get<Dashboard>(`/orgs/${slug}/dashboard`) });

  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) return <ErrorState message={messageOf(dashboard.error)} onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const allDone = data.setupChecks.every((check) => check.ok);

  const activate = async () => {
    setActivating(true);
    setError(null);
    try {
      await post(`/orgs/${slug}/activate`);
      await Promise.all([client.invalidateQueries({ queryKey: ['dashboard', slug] }), client.invalidateQueries({ queryKey: ME_KEY })]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : messageOf(caught));
    } finally {
      setActivating(false);
    }
  };

  return (
    <>
      <PageHeader title={t('Dashboard')} subtitle={me.data?.org?.name} />
      <div className="stack">
        {data.status === 'setup_required' ? (
          <section className="card stack" aria-labelledby="setup">
            <h2 id="setup">{t('Setup checklist')}</h2>
            {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.setupChecks.map((check) => (
                <li key={check.key} className="row">
                  <Badge tone={check.ok ? 'success' : 'warning'}>{check.ok ? t('Done') : t('Missing')}</Badge>
                  <span className="spacer">{t(CHECK_LABEL[check.key] ?? check.key)}</span>
                  {!check.ok && can(me.data, 'organization.update') ? <Link to={`/app/${slug}/${check.link}`}>{t('Fix')}</Link> : null}
                </li>
              ))}
            </ul>
            {can(me.data, 'organization.update') ? (
              <div className="row">
                <Button variant="primary" disabled={!allDone} loading={activating} onClick={() => void activate()}>
                  {t('Activate organization')}
                </Button>
                {!allDone ? <span className="small muted">{t('Finish the items above first.')}</span> : null}
              </div>
            ) : (
              <p className="small muted">{t('An administrator is finishing the setup.')}</p>
            )}
          </section>
        ) : null}
        <div className="grid-2">
          <Stat label={t('Branches')} value={data.counts.facilities} />
          <Stat label={t('Active staff')} value={data.counts.activeStaff} />
          <Stat label={t('Pending invitations')} value={data.counts.pendingInvitations} />
        </div>
        <p className="small muted">{t('Patients, appointments, queue and billing arrive with the next release.')}</p>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stack-sm">
      <span className="small muted">{label}</span>
      <strong className="num" style={{ fontSize: 'var(--fs-2xl)' }}>
        {value}
      </strong>
    </div>
  );
}
