import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, messageOf, post } from '../../api/client';
import type { LoginResult } from '../../api/types';
import { homeFor, ME_KEY, useMe } from '../../auth/session';
import { Alert, Button, Field, TextInput } from '../../design/components';
import { useT } from '../../i18n';
import { AuthLayout } from './AuthLayout';

/** Where to go after a sign-in step. Only same-site paths are followed. */
export function routeAfter(result: LoginResult, next: string | null): string {
  switch (result.next) {
    case 'mfa_enroll':
      return '/login/mfa/enroll';
    case 'mfa':
      return '/login/mfa';
    case 'choose_context':
      return '/choose';
    case 'ready':
      return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : (result.destination ?? '/');
  }
}

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const me = useMe();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data !== undefined && me.data !== null && me.data.authLevel === 'mfa') return <Navigate to={homeFor(me.data)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await post<LoginResult>('/auth/login', { identifier, password });
      await client.invalidateQueries({ queryKey: ME_KEY });
      void navigate(routeAfter(result, params.get('next')), { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : messageOf(caught));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('Sign in')}>
      {params.get('ended') === '1' ? <Alert tone="info">{t('Your session ended. Please sign in again.')}</Alert> : null}
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('Phone number or email')} required>
          {(props) => (
            <TextInput
              {...props}
              autoComplete="username"
              inputMode="email"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="0300 1234567"
            />
          )}
        </Field>
        <Field label={t('Password')} required>
          {(props) => <TextInput {...props} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" block loading={busy} disabled={identifier.trim() === '' || password === ''}>
          {t('Sign in')}
        </Button>
      </form>
      <p className="small muted">{t('Forgot your password? Ask your clinic administrator for a reset link.')}</p>
    </AuthLayout>
  );
}
