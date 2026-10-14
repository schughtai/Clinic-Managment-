/**
 * The permission catalogue. Roles store permission codes as data, but only codes listed here exist,
 * so a typo can never create a permission. Later features add their own codes here.
 */
export const PERMISSIONS = [
  'dashboard.read',
  'organization.read',
  'organization.update',
  'facility.read',
  'facility.manage',
  'staff.read',
  'staff.invite',
  'staff.manage',
  'staff.reset_password',
  'role.read',
  'audit.read',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

const KNOWN = new Set<string>(PERMISSIONS);
export const isPermission = (value: string): value is PermissionCode => KNOWN.has(value);

/** Optional modules a Super Admin can switch on per organization. */
export const KNOWN_MODULES = ['clinical'] as const;
export type ModuleCode = (typeof KNOWN_MODULES)[number];
const KNOWN_MODULE_SET = new Set<string>(KNOWN_MODULES);
export const isModule = (value: string): value is ModuleCode => KNOWN_MODULE_SET.has(value);

export type RoleKey = 'tenant_admin' | 'receptionist' | 'finance' | 'practitioner';

export interface RoleTemplate {
  key: RoleKey;
  name: string;
  permissions: readonly PermissionCode[];
  /** The role can only be assigned while this module is switched on. */
  requiresModule: ModuleCode | null;
}

/** Roles every new organization starts with (v2 §18.2–18.3). */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: 'tenant_admin',
    name: 'Clinic / Hospital Admin',
    permissions: PERMISSIONS,
    requiresModule: null,
  },
  {
    key: 'receptionist',
    name: 'Receptionist',
    permissions: ['dashboard.read', 'organization.read', 'facility.read'],
    requiresModule: null,
  },
  {
    key: 'finance',
    name: 'Finance',
    permissions: ['dashboard.read', 'organization.read', 'facility.read'],
    requiresModule: null,
  },
  {
    key: 'practitioner',
    name: 'Doctor / Practitioner',
    permissions: [],
    requiresModule: 'clinical',
  },
];
