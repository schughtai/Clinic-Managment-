import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { homeFor, SessionWatcher, useMe } from './auth/session';
import { Spinner } from './design/components';
import { LoginPage } from './pages/auth/LoginPage';

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
      { path: '*', element: <Home /> },
    ],
  },
]);
