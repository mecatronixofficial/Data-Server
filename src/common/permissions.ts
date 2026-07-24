export const ROLE_NAMES = ['user', 'admin', 'superadmin'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const PERMISSION_KEYS = [
  'manageUsers',
  'manageFields',
  'viewAllReports',
  'manageReports',
  'canCreateEntries',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// Fixed role -> permission map. There is no admin UI for this on purpose:
// user creates entries only; admin creates entries and views/edits/deletes reports;
// superadmin manages users/fields and reports, but never creates entries.
const ROLE_PERMISSIONS: Record<RoleName, Record<PermissionKey, boolean>> = {
  user: {
    manageUsers: false,
    manageFields: false,
    viewAllReports: false,
    manageReports: false,
    canCreateEntries: true,
  },
  admin: {
    manageUsers: false,
    manageFields: false,
    viewAllReports: true,
    manageReports: true,
    canCreateEntries: true,
  },
  superadmin: {
    manageUsers: true,
    manageFields: true,
    viewAllReports: true,
    manageReports: true,
    canCreateEntries: false,
  },
};

const EMPTY_PERMISSIONS: Record<PermissionKey, boolean> = {
  manageUsers: false,
  manageFields: false,
  viewAllReports: false,
  manageReports: false,
  canCreateEntries: false,
};

export function permissionsForRole(role: string): Record<PermissionKey, boolean> {
  return ROLE_PERMISSIONS[role as RoleName] || EMPTY_PERMISSIONS;
}
