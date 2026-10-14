import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { get, messageOf } from '../../../api/client';
import { Badge, ErrorState, PageHeader, Spinner } from '../../../design/components';
import { useT } from '../../../i18n';
import type { Role } from './StaffPage';

/** Plain-language names for permission codes. */
export const PERMISSION_LABEL: Record<string, string> = {
  'dashboard.read': 'See the dashboard',
  'organization.read': 'See organization details',
  'organization.update': 'Change organization settings and activate',
  'facility.read': 'See branches',
  'facility.manage': 'Add and change branches',
  'staff.read': 'See staff',
  'staff.invite': 'Invite staff',
  'staff.manage': 'Change roles, branch access and deactivate staff',
  'staff.reset_password': 'Reset staff passwords',
  'role.read': 'See roles',
  'audit.read': 'See the audit log',
};

/** Role templates are read-only in this release; custom roles come later. */
export function RolesPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const roles = useQuery({ queryKey: ['roles', slug], queryFn: () => get<Role[]>(`/orgs/${slug}/roles`) });
  if (roles.isPending) return <Spinner />;
  if (roles.isError) return <ErrorState message={messageOf(roles.error)} onRetry={() => void roles.refetch()} />;
  return (
    <>
      <PageHeader title={t('Roles')} subtitle={t('What each role can do. Give people only the roles their job needs.')} />
      <div className="grid-2">
        {roles.data.map((role) => (
          <section key={role.id} className="card stack-sm">
            <div className="row">
              <h2 className="spacer">{t(role.name)}</h2>
              {role.requiresModule !== null ? <Badge tone={role.assignable ? 'info' : 'neutral'}>{t('Clinical module')}</Badge> : null}
            </div>
            {role.permissions.length === 0 ? (
              <p className="muted small">
                {role.requiresModule !== null ? t('Clinical permissions arrive with the clinical module.') : t('No permissions.')}
              </p>
            ) : (
              <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                {role.permissions.map((code) => (
                  <li key={code}>{t(PERMISSION_LABEL[code] ?? code)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
