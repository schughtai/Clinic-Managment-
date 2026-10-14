import { Outlet } from 'react-router';
import { RequirePlatform, RequireSession } from '../auth/session';
import { useT } from '../i18n';
import { ShellFrame } from './ShellFrame';

/** The Super Admin console: SaaS operations only, never daily clinic work. */
export function PlatformShell() {
  const t = useT();
  return (
    <RequireSession>
      <RequirePlatform>
        <ShellFrame
          title={t('Platform administration')}
          sections={[
            {
              items: [
                { to: '/platform', label: t('Organizations'), icon: 'building', end: true },
                { to: '/platform/audit', label: t('Platform audit'), icon: 'list' },
              ],
            },
          ]}
        >
          <Outlet />
        </ShellFrame>
      </RequirePlatform>
    </RequireSession>
  );
}
