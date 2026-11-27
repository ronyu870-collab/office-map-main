import { PROTOCOL, slideContentSchema } from '../contracts/content';
import type { PitchContext } from '../data/store';
import type { DynamicParameters } from '../business/protocol';
import type { DesignTheme } from '../design/theme';
import { readPitchLocation } from './derived-assets';
import { readStackingAppendix } from './stacking-delivery';

export async function readVisualGenerationPage(ctx: PitchContext, parameters: DynamicParameters, theme: DesignTheme,
  city: string, language: 'zh' | 'en') {
  if (language !== 'zh') throw new Error('PITCH_LANGUAGE_UNAVAILABLE');
  if (parameters.templateId === 'stacking-plan') {
    const target = parameters.targetBuildingId ?? (parameters.buildingIds.length === 1 ? parameters.buildingIds[0] : undefined);
    if (!target || !parameters.buildingIds.includes(target)) throw new Error('PITCH_INVALID');
    const appendix = await readStackingAppendix(ctx, target, {}, 'internal', theme);
    if (!appendix) throw new Error('PITCH_DATA_UNAVAILABLE');
    return { content: appendix.content, layoutId: appendix.layoutId, variant: 'standard' as const };
  }
  const selected = parameters.buildingIds.length ? { buildingIds: parameters.buildingIds } : { city, submarkets: parameters.submarkets };
  const map = await readPitchLocation(ctx, selected, parameters.targetBuildingId);
  if (!map) throw new Error('PITCH_DATA_UNAVAILABLE');
  const { reference, scene } = map;
  const sourceId = reference.source.id;
  const content = slideContentSchema.parse({ protocol: PROTOCOL, locale: 'zh', title: scene.title,
    subtitle: `目录点位观察日 ${reference.source.dataAsOf} · 无底图`, dataAsOf: reference.source.dataAsOf,
    disclosure: 'internal', isTestData: false, sources: [reference.source], blocks: [
      { kind: 'image', mediaAssetId: reference.id, mediaVersion: reference.version, alt: scene.title, sourceIds: [sourceId] },
      { kind: 'paragraph', text: '区位示意基于获权楼宇目录的点位。图尺为近似值。', sourceIds: [sourceId] },
    ] });
  return { content, layoutId: 'hero-caption' as const, variant: 'standard' as const };
}
