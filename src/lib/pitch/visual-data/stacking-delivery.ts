import { withCriticalAudit } from '@/src/lib/serverAudit';
import { PROTOCOL, slideContentSchema } from '../contracts/content';
import type { PitchContext } from '../data/store';
import type { DesignTheme } from '../design/theme';
import type { ProposalAudience } from '../integration-contracts';
import { layoutSlides } from '../layout/engine';
import type { ExportFormat } from '../render/format';
import { readPitchStackingPlan } from './derived-assets';
import { pinnedVisualInput } from './reference';
import { resolveReferencedVisualMedia } from './resolve';
import type { StackingSelection } from './stacking';

/** A dedicated administrator appendix stays outside general-purpose proposal and AI composition. */
export async function readStackingAppendix(ctx: PitchContext, buildingId: string,
  selection: StackingSelection, audience: ProposalAudience, theme: DesignTheme) {
  if (audience !== 'internal') throw new Error('QUERY_DENIED');
  const visual = await readPitchStackingPlan(ctx, buildingId, selection);
  if (!visual) return null;
  const { reference, document } = visual;
  const title = `${document.building.name}历史楼层分布`;
  const dataAsOf = document.businessDate ?? reference.source.dataAsOf;
  const content = slideContentSchema.parse({
    protocol: PROTOCOL, locale: 'zh', title,
    subtitle: document.businessDate ? `历史来源数据截至 ${document.businessDate}` : `目录观察日 ${dataAsOf} · 资料日期见各来源`,
    disclosure: 'restricted', isTestData: false, dataAsOf, sources: [reference.source],
    blocks: [
      { kind: 'image', mediaAssetId: reference.id, mediaVersion: reference.version,
        alt: title, sourceIds: [reference.source.id] },
      { kind: 'paragraph', text: document.notice, sourceIds: [reference.source.id] },
    ],
  });
  const layoutId = 'hero-caption' as const;
  const scenes = await layoutSlides(content, theme, layoutId);
  return { content, layoutId, reference, scenes: scenes.map(scene => ({ ...scene,
    elements: scene.elements.map(element => element.kind === 'image' && element.mediaAssetId === reference.id
      ? { ...element, fit: 'contain' as const } : element),
  })) };
}

type Delivery = { audience: ProposalAudience; format: ExportFormat | 'pdf'; stage: 'export' | 'download' };

/** Use immutable pins from the selected persisted pages or export manifest.
 * Only release the prepared result after source reauthorization and durable source audit. */
export async function withAuditedStackingDelivery(ctx: PitchContext, selectedPins: readonly unknown[],
  delivery: Delivery, prepare: () => Promise<Response>): Promise<Response> {
  if (selectedPins.length > 200) throw new Error('PITCH_VISUAL_SCOPE_TOO_LARGE');
  const pins = selectedPins.map(pin => pinnedVisualInput.parse(pin))
    .filter(pin => pin.origin.type === 'stacking-snapshot' || pin.kind === 'stacking-plan');
  if (!pins.length) return prepare();
  const reauthorize = () => resolveReferencedVisualMedia(ctx, pins, [], delivery.audience);
  await reauthorize();

  const byBuilding = new Map<string, Map<string, string>>();
  for (const pin of pins) {
    if (pin.origin.type !== 'stacking-snapshot') throw new Error('PITCH_INVALID');
    const buildingId = pin.origin.buildingId;
    const references = byBuilding.get(buildingId) ?? new Map<string, string>();
    references.set(pin.id, pin.versionHash);
    byBuilding.set(buildingId, references);
  }
  const auditedPreparation = [...byBuilding].reduceRight<() => Promise<Response>>((run, [buildingId, references]) => () =>
    withCriticalAudit(ctx.client, {
      user_id: ctx.identity.actorId, action_type: 'STACKING_PLAN_EXPORT', module: 'stacking-plan',
      target_table: 'buildings', target_id: buildingId,
      details: { entry: 'pitch', building_id: buildingId, format: delivery.format, stage: delivery.stage,
        phase: 'export_requested', source_versions: [...references].map(([visualId, version]) => ({ visual_id: visualId, version })) },
    }, 'pitch/stacking-delivery', async record => {
      const response = await run();
      if (response.ok) record({ phase: 'export_authorized', stage: delivery.stage, format: delivery.format });
      return response;
    }, true), async () => {
    const response = await prepare();
    if (response.ok) await reauthorize();
    return response;
  });
  return auditedPreparation();
}
