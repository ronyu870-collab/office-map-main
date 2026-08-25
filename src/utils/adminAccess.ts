export function isAdminRole(role: string | null | undefined): boolean {
  return role?.trim().toLowerCase() === 'admin';
}

export function isResearchLibraryManager(role: string | null | undefined): boolean {
  const normalized = role?.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin';
}

export function canAccessAdminConsole(params: {
  role: string | null | undefined;
  impersonationActive?: boolean;
}): boolean {
  return !params.impersonationActive && isAdminRole(params.role);
}
