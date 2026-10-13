import { computed, reactive } from 'vue';
import { api } from './api';
import { adoptClinicLocale } from './i18n';
import type { Profile, Role } from './types';

interface SessionState {
  profile: Profile | null;
  loaded: boolean;
}

export const session = reactive<SessionState>({ profile: null, loaded: false });

export const role = computed<Role | null>(() => session.profile?.user.role ?? null);

/** Whether the signed-in person has one of the given roles. The server checks again on every request. */
export function can(...roles: Role[]): boolean {
  return session.profile !== null && roles.includes(session.profile.user.role);
}

export async function loadProfile(): Promise<boolean> {
  try {
    session.profile = await api.get<Profile>('/auth/me');
    adoptClinicLocale(session.profile.clinic.locale);
  } catch {
    session.profile = null;
  } finally {
    session.loaded = true;
  }
  return session.profile !== null;
}

export async function signIn(phone: string, password: string): Promise<void> {
  await api.post('/auth/login', { phone, password });
  await loadProfile();
}

export async function signOut(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    session.profile = null;
  }
}
