import type { ReactNode } from 'react';
import { Icon } from '../../design/components';
import { useLocale, useT } from '../../i18n';

/** A centred card used by sign-in, authenticator, invitation and reset pages. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <div className="row">
          <span className="brand spacer">
            <Icon name="shield" size={22} />
            {t('Clinic Management')}
          </span>
          <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setLocale(locale === 'en' ? 'ur' : 'en')} lang={locale === 'en' ? 'ur' : 'en'}>
            <Icon name="globe" size={14} />
            {locale === 'en' ? 'اردو' : 'English'}
          </button>
        </div>
        <section className="card stack">
          <div className="stack-sm">
            <h1>{title}</h1>
            {subtitle !== undefined ? <p className="muted">{subtitle}</p> : null}
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
