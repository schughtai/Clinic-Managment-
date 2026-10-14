import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { post, put } from '../api/client';
import { ME_KEY, useMe } from '../auth/session';
import { Icon, type IconName } from '../design/components';
import { useLocale, useT } from '../i18n';
import './shell.css';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Sidebar + top bar + content. Only the items passed in are shown; callers filter by permission. */
export function ShellFrame({
  sections,
  title,
  topbar,
  banner,
  children,
}: {
  sections: NavSection[];
  title: string;
  topbar?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const location = useLocation();
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? location.pathname : null);

  return (
    <div className={`shell${open ? ' open' : ''}`}>
      <a className="visually-hidden" href="#main">
        {t('Skip to content')}
      </a>
      <nav className="shell-sidebar" aria-label={t('Main navigation')}>
        <span className="brand">
          <Icon name="shield" size={22} />
          {t('Clinic Management')}
        </span>
        {sections.map((section, index) => (
          <div key={section.title ?? index} className="stack-sm" style={{ gap: 2 }}>
            {section.title !== undefined ? <div className="nav-section">{section.title}</div> : null}
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end ?? false} className="nav-link">
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="shell-backdrop" onClick={() => setOpen(false)} aria-hidden />
      <header className="shell-topbar">
        <button
          type="button"
          className="btn btn-tertiary btn-sm menu-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={t('Menu')}
        >
          <Icon name="menu" />
        </button>
        <span className="org-name">{title}</span>
        <span className="spacer" />
        {topbar}
        <UserMenu />
      </header>
      <main id="main" className="shell-main" tabIndex={-1}>
        {banner}
        {children}
      </main>
    </div>
  );
}

function UserMenu() {
  const t = useT();
  const me = useMe();
  const { locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const signOut = async () => {
    await post('/auth/logout').catch(() => undefined);
    client.clear();
    client.setQueryData(ME_KEY, null);
    void navigate('/login', { replace: true });
  };

  const switchLanguage = () => {
    const next = locale === 'en' ? 'ur' : 'en';
    setLocale(next);
    void put('/auth/language', { language: next }).catch(() => undefined);
  };

  const multiple = (me.data?.memberships.length ?? 0) + (me.data?.isPlatformAdmin === true ? 1 : 0) > 1;

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="user" size={16} />
        <span>{me.data?.person.displayName}</span>
      </button>
      {open ? (
        <div className="user-menu-panel" role="menu">
          <Link role="menuitem" className="nav-link" to="/account">
            <Icon name="settings" />
            {t('Account')}
          </Link>
          {multiple ? (
            <Link role="menuitem" className="nav-link" to="/choose">
              <Icon name="building" />
              {t('Switch organization')}
            </Link>
          ) : null}
          <button role="menuitem" type="button" className="nav-link" onClick={switchLanguage} lang={locale === 'en' ? 'ur' : 'en'}>
            <Icon name="globe" />
            {locale === 'en' ? 'اردو' : 'English'}
          </button>
          <button role="menuitem" type="button" className="nav-link" onClick={() => void signOut()}>
            <Icon name="logout" />
            {t('Sign out')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
