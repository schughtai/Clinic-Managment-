import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { messageOf, post, put } from '../../api/client';
import type { ShareLink } from '../../api/types';
import { Alert, Button, Checkbox, ConfirmDialog, Dialog } from '../../design/components';
import { ShareLinkPanel } from '../../design/components/ShareLinkPanel';
import { VoiceTextField } from '../../design/components/VoiceTextField';
import { useT } from '../../i18n';
import type { OrganizationDetail } from './OrganizationDetailPage';

type Action = 'suspend' | 'reactivate' | 'deactivate' | 'activate';

const ACTION_COPY: Record<Action, { title: string; message: string; needsReason: boolean; destructive: boolean }> = {
  suspend: {
    title: 'Suspend organization',
    message: 'Staff are signed out at once and cannot use the organization. No data is deleted.',
    needsReason: true,
    destructive: true,
  },
  reactivate: { title: 'Reactivate organization', message: 'Staff can sign in again. The organization returns to its previous status.', needsReason: false, destructive: false },
  deactivate: {
    title: 'Deactivate organization',
    message: 'The organization stays closed permanently. Data is kept according to the retention policy.',
    needsReason: true,
    destructive: true,
  },
  activate: { title: 'Activate organization', message: 'Use this only when the clinic asked you to finish setup for them.', needsReason: false, destructive: false },
};

/** Lifecycle actions, module switches, admin resets and history (US5). Every action is audited. */
export function LifecyclePanel({ org }: { org: OrganizationDetail }) {
  const t = useT();
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareLink | null>(null);
  const [resetting, setResetting] = useState<{ membershipId: string; name: string } | null>(null);

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['platform', 'organization', org.id] }), client.invalidateQueries({ queryKey: ['platform', 'organizations'] })]);

  const runStatus = async () => {
    if (action === null) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/platform/organizations/${org.id}/status`, { action, ...(reason.trim() !== '' ? { reason } : {}) });
      await refresh();
      setAction(null);
      setReason('');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleClinical = async (on: boolean) => {
    setError(null);
    try {
      await put(`/platform/organizations/${org.id}/modules`, { modules: on ? ['clinical'] : [] });
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const resetAdmin = async () => {
    if (resetting === null) return;
    setBusy(true);
    try {
      setShare(await post<ShareLink>(`/platform/organizations/${org.id}/admins/${resetting.membershipId}/reset-password`));
      setResetting(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const available: Action[] =
    org.status === 'active'
      ? ['suspend']
      : org.status === 'setup_required'
        ? ['activate', 'suspend']
        : org.status === 'suspended'
          ? ['reactivate', 'deactivate']
          : [];

  return (
    <>
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <div className="grid-2">
        <section className="card stack-sm">
          <h2>{t('Status')}</h2>
          {org.statusReason !== null && (org.status === 'suspended' || org.status === 'deactivated') ? (
            <p className="small">
              {t('Reason')}: {org.statusReason}
            </p>
          ) : null}
          <div className="row">
            {available.map((item) => (
              <Button key={item} variant={ACTION_COPY[item].destructive ? 'destructive' : 'secondary'} onClick={() => setAction(item)}>
                {t(ACTION_COPY[item].title)}
              </Button>
            ))}
            {available.length === 0 ? <span className="muted small">{t('No actions available.')}</span> : null}
          </div>
        </section>
        <section className="card stack-sm">
          <h2>{t('Modules')}</h2>
          <Checkbox
            label={t('Clinical module (encounters, prescriptions)')}
            checked={org.modules.includes('clinical')}
            onChange={(event) => void toggleClinical(event.target.checked)}
          />
          <p className="small muted">{t('Off by default. Even when on, only members with the Practitioner role can use clinical features.')}</p>
        </section>
      </div>

      {org.admins.some((admin) => admin.status === 'active') ? (
        <section className="card stack-sm">
          <h2>{t('Administrator access')}</h2>
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {org.admins
              .filter((admin) => admin.status === 'active')
              .map((admin) => (
                <li key={admin.membershipId} className="row">
                  <span className="spacer">
                    {admin.name} <span className="small muted">{admin.identifier}</span>
                  </span>
                  <Button size="sm" onClick={() => setResetting({ membershipId: admin.membershipId, name: admin.name })}>
                    {t('Reset password')}
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack-sm">
        <h2>{t('History')}</h2>
        {org.history.length === 0 ? (
          <p className="muted">{t('No changes yet.')}</p>
        ) : (
          <ul className="stack-sm small" style={{ paddingInlineStart: 18, margin: 0 }}>
            {org.history.map((entry) => (
              <li key={`${entry.at}-${entry.action}`}>
                {new Date(entry.at).toLocaleString()} · {entry.action} · {entry.actor}
                {entry.reason !== null ? ` · ${entry.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {action !== null ? (
        <ConfirmDialog
          title={t(ACTION_COPY[action].title)}
          message={t(ACTION_COPY[action].message)}
          confirmLabel={t(ACTION_COPY[action].title)}
          destructive={ACTION_COPY[action].destructive}
          loading={busy}
          onClose={() => setAction(null)}
          onConfirm={() => void runStatus()}
        >
          {ACTION_COPY[action].needsReason ? (
            <VoiceTextField label={t('Reason')} value={reason} onChange={setReason} required maxLength={500} />
          ) : null}
        </ConfirmDialog>
      ) : null}
      {resetting !== null ? (
        <ConfirmDialog
          title={t('Reset password for {name}?', { name: resetting.name })}
          message={t('They are signed out everywhere. You get a one-time link, valid for 24 hours, to send them.')}
          confirmLabel={t('Create reset link')}
          loading={busy}
          onClose={() => setResetting(null)}
          onConfirm={() => void resetAdmin()}
        />
      ) : null}
      {share !== null ? (
        <Dialog
          title={t('Password reset link')}
          onClose={() => setShare(null)}
          actions={
            <Button variant="primary" onClick={() => setShare(null)}>
              {t('Done')}
            </Button>
          }
        >
          <ShareLinkPanel share={share} kind="reset" />
        </Dialog>
      ) : null}
    </>
  );
}
