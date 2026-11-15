import { isAdminRole } from '@/src/utils/adminAccess';

export function canReadQuarterlyResearch(role: string | null | undefined, impersonating = false) {
  return isAdminRole(role) && !impersonating;
}

export const researchEditions = ['2026Q3', '2026Q2'] as const;
export type ResearchEdition = typeof researchEditions[number];
export function isResearchEdition(value: unknown): value is ResearchEdition {
  return researchEditions.some(edition => edition === value);
}
