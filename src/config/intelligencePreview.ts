import { parseUserRole } from '@/src/types/auth';

/** Current user policy: AI is admin-only. Public flags cannot expand eligibility.
 * Independent server-side feature/data/audit/export grants still apply. */
export function isIntelligencePreviewEnabled(role: string | null | undefined): boolean {
  return parseUserRole(role) === 'admin';
}
