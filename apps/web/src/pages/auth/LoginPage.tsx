import { useT } from '../../i18n';

/** Replaced by the full sign-in page in User Story 1. */
export function LoginPage() {
  const t = useT();
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>{t('Sign in')}</h1>
      </div>
    </main>
  );
}
