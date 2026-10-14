import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '../api/types';
import { ME_KEY, RequirePermission } from '../auth/session';
import { LocaleProvider, translate } from '../i18n';
import { workspaceSections } from './navigation';

const t = (text: string) => translate('en', text);
const ADMIN = [
  'audit.read',
  'dashboard.read',
  'facility.manage',
  'facility.read',
  'organization.read',
  'organization.update',
  'role.read',
  'staff.invite',
  'staff.manage',
  'staff.read',
  'staff.reset_password',
];
const RECEPTION = ['dashboard.read', 'facility.read', 'organization.read'];

const labels = (permissions: string[]) =>
  workspaceSections('shifa', permissions, t)
    .flatMap((section) => section.items)
    .map((item) => item.label);

describe('workspace navigation', () => {
  it('shows a receptionist only the dashboard', () => {
    expect(labels(RECEPTION)).toEqual(['Dashboard']);
  });

  it('shows an administrator the administration pages', () => {
    expect(labels(ADMIN)).toEqual(['Dashboard', 'Organization', 'Branches', 'Staff', 'Roles', 'Audit log']);
  });

  it('shows nothing without permissions', () => {
    expect(workspaceSections('shifa', [], t)).toEqual([]);
  });
});

function me(permissions: string[]): Me {
  return {
    person: { id: 'p', displayName: 'Bilal', language: 'en', mfaEnabled: false },
    isPlatformAdmin: false,
    authLevel: 'password',
    memberships: [],
    context: { orgSlug: 'shifa', facilityId: null },
    permissions,
    modules: [],
    org: { slug: 'shifa', name: 'Shifa', status: 'active', defaultLanguage: 'en' },
  };
}

describe('RequirePermission', () => {
  it('shows access denied without rendering (or fetching for) the page', () => {
    const client = new QueryClient();
    client.setQueryData(ME_KEY, me(RECEPTION));
    const page = vi.fn(() => <p>Staff list</p>);
    const Page = page;
    const router = createMemoryRouter(
      [
        {
          path: '/app/:slug/settings/staff',
          element: (
            <RequirePermission code="staff.read">
              <Page />
            </RequirePermission>
          ),
        },
      ],
      { initialEntries: ['/app/shifa/settings/staff'] },
    );
    render(
      <LocaleProvider>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LocaleProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(page).not.toHaveBeenCalled();
  });
});
