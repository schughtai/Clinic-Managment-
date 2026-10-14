import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, messageOf, post } from '../../api/client';
import { ME_KEY, useMe } from '../../auth/session';
import { Alert, Button, Field, Spinner, TextInput } from '../../design/components';
import { useT } from '../../i18n';
import { AuthLayout } from './AuthLayout';

interface Lookup {
  organizationName: string;
  inviteeName: string;
  roles: string[];
  accountExists: boolean;
  expiresAt: string;
}

/** The token is in the URL fragment, which browsers never send to servers or put in logs. */
function tokenFromHash(): string {
  const fromHash = window.location.hash.replace(/^#/, '');
  if (fromHash !== '') return fromHash;
  // Kept for the round trip through sign-in, when an existing account accepts.
  try {
    return sessionStorage.getItem('clinic.pendingInvite') ?? '';
  } catch {
    return '';
  }
}

export function InvitePage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useMe();
  const [token] = useState(tokenFromHash);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => post<Lookup>('/invitations/lookup', { token }),
    enabled: token !== '',
    retry: false,
  });

  if (token === '' || lookup.isError) {
    return (
      <AuthLayout title={t('Invitation not valid')}>
        <Alert tone="warning">
          {lookup.error instanceof ApiError ? t(lookup.error.message) : t('This invitation link has expired or was already used. Ask for a new one.')}
        </Alert>
        <Link to="/login">{t('Go to sign in')}</Link>
      </AuthLayout>
    );
  }
  if (lookup.isPending) return <Spinner />;

  const invitation = lookup.data;
  const signedIn = me.data !== undefined && me.data !== null;

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (!invitation.accountExists && password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ destination: string }>('/invitations/accept', invitation.accountExists ? { token } : { token, password });
      history.replaceState(null, '', window.location.pathname);
      try {
        sessionStorage.removeItem('clinic.pendingInvite');
      } catch {
        // Storage may be blocked; nothing to clean up then.
      }
      await client.invalidateQueries({ queryKey: ME_KEY });
      void navigate(result.destination, { replace: true });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t('Join {org}', { org: invitation.organizationName })}
      subtitle={t('{name}, you are invited as: {roles}.', { name: invitation.inviteeName, roles: invitation.roles.join(', ') })}
    >
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      {invitation.accountExists && !signedIn ? (
        <>
          <Alert tone="info">{t('You already have an account. Sign in first, then open the invitation link again.')}</Alert>
          <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent('/invite')}`} onClick={() => sessionStorage.setItem('clinic.pendingInvite', token)}>
            {t('Sign in')}
          </Link>
        </>
      ) : (
        <form className="stack" onSubmit={(event) => void accept(event)} noValidate>
          {!invitation.accountExists ? (
            <>
              <Field label={t('Choose a password')} required hint={t('At least 10 characters.')}>
                {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
              </Field>
              <Field label={t('Confirm password')} required>
                {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
              </Field>
            </>
          ) : null}
          <Button type="submit" variant="primary" block loading={busy} disabled={!invitation.accountExists && password.length < 10}>
            {t('Accept invitation')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
