// Photos extracted from two published project introductions in the private pilot.
export type PilotPhoto = { file: 'cover.webp' | 'interior.webp'; caption: string };

const pilot = {
  '59f20a3a-4fc8-40d2-8270-f6a5c9784bee': {
    materialId: 'dbcfb0f1-dc6f-45e1-af2b-0c054146986f',
    photos: [{ file: 'cover.webp', caption: '外观效果图' }],
  },
  'b99a801e-5dfd-4849-8aef-c55de594a48f': {
    materialId: '55c9ff8b-9596-459a-aa00-6e8cc034a630',
    photos: [
      { file: 'cover.webp', caption: '施工阶段外观照' },
      { file: 'interior.webp', caption: '施工阶段室内照' },
    ],
  },
} as const satisfies Record<string, { materialId: string; photos: readonly PilotPhoto[] }>;

export function getBuildingMediaPilot(buildingId: string) {
  if (process.env.NEXT_PUBLIC_MAP_BUILDING_MEDIA_PILOT !== '1' || !Object.hasOwn(pilot, buildingId)) return null;
  return pilot[buildingId as keyof typeof pilot];
}

export function pilotMediaPath(buildingId: string, materialId: string, file: PilotPhoto['file']) {
  return `pilot-media/v1/${buildingId}/${materialId}/${file}`;
}
