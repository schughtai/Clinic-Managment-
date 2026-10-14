import { useT } from '../../i18n';
import type { OrganizationDetail } from './OrganizationDetailPage';

/** Status history. Suspend, reactivate and module switches are added with User Story 5. */
export function LifecyclePanel({ org }: { org: OrganizationDetail }) {
  const t = useT();
  return (
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
  );
}
