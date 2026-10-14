import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { messageOf, post } from '../../api/client';
import type { Me, MembershipSummary } from '../../api/types';
import { ME_KEY, RequireSession, useMe } from '../../auth/session';
import { Alert, Button, Spinner } from '../../design/components';
import { OrgStatusBadge } from '../../design/components/OrgStatusBadge';
import { useT } from '../../i18n';
import { AuthLayout } from './AuthLayout';

/** Explicit choice of organization (and branch) for people with more than one (FR-012). */
export function ChooseContextPage() {
  return (
    <RequireSession>
      <Choose />
    </RequireSession>
  );
}

function Choose() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me.data === undefined) return <Spinner />;
  if (me.data === null) return <Navigate to="/login" replace />;
  const data = me.data;

  const open = async (membership: MembershipSummary, facilityId: string | null) => {
    setBusy(`${membership.orgSlug}:${facilityId ?? ''}`);
    setError(null);
    try {
      client.setQueryData(ME_KEY, await post<Me>('/auth/context', { orgSlug: membership.orgSlug, facilityId }));
      void navigate(`/app/${membership.orgSlug}/dashboard`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  const openPlatform = async () => {
    setBusy('platform');
    try {
      await post('/auth/context', { orgSlug: null });
      void navigate('/platform');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout title={t('Choose where to work')} subtitle={data.person.displayName}>
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {data.isPlatformAdmin ? (
          <li className="card stack-sm" style={{ padding: 'var(--s-4)' }}>
            <strong>{t('Platform administration')}</strong>
            <Button variant="primary" loading={busy === 'platform'} onClick={() => void openPlatform()}>
              {t('Open')}
            </Button>
          </li>
        ) : null}
        {data.memberships.map((membership) => {
          const operating = membership.orgStatus === 'active' || membership.orgStatus === 'setup_required';
          return (
            <li key={membership.orgSlug} className="card stack-sm" style={{ padding: 'var(--s-4)' }}>
              <div className="row">
                <strong className="spacer">{membership.orgName}</strong>
                <OrgStatusBadge status={membership.orgStatus} />
              </div>
              <span className="small muted">{membership.roles.join(', ')}</span>
              {!operating ? (
                <span className="small">{t('This organization is suspended. Contact the platform administrator.')}</span>
              ) : membership.facilities.length === 0 ? (
                <Alert tone="warning">{t('You are not assigned to any branch yet. Ask your administrator to give you access.')}</Alert>
              ) : (
                <div className="row">
                  {membership.facilities.map((facility) => (
                    <Button
                      key={facility.id}
                      variant={membership.facilities.length === 1 ? 'primary' : 'secondary'}
                      loading={busy === `${membership.orgSlug}:${facility.id}`}
                      onClick={() => void open(membership, facility.id)}
                    >
                      {membership.facilities.length === 1 ? t('Open') : facility.name}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.memberships.length === 0 && !data.isPlatformAdmin ? <p className="muted">{t('You are not a member of any organization yet.')}</p> : null}
    </AuthLayout>
  );
}
