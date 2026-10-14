/** Shapes returned by the API (see specs/001-platform-tenant-foundation/contracts/api.md). */

export type OrgStatus = 'provisioning' | 'setup_required' | 'active' | 'suspended' | 'deactivated';

export interface FacilityRef {
  id: string;
  name: string;
}

export interface MembershipSummary {
  orgSlug: string;
  orgName: string;
  orgStatus: OrgStatus;
  roles: string[];
  facilityScope: 'all' | 'selected';
  facilities: FacilityRef[];
}

export interface Me {
  person: { id: string; displayName: string; language: 'en' | 'ur'; mfaEnabled: boolean };
  isPlatformAdmin: boolean;
  authLevel: 'password' | 'mfa';
  memberships: MembershipSummary[];
  context: { orgSlug: string | null; facilityId: string | null };
  /** Permissions in the active organization context. */
  permissions: string[];
  modules: string[];
  org: { slug: string; name: string; status: OrgStatus; defaultLanguage: 'en' | 'ur' } | null;
}

export type LoginNext = 'mfa_enroll' | 'mfa' | 'choose_context' | 'ready';

export interface LoginResult {
  next: LoginNext;
  destination?: string;
}

export interface ShareLink {
  link: string;
  whatsappUrl: string;
  expiresAt: string;
}
