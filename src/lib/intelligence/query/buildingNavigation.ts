import { z } from 'zod';

export const buildingSelectionSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  intent: z.enum(['profile', 'rent_trend', 'peers', 'compare']),
});
export type BuildingSelection = z.infer<typeof buildingSelectionSchema>;
export const buildingIntentQuestions: Record<BuildingSelection['intent'], string> = {
  profile: '介绍选中的楼宇', rent_trend: '查看选中楼宇最近四个季度的净有效租金趋势',
  peers: '查看同子市场的其他楼宇', compare: '比较选中楼宇最新有数据季度的净有效租金和空置面积',
};
export function readMapQueryContext(params: Pick<URLSearchParams, 'get' | 'getAll'>): { selection: BuildingSelection; question: string } | null {
  const parsed = buildingSelectionSchema.safeParse({ ids: params.getAll('aiBuilding'), intent: params.get('aiIntent') ?? 'profile' });
  return parsed.success ? { selection: parsed.data, question: buildingIntentQuestions[parsed.data.intent] } : null;
}
export function buildingAnalysisHref(ids: string[], intent: BuildingSelection['intent'] = 'profile'): string {
  const selected = buildingSelectionSchema.parse({ ids: [...new Set(ids)], intent });
  const params = new URLSearchParams({ aiIntent: selected.intent });
  selected.ids.forEach(id => params.append('aiBuilding', id));
  return `/?${params}#colliers-ai`;
}
export function queryMapHref(requestId: string, buildingId?: string, details = false): string {
  const params = new URLSearchParams({ aiRequest: z.uuid().parse(requestId) });
  if (buildingId) params.set('aiBuilding', z.uuid().parse(buildingId));
  if (details) params.set('aiDetails', '1');
  return `/map?${params}`;
}
export function queryReturnHref(requestId: string): string {
  return `/?${new URLSearchParams({ aiRequest: z.uuid().parse(requestId) })}#colliers-ai`;
}
export type QueryMapContext = { requestId: string; buildingId?: string; details: boolean };
export function parseQueryMapContext(params: Pick<URLSearchParams, 'get'>): QueryMapContext | null {
  const request = z.uuid().safeParse(params.get('aiRequest'));
  const building = params.get('aiBuilding');
  if (!request.success || building !== null && !z.uuid().safeParse(building).success) return null;
  return { requestId: request.data, ...(building ? { buildingId: building } : {}), details: params.get('aiDetails') === '1' };
}
