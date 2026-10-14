import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { messageOf, post } from '../../api/client';
import type { LoginResult } from '../../api/types';
import { ME_KEY, useMe } from '../../auth/session';
import { Alert, Button, Field, Spinner, TextInput } from '../../design/components';
import { useT } from '../../i18n';
import { AuthLayout } from './AuthLayout';
import { routeAfter } from './LoginPage';

function CodeInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <Field label={label} required hint="6 digits">
      {(props) => (
        <TextInput
          {...props}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          style={{ letterSpacing: '0.3em', fontSize: 'var(--fs-lg)' }}
        />
      )}
    </Field>
  );
}

/** First sign-in of a Super Admin (or a staff member turning it on): scan, confirm, save recovery codes. */
export function MfaEnrollPage({ fromAccount = false }: { fromAccount?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useMe();
  const [setup, setSetup] = useState<{ otpauthUri: string; secretBase32: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ codes: string[]; result: LoginResult } | null>(null);

  const signedIn = me.data !== undefined && me.data !== null;
  const enrolled = me.data?.person.mfaEnabled === true;

  useEffect(() => {
    if (!signedIn || enrolled || setup !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const started = await post<{ otpauthUri: string; secretBase32: string }>('/auth/mfa/enroll/start');
        const qr = await QRCode.toDataURL(started.otpauthUri, { margin: 1, width: 220 });
        if (!cancelled) setSetup({ ...started, qr });
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, enrolled, setup]);

  if (me.isPending) return <Spinner />;
  if (!signedIn) return <Navigate to="/login" replace />;
  if (enrolled && done === null) return <Navigate to="/" replace />;

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post<LoginResult & { recoveryCodes: string[] }>('/auth/mfa/enroll/confirm', { code });
      setDone({ codes: result.recoveryCodes, result });
    } catch (caught) {
      setError(messageOf(caught));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await client.invalidateQueries({ queryKey: ME_KEY });
    void navigate(fromAccount || done === null ? '/' : routeAfter(done.result, null), { replace: true });
  };

  if (done !== null) {
    return (
      <AuthLayout title={t('Save your recovery codes')} subtitle={t('Each code works once if you lose your phone. Keep them somewhere safe and private.')}>
        <ol className="code-box" style={{ columns: 2, paddingInlineStart: 28, margin: 0 }}>
          {done.codes.map((recovery) => (
            <li key={recovery}>{recovery}</li>
          ))}
        </ol>
        <div className="row">
          <Button icon="copy" onClick={() => void navigator.clipboard?.writeText(done.codes.join('\n'))}>
            {t('Copy')}
          </Button>
          <Button onClick={() => window.print()}>{t('Print')}</Button>
          <span className="spacer" />
          <Button variant="primary" onClick={() => void finish()}>
            {t('I have saved them')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('Set up your authenticator app')}
      subtitle={t('Scan the code with an authenticator app such as Google Authenticator or Microsoft Authenticator, then enter the 6-digit code it shows.')}
    >
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      {setup === null ? (
        error === null ? <Spinner /> : null
      ) : (
        <>
          <img src={setup.qr} alt={t('QR code for your authenticator app')} width={220} height={220} style={{ alignSelf: 'center' }} />
          <details>
            <summary className="small">{t('Cannot scan? Enter this key instead')}</summary>
            <p className="code-box">{setup.secretBase32.replace(/(.{4})/g, '$1 ').trim()}</p>
          </details>
          <form className="stack" onSubmit={(event) => void confirm(event)}>
            <CodeInput label={t('Authenticator code')} value={code} onChange={setCode} />
            <Button type="submit" variant="primary" block loading={busy} disabled={code.length !== 6}>
              {t('Continue')}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

export function MfaVerifyPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useMe();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isPending) return <Spinner />;
  if (me.data === null || me.data === undefined) return <Navigate to="/login" replace />;
  if (me.data.authLevel === 'mfa') return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post<LoginResult>('/auth/mfa/verify', useRecovery ? { recoveryCode: recovery } : { code });
      await client.invalidateQueries({ queryKey: ME_KEY });
      void navigate(routeAfter(result, null), { replace: true });
    } catch (caught) {
      setError(messageOf(caught));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('Enter your authenticator code')} subtitle={t('Open your authenticator app and enter the 6-digit code for Clinic Management.')}>
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form className="stack" onSubmit={(event) => void submit(event)}>
        {useRecovery ? (
          <Field label={t('Recovery code')} required>
            {(props) => <TextInput {...props} value={recovery} onChange={(event) => setRecovery(event.target.value)} autoComplete="off" />}
          </Field>
        ) : (
          <CodeInput label={t('Authenticator code')} value={code} onChange={setCode} />
        )}
        <Button type="submit" variant="primary" block loading={busy} disabled={useRecovery ? recovery.trim().length < 8 : code.length !== 6}>
          {t('Continue')}
        </Button>
        <Button variant="tertiary" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? t('Use the authenticator code instead') : t('Use a recovery code')}
        </Button>
      </form>
    </AuthLayout>
  );
}
