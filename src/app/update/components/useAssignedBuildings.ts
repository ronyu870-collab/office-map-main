'use client';

import useSWR from 'swr';
import { readAssignedBuildings } from '../readAssignedBuildings';

/** null assignment state suppresses reads; empty assignments resolve to []. */
export function useAssignedBuildings(ids: readonly string[] | null, scope: string | null) {
  const normalizedIds = ids === null ? null : [...new Set(ids)].sort();
  const { data, error, isLoading, mutate } = useSWR(
    normalizedIds === null || scope === null ? null : ['quarterly-assigned-buildings', scope, normalizedIds],
    () => readAssignedBuildings(normalizedIds ?? []),
    { revalidateOnMount: true, dedupingInterval: 10000, revalidateOnFocus: false },
  );
  return { buildings: data, error, isLoading, mutate };
}
