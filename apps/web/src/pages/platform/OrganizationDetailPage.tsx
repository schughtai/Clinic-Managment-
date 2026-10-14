import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, get, messageOf, post } from '../../api/client';
import type { ShareLink } from '../../api/types';
import { Alert, Badge, Button, Dialog, ErrorState, Field, PageHeader, Spinner, TextInput } from '../../design/components';
import { OrgStatusBadge } from '../../design/components/OrgStatusBadge';
import { ShareLinkPanel } from '../../design/components/ShareLinkPanel';
import { useT } from '../../i18n';
import { LifecyclePanel } from './LifecyclePanel';

export interface OrganizationDetail {
  id: string;
  slug: string;
  name: string;
  status: string;
  statusReason: string | null;
  facilityCount: number;
  activeStaffCount: number;
  lastActivityAt: string | null;
  modules: string[];
  currency: string;
  defaultLanguage: string;
  timezone: string;
  dateFormat: string;
  facilities: Array<{ id: string; name: string; active: boolean }>;
  admins: Array<{ membershipId: string; name: string; identifier: string; status: string }>;
  pendingInvitations: number;
  setupChecks: Array<{ key: string; ok: boolean; link: string }>;
  history: Array<{ at: string; action: string; actor: string; reason: string | null }>;
}

const CHECK_LABEL: Record<string, string> = {
  profile: 'Organization profile (name, phone, address)',
  facility: 'A branch with address, timezone and opening hours',
  admin: 'An active administrator',
};

export function OrganizationDetailPage() {
  const t = useT();
  const { id = '' } = useParams();
  const [inviting, setInviting] = useState(false);
  const detail = useQuery({ queryKey: ['platform', 'organization', id], queryFn: () => get<OrganizationDetail>(`/platform/organizations/${id}`) });

  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <ErrorState message={messageOf(detail.error)} onRetry={() => void detail.refetch()} />;
  const org = detail.data;
  const operating = org.status === 'setup_required' || org.status === 'active';

  return (
    <>
      <p className="small">
        <Link to="/platform">← {t('Organizations')}</Link>
      </p>
      <PageHeader
        title={org.name}
        subtitle={`/app/${org.slug}`}
        actions={
          <div className="row">
            <OrgStatusBadge status={org.status} />
            {operating ? (
              <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
                {t('Invite administrator')}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="stack">
        {org.status === 'setup_required' ? (
          <section className="card stack-sm" aria-labelledby="checks">
            <h2 id="checks">{t('Setup checklist')}</h2>
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {org.setupChecks.map((check) => (
                <li key={check.key} className="row">
                  <Badge tone={check.ok ? 'success' : 'warning'}>{check.ok ? t('Done') : t('Missing')}</Badge>
                  {t(CHECK_LABEL[check.key] ?? check.key)}
                </li>
              ))}
            </ul>
            <p className="small muted">{t('The organization administrator completes these items after accepting the invitation.')}</p>
          </section>
        ) : null}

        <div className="grid-2">
          <section className="card stack-sm">
            <h2>{t('Administrators')}</h2>
            {org.admins.length === 0 ? (
              <p className="muted">
                {org.pendingInvitations > 0
                  ? t('{count} invitation(s) waiting to be accepted.', { count: org.pendingInvitations })
                  : t('No administrator yet. Invite one to get started.')}
              </p>
            ) : (
              <ul className="stack-sm" style={{ paddingInlineStart: 18, margin: 0 }}>
                {org.admins.map((admin) => (
                  <li key={admin.membershipId}>
                    {admin.name} <span className="muted small">{admin.identifier}</span>
                    {admin.status !== 'active' ? <> · {t('Deactivated')}</> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card stack-sm">
            <h2>{t('Settings')}</h2>
            <dl className="stack-sm small" style={{ margin: 0 }}>
              <div>
                <dt className="muted">{t('Branches')}</dt>
                <dd style={{ margin: 0 }}>{org.facilities.map((f) => f.name).join(', ')}</dd>
              </div>
              <div>
                <dt className="muted">{t('Currency')}</dt>
                <dd style={{ margin: 0 }}>{org.currency}</dd>
              </div>
              <div>
                <dt className="muted">{t('Timezone')}</dt>
                <dd style={{ margin: 0 }}>{org.timezone}</dd>
              </div>
              <div>
                <dt className="muted">{t('Language')}</dt>
                <dd style={{ margin: 0 }}>{org.defaultLanguage === 'ur' ? t('Urdu') : t('English')}</dd>
              </div>
            </dl>
          </section>
        </div>

        <LifecyclePanel org={org} />
      </div>
      {inviting ? <InviteAdminDialog orgId={org.id} onClose={() => setInviting(false)} /> : null}
    </>
  );
}

function InviteAdminDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [share, setShare] = useState<ShareLink | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = contact.includes('@') ? { inviteeName: name, email: contact } : { inviteeName: name, phone: contact };
      setShare(await post<ShareLink>(`/platform/organizations/${orgId}/invitations`, body));
      await client.invalidateQueries({ queryKey: ['platform', 'organization', orgId] });
    } catch (caught) {
      if (caught instanceof ApiError) setErrors(caught.fieldErrors());
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('Invite administrator')}
      onClose={onClose}
      actions={
        share === null ? (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" type="submit" form="invite-admin" loading={busy} disabled={name.trim() === '' || contact.trim() === ''}>
              {t('Create invitation')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {t('Done')}
          </Button>
        )
      }
    >
      {share !== null ? (
        <ShareLinkPanel share={share} kind="invite" />
      ) : (
        <form id="invite-admin" className="stack" onSubmit={(event) => void submit(event)} noValidate>
          {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
          <Field label={t('Name')} required error={errors.inviteeName}>
            {(props) => <TextInput {...props} value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label={t('Phone number or email')} required error={errors.phone ?? errors.email} hint={t('Used to sign in and to send the WhatsApp message.')}>
            {(props) => <TextInput {...props} value={contact} onChange={(event) => setContact(event.target.value)} />}
          </Field>
        </form>
      )}
    </Dialog>
  );
}
