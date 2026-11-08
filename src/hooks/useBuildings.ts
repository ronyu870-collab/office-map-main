import useSWR from 'swr';
import { getBuildings } from '@/src/services/apiClient';
import type { BuildingRow } from '@/src/services/apiClient';

interface UseBuildingsOptions {
  ownerUser?: string;
  requirePosition?: boolean;
  revalidateOnMount?: boolean;
  /** null pauses fetching until task ownership has been resolved. */
  buildingIds?: readonly string[] | null;
  /** Separate assigned-building snapshots across account/preview contexts. */
  cacheScope?: string;
}

interface UseBuildingsReturn {
  buildings: BuildingRow[] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

/** Shared SWR building lookup; assigned-ID mode never fetches all stock. */
export function useBuildings(options?: UseBuildingsOptions): UseBuildingsReturn {
  const requirePosition = options?.requirePosition ?? false;
  const requestedIds = options?.buildingIds;
  const scopedIds = Array.isArray(requestedIds)
    ? [...new Set(requestedIds)].sort()
    : undefined;

  const cacheKey = requestedIds === null
    ? null
    : scopedIds
      ? ['buildings', 'assigned', options?.cacheScope ?? '', scopedIds, requirePosition]
      : options?.ownerUser
        ? ['buildings', options.ownerUser, requirePosition]
        : ['buildings', 'all', requirePosition];

  const { data, error, isLoading, mutate } = useSWR(
    cacheKey,
    () => getBuildings({
      ownerUser: options?.ownerUser,
      requirePosition: options?.requirePosition,
      ...(scopedIds ? { buildingIds: scopedIds } : {}),
    }),
    {
      revalidateOnMount: options?.revalidateOnMount ?? false,
      dedupingInterval: 10000,
      revalidateOnFocus: false,
    },
  );
  return { buildings: data, isLoading, error, mutate };
}
