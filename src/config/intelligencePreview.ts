import { parseUserRole } from '@/src/types/auth';

/**
 * Intelligence is being introduced as a controlled product preview.
 *
 * - Admins can always see the preview so it can be reviewed safely before rollout.
 * - Other authenticated roles only see it when the public preview flag is enabled.
 *
 * The flag is intentionally presentation-only. Data authorization still relies on
 * the existing Supabase RLS/API boundaries.
 */
export function isIntelligencePreviewEnabled(role: string | null | undefined): boolean {
  if (parseUserRole(role) === 'admin') return true;
  return process.env.NEXT_PUBLIC_INTELLIGENCE_PREVIEW === 'true';
}
