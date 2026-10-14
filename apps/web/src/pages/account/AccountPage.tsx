import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, messageOf, post } from '../../api/client';
import { homeFor, RequireSession, useMe } from '../../auth/session';
import { Alert, Badge, Button, Field, PageHeader, TextInput } from '../../design/components';
import { useT } from '../../i18n';

export function AccountPage() {
  return (
    <RequireSession>
      <main className="shell-main" style={{ marginInline: 'auto', maxInlineSize: 640 }}>
        <Account />
      </main>
    </RequireSession>
  );
}

function Account() {
  const t = useT();
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (me.data === null || me.data === undefined) return null;

  const change = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await post('/auth/change-password', { currentPassword: current, newPassword: next });
      setMessage({ tone: 'success', text: t('Password changed. Other devices were signed out.') });
      setCurrent('');
      setNext('');
    } catch (caught) {
      if (caught instanceof ApiError) setErrors(caught.fieldErrors());
      setMessage({ tone: 'danger', text: t(messageOf(caught)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="small">
        <Link to={homeFor(me.data)}>← {t('Back')}</Link>
      </p>
      <PageHeader title={t('Account')} subtitle={me.data.person.displayName} />
      <div className="stack">
        <section className="card stack">
          <h2>{t('Change password')}</h2>
          {message !== null ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <form className="stack" onSubmit={(event) => void change(event)} noValidate>
            <Field label={t('Current password')} required>
              {(props) => <TextInput {...props} type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />}
            </Field>
            <Field label={t('New password')} required hint={t('At least 10 characters.')} error={errors.newPassword}>
              {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" loading={busy} disabled={current === '' || next.length < 10}>
              {t('Change password')}
            </Button>
          </form>
        </section>
        <section className="card stack-sm">
          <div className="row">
            <h2 className="spacer">{t('Authenticator app')}</h2>
            <Badge tone={me.data.person.mfaEnabled ? 'success' : 'neutral'}>{me.data.person.mfaEnabled ? t('On') : t('Off')}</Badge>
          </div>
          {me.data.person.mfaEnabled ? (
            <p className="muted">{t('Signing in asks for a code from your authenticator app.')}</p>
          ) : (
            <>
              <p className="muted">{t('Add a second step to signing in with a free authenticator app on your phone.')}</p>
              <Link className="btn btn-secondary" to="/account/mfa" style={{ alignSelf: 'flex-start' }}>
                {t('Turn on authenticator')}
              </Link>
            </>
          )}
        </section>
      </div>
    </>
  );
}
