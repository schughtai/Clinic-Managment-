import type { Translate } from '../i18n';
import type { NavSection } from './ShellFrame';

/**
 * The organization workspace menu, built only from the permissions the server reported. Modules
 * that do not exist yet (appointments, billing) are added by later features.
 */
export function workspaceSections(slug: string, permissions: readonly string[], t: Translate): NavSection[] {
  const has = (code: string) => permissions.includes(code);
  const base = `/app/${slug}`;
  const main: NavSection = { items: [] };
  if (has('dashboard.read')) main.items.push({ to: `${base}/dashboard`, label: t('Dashboard'), icon: 'dashboard' });
  if (has('patients.read')) main.items.push({ to: `${base}/patients`, label: t('Patients'), icon: 'user' });

  const admin: NavSection = { title: t('Administration'), items: [] };
  if (has('organization.update')) admin.items.push({ to: `${base}/settings`, label: t('Organization'), icon: 'settings', end: true });
  if (has('facility.manage')) admin.items.push({ to: `${base}/settings/facilities`, label: t('Branches'), icon: 'building' });
  if (has('staff.read')) admin.items.push({ to: `${base}/settings/staff`, label: t('Staff'), icon: 'users' });
  if (has('role.read')) admin.items.push({ to: `${base}/settings/roles`, label: t('Roles'), icon: 'shield' });
  if (has('audit.read')) admin.items.push({ to: `${base}/audit`, label: t('Audit log'), icon: 'list' });

  return [main, admin].filter((section) => section.items.length > 0);
}
