import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, messageOf, post } from '../../api/client';
import { Alert, Button, Field, Spinner, TextInput } from '../../design/components';
import { useT } from '../../i18n';
import { AuthLayout } from './AuthLayout';

/** Sets a new password from a one-time link. The token stays in the URL fragment. */
export function ResetPage() {
  const t = useT();
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookup = useQuery({
    queryKey: ['reset', token],
    queryFn: () => post<{ displayName: string; expiresAt: string }>('/password-resets/lookup', { token }),
    enabled: token !== '' && !done,
    retry: false,
  });

  if (done) {
    return (
      <AuthLayout title={t('Password changed')}>
        <Alert tone="success">{t('You can now sign in with your new password.')}</Alert>
        <Link className="btn btn-primary" to="/login">
          {t('Sign in')}
        </Link>
      </AuthLayout>
    );
  }
  if (token === '' || lookup.isError) {
    return (
      <AuthLayout title={t('Link not valid')}>
        <Alert tone="warning">
          {lookup.error instanceof ApiError ? t(lookup.error.message) : t('This reset link has expired or was already used. Ask an administrator for a new one.')}
        </Alert>
        <Link to="/login">{t('Go to sign in')}</Link>
      </AuthLayout>
    );
  }
  if (lookup.isPending) return <Spinner />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/password-resets/complete', { token, newPassword: password });
      history.replaceState(null, '', window.location.pathname);
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('Choose a new password')} subtitle={lookup.data.displayName}>
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('New password')} required hint={t('At least 10 characters.')}>
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <Field label={t('Confirm password')} required>
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" block loading={busy} disabled={password.length < 10}>
          {t('Save new password')}
        </Button>
      </form>
    </AuthLayout>
  );
}
