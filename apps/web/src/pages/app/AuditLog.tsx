import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { get, messageOf } from '../../api/client';
import { Button, EmptyState, ErrorState, Field, PageHeader, Select, Spinner, TextInput } from '../../design/components';
import { useT } from '../../i18n';

interface Entry {
  id: string;
  at: string;
  actorId: string | null;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  organizationId?: string | null;
  details: Record<string, unknown>;
}

/** Readable names for audit actions; unknown actions show their code. */
const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.account_locked': 'Account locked',
  'auth.mfa_enrolled': 'Set up authenticator',
  'auth.mfa_verified': 'Authenticator check passed',
  'auth.mfa_failed': 'Authenticator check failed',
  'auth.recovery_code_used': 'Used a recovery code',
  'auth.password_changed': 'Changed password',
  'invitation.accepted': 'Accepted invitation',
  'organization.created': 'Created organization',
  'organization.admin_invited': 'Invited administrator',
  'organization.settings_updated': 'Changed organization settings',
  'organization.activated': 'Activated organization',
  'organization.suspended': 'Suspended organization',
  'organization.reactivated': 'Reactivated organization',
  'organization.deactivated': 'Deactivated organization',
  'organization.modules_changed': 'Changed modules',
  'organization.admin_password_reset': 'Reset administrator password',
  'facility.created': 'Added branch',
  'facility.updated': 'Changed branch',
  'facility.deactivated': 'Closed branch',
  'staff.invited': 'Invited staff',
  'staff.invitation_revoked': 'Revoked invitation',
  'staff.invitation_reissued': 'Issued new invitation link',
  'staff.access_changed': 'Changed staff access',
  'staff.deactivated': 'Deactivated staff',
  'staff.reactivated': 'Reactivated staff',
  'staff.password_reset_issued': 'Issued password reset',
  'password.reset_completed': 'Set a new password',
  'platform.admin_granted': 'Granted Super Admin',
  'platform.mfa_reset': 'Reset authenticator',
};

const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'auth.', label: 'Sign-in and security' },
  { value: 'staff.', label: 'Staff' },
  { value: 'facility.', label: 'Branches' },
  { value: 'organization.', label: 'Organization' },
];

export function AuditLog({ endpoint, queryKey, showOrganization }: { endpoint: string; queryKey: string; showOrganization?: boolean }) {
  const t = useT();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const params = new URLSearchParams();
  if (from !== '') params.set('from', from);
  if (to !== '') params.set('to', to);
  if (action !== '') params.set('action', action);

  const log = useInfiniteQuery({
    queryKey: ['audit', queryKey, from, to, action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams(params);
      if (pageParam !== null) query.set('cursor', pageParam);
      return get<{ entries: Entry[]; nextCursor: string | null }>(`${endpoint}?${query.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label={t('From')}>{(props) => <TextInput {...props} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />}</Field>
        <Field label={t('To')}>{(props) => <TextInput {...props} type="date" value={to} onChange={(event) => setTo(event.target.value)} />}</Field>
        <Field label={t('Action')}>
          {(props) => (
            <Select {...props} value={action} onChange={(event) => setAction(event.target.value)} options={ACTION_FILTERS.map((option) => ({ value: option.value, label: t(option.label) }))} />
          )}
        </Field>
      </div>
      {log.isPending ? (
        <Spinner />
      ) : log.isError ? (
        <ErrorState message={messageOf(log.error)} onRetry={() => void log.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState title={t('No activity found')} message={t('Try a wider date range.')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('When')}</th>
                  <th>{t('Who')}</th>
                  <th>{t('What')}</th>
                  <th>{t('Item')}</th>
                  {showOrganization === true ? <th>{t('Organization')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={t('When')} className="small num">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td data-label={t('Who')}>{entry.actor}</td>
                    <td data-label={t('What')}>
                      {t(ACTION_LABEL[entry.action] ?? entry.action)}
                      {typeof entry.details.reason === 'string' ? <div className="small muted">{entry.details.reason}</div> : null}
                    </td>
                    <td data-label={t('Item')} className="small muted">
                      {entry.targetType ?? '—'}
                    </td>
                    {showOrganization === true ? (
                      <td data-label={t('Organization')} className="small muted">
                        {entry.organizationId?.slice(0, 8) ?? '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.hasNextPage ? (
            <Button onClick={() => void log.fetchNextPage()} loading={log.isFetchingNextPage}>
              {t('Show older')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function OrgAuditPage() {
  const t = useT();
  const { slug = '' } = useParams();
  return (
    <>
      <PageHeader title={t('Audit log')} subtitle={t('Who did what in this organization.')} />
      <AuditLog endpoint={`/orgs/${slug}/audit`} queryKey={`org-${slug}`} />
    </>
  );
}

export function PlatformAuditPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('Platform audit')} subtitle={t('Platform and security events.')} />
      <AuditLog endpoint="/platform/audit" queryKey="platform" showOrganization />
    </>
  );
}
