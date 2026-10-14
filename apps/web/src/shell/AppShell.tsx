import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useParams } from 'react-router';
import { ApiError, ORG_SUSPENDED_EVENT, post } from '../api/client';
import type { Me } from '../api/types';
import { ME_KEY, RequireSession, useMe } from '../auth/session';
import { Alert, EmptyState, ErrorState, Select, Spinner } from '../design/components';
import { useLocale, useT } from '../i18n';
import { workspaceSections } from './navigation';
import { ShellFrame } from './ShellFrame';

/** Organization workspace at /app/:slug/*. Makes sure the session's context matches the address. */
export function AppShell() {
  return (
    <RequireSession>
      <Workspace />
    </RequireSession>
  );
}

function Workspace() {
  const t = useT();
  const { slug = '' } = useParams();
  const me = useMe();
  const client = useQueryClient();
  const { adoptDefault } = useLocale();
  const [contextError, setContextError] = useState<ApiError | null>(null);
  const [suspended, setSuspended] = useState(false);
  const switching = useRef<string | null>(null);

  const data = me.data ?? null;
  const membership = data?.memberships.find((m) => m.orgSlug === slug);
  const inContext = data?.org?.slug === slug;

  // Opening /app/<slug> switches the session to that organization when the person belongs to it.
  useEffect(() => {
    if (data === null || inContext || membership === undefined || switching.current === slug) return;
    switching.current = slug;
    const facilityId = membership.facilities.length === 1 ? membership.facilities[0]!.id : (membership.facilities[0]?.id ?? null);
    post<Me>('/auth/context', { orgSlug: slug, facilityId })
      .then((next) => client.setQueryData(ME_KEY, next))
      .catch((error: unknown) => setContextError(error instanceof ApiError ? error : new ApiError(0, 'error', 'Could not open this organization.')))
      .finally(() => {
        switching.current = null;
      });
  }, [client, data, inContext, membership, slug]);

  useEffect(() => {
    if (data?.org !== null && data?.org !== undefined) adoptDefault(data.org.defaultLanguage);
  }, [adoptDefault, data?.org]);

  useEffect(() => {
    const onSuspended = () => setSuspended(true);
    window.addEventListener(ORG_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(ORG_SUSPENDED_EVENT, onSuspended);
  }, []);

  if (data === null) return <Spinner />;
  if (membership === undefined) {
    return (
      <ShellFrame title={t('Clinic Management')} sections={[]}>
        <EmptyState title={t('Not found')} message={t('This organization does not exist or you do not have access to it.')} />
      </ShellFrame>
    );
  }
  if (membership.orgStatus === 'suspended' || membership.orgStatus === 'deactivated' || suspended) {
    return (
      <ShellFrame title={membership.orgName} sections={[]}>
        <Alert tone="danger" title={t('Organization suspended')}>
          {t('This organization is suspended. Contact the platform administrator. Your data is kept.')}
        </Alert>
      </ShellFrame>
    );
  }
  if (contextError !== null && contextError.code === 'context_required') {
    return (
      <ShellFrame title={membership.orgName} sections={[]}>
        <EmptyState title={t('No facility access')} message={t('You are not assigned to any branch yet. Ask your administrator to give you access.')} />
      </ShellFrame>
    );
  }
  if (contextError !== null) return <ErrorState message={t(contextError.message)} />;
  if (!inContext) return <Spinner />;

  return (
    <ShellFrame
      title={membership.orgName}
      sections={workspaceSections(slug, data.permissions, t)}
      topbar={<FacilitySelector me={data} />}
      banner={
        data.org?.status === 'setup_required' ? (
          <div style={{ marginBlockEnd: 'var(--s-4)' }}>
            <Alert tone="warning">{t('Setup is not finished. Some features stay unavailable until the organization is active.')}</Alert>
          </div>
        ) : null
      }
    >
      <Outlet />
    </ShellFrame>
  );
}

function FacilitySelector({ me }: { me: Me }) {
  const t = useT();
  const client = useQueryClient();
  const membership = me.memberships.find((m) => m.orgSlug === me.org?.slug);
  const [busy, setBusy] = useState(false);
  if (membership === undefined || membership.facilities.length < 2) {
    const only = membership?.facilities[0];
    return only !== undefined ? <span className="small muted">{only.name}</span> : null;
  }
  const change = async (facilityId: string) => {
    setBusy(true);
    try {
      client.setQueryData(ME_KEY, await post<Me>('/auth/context', { orgSlug: membership.orgSlug, facilityId }));
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Select
      aria-label={t('Branch')}
      value={me.context.facilityId ?? ''}
      disabled={busy}
      style={{ inlineSize: 'auto', minBlockSize: 34 }}
      onChange={(event) => void change(event.target.value)}
      options={membership.facilities.map((facility) => ({ value: facility.id, label: facility.name }))}
    />
  );
}
