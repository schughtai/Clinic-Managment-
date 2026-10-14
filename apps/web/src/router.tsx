import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { homeFor, SessionWatcher, useMe } from './auth/session';
import { Spinner } from './design/components';
import { AccountPage } from './pages/account/AccountPage';
import { DashboardPage } from './pages/app/DashboardPage';
import { ChooseContextPage } from './pages/auth/ChooseContextPage';
import { InvitePage } from './pages/auth/InvitePage';
import { LoginPage } from './pages/auth/LoginPage';
import { MfaEnrollPage, MfaVerifyPage } from './pages/auth/MfaPages';
import { OrganizationDetailPage } from './pages/platform/OrganizationDetailPage';
import { OrganizationsPage } from './pages/platform/OrganizationsPage';
import { AppShell } from './shell/AppShell';
import { PlatformShell } from './shell/PlatformShell';
import { RequirePermission } from './auth/session';

function Root() {
  return (
    <>
      <SessionWatcher />
      <Outlet />
    </>
  );
}

/** Sends a signed-in person to where they belong, everyone else to sign-in. */
function Home() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.data === null || me.data === undefined) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(me.data)} replace />;
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { index: true, element: <Home /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'login/mfa', element: <MfaVerifyPage /> },
      { path: 'login/mfa/enroll', element: <MfaEnrollPage /> },
      { path: 'invite', element: <InvitePage /> },
      { path: 'choose', element: <ChooseContextPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'account/mfa', element: <MfaEnrollPage fromAccount /> },
      {
        path: 'app/:slug',
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          {
            path: 'dashboard',
            element: (
              <RequirePermission code="dashboard.read">
                <DashboardPage />
              </RequirePermission>
            ),
          },
        ],
      },
      {
        path: 'platform',
        element: <PlatformShell />,
        children: [
          { index: true, element: <OrganizationsPage /> },
          { path: 'organizations', element: <Navigate to="/platform" replace /> },
          { path: 'organizations/:id', element: <OrganizationDetailPage /> },
        ],
      },
      { path: '*', element: <Home /> },
    ],
  },
]);
