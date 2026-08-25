export const RESTRICTED_ADMIN_EMAILS = new Set(['judy.li@colliers.com']);

export function isAdminRole(role: string | null | undefined): boolean {
  return role?.trim().toLowerCase() === 'admin';
}

export function isResearchLibraryManager(role: string | null | undefined): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin';
}

export function canAccessAdminConsole(params: {
  role: string | null | undefined;
  email?: string | null;
  isDemo?: boolean;
}): boolean {
  const email = params.email?.trim().toLowerCase() ?? '';
  if (email && RESTRICTED_ADMIN_EMAILS.has(email)) return false;
  return Boolean(params.isDemo) || isAdminRole(params.role);
}
