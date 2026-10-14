import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError, get, SESSION_ENDED_EVENT } from '../api/client';
import type { Me } from '../api/types';
import { AccessDenied, ErrorState, Spinner } from '../design/components';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

export const ME_KEY = ['me'] as const;

/** The signed-in person, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await get<Me>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

/** When any request reports the session ended, forget cached data and go to sign-in. */
export function SessionWatcher() {
  const client = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    const onEnded = () => {
      client.clear();
      client.setQueryData(ME_KEY, null);
      void navigate('/login?ended=1', { replace: true });
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [client, navigate]);
  return null;
}

/** Where a signed-in person belongs by default. */
export function homeFor(me: Me): string {
  if (me.authLevel === 'password' && (me.isPlatformAdmin || me.person.mfaEnabled)) {
    return me.person.mfaEnabled ? '/login/mfa' : '/login/mfa/enroll';
  }
  const options = me.memberships.length + (me.isPlatformAdmin ? 1 : 0);
  if (options > 1) return '/choose';
  if (me.isPlatformAdmin) return '/platform';
  const only = me.memberships[0];
  if (only === undefined) return '/choose';
  if (only.facilities.length > 1 && me.context.facilityId === null) return '/choose';
  return `/app/${only.orgSlug}/dashboard`;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Spinner />;
  if (me.isError) return <ErrorState onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  const needsMfa = me.data.authLevel === 'password' && (me.data.isPlatformAdmin || me.data.person.mfaEnabled);
  if (needsMfa) return <Navigate to={me.data.person.mfaEnabled ? '/login/mfa' : '/login/mfa/enroll'} replace />;
  return <>{children}</>;
}

export function RequirePlatform({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data === undefined || me.data === null) return <Spinner />;
  if (!me.data.isPlatformAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Renders children only when the active organization context grants the permission. The server
 * enforces the same rule on every request; this only avoids showing a page that would be refused.
 */
export function RequirePermission({ code, children }: { code: string; children: ReactNode }) {
  const me = useMe();
  const { slug } = useParams();
  if (me.data === undefined || me.data === null) return <Spinner />;
  if (me.data.org?.slug !== slug) return <Spinner />;
  if (!me.data.permissions.includes(code)) return <AccessDenied />;
  return <>{children}</>;
}

export function can(me: Me | null | undefined, code: string): boolean {
  return me?.permissions.includes(code) === true;
}
