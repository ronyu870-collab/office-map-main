import type { BuildingMetric } from '@/src/types';
import type { GalleryPhoto } from '@/src/services/map/buildingPhotoGallery';
import type { FullListBuilding } from '../model/fullBuildingList';
export type WorkspaceBuilding = FullListBuilding & {
  building_id?: string | null; leed_certification?: string | null;
  contact_phone?: string | null; notes?: string | null; photos?: unknown;
};
export type WorkspaceBuildingDetail = {
  building: WorkspaceBuilding; metric: BuildingMetric | null;
  photos: GalleryPhoto[]; isDemo: boolean; canEdit: boolean;
  overrides: Record<string, { display_label: string; display_value: string }>;
};
