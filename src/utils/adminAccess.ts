import { parseUserRole } from '@/src/types/auth';

export function isAdminRole(role: string | null | undefined): boolean {
  return parseUserRole(role) === 'admin';
}

export function isResearchLibraryManager(role: string | null | undefined): boolean {
  return parseUserRole(role) === 'admin';
}

export function canAccessAdminConsole(params: {
  role: string | null | undefined;
  isDemo?: boolean;
  impersonationActive?: boolean;
}): boolean {
  if (params.impersonationActive) return false;
  // Demo presentation state is never an authorization boundary.
  // Only the canonical admin role may enter the admin console.
  return isAdminRole(params.role);
}
