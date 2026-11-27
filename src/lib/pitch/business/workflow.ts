import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { designThemeSchema } from '../design/theme';
import { slideContentSchema } from '../contracts/content';
import { pitchRpc, mediaRowSchema, digest, type PitchContext } from '../data/store';
import { loadMedia } from '../data/renderWorkflow';
import { assetContext, assetInput } from '../library/workflow';
import { documentTokens } from '@/src/lib/intelligence/knowledge/parser';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { layoutSlides } from '../layout/engine';
import { normalizationPlan } from '../library/normalize';
import { numberDeckPages } from '../layout/pagination';
import { LayoutError } from '../layout/metrics';
import { assertSceneQuality } from '../layout/quality';
import { businessProfileSchema, dynamicParametersSchema, recipeSchema, type Generation, type BusinessProfile } from './protocol';
import { assertBusinessScope, buildBusinessPages, caseDisplay, validateBusinessProfile, type BusinessAsset, type BusinessPage } from './content';
import { runPitchDataAdapter, type DataBinding, type PitchDataSnapshot } from './adapter';
import { documentDataVersion } from './document-version';
import { reviewedBuildingData } from './outline-data';
const hash=(v:unknown)=>digest(new TextEncoder().encode(JSON.stringify(v)));
const storedSchema=z.object({asset:z.object({id:z.uuid(),current_version:z.number(),organization_id:z.string(),region:z.string(),city:z.string(),business_line:z.string()}).passthrough(),version:z.object({content:slideContentSchema}),profile:businessProfileSchema,media:z.array(mediaRowSchema)});
export function profileMedia(profile:BusinessProfile) {
  if(profile.kind==='team')return profile.photo?[profile.photo]:[];
  if(profile.kind==='corporate'||profile.kind==='case')return profile.photos;
  return [];
}
export async function saveBusinessProfile(ctx:PitchContext,c:{assetId:string;expectedVersion:number;profile:BusinessProfile}) {
  const current=await assetContext(ctx,c.assetId),profile=businessProfileSchema.parse(c.profile);
  validateBusinessProfile(profile,current.version.content);
  const asset=assetInput(current.asset,current.version.content);
  if(profile.kind==='case') {
    asset.content=caseDisplay({id:c.assetId,version:c.expectedVersion,scope:asset.scope,content:asset.content,profile});
    if(profile.briefDisplay)profile.briefDisplay=caseDisplay({id:c.assetId,version:c.expectedVersion,scope:asset.scope,content:current.version.content,profile},true);
    profile.display=asset.content;asset.names={[asset.content.locale]:asset.content.title};
  }
  // Editing facts always creates a new draft; normal library confirmation publishes it.
  asset.state='draft';asset.allowClientExport=false;asset.allowExternalAi=false;
  return pitchRpc(ctx,{action:'business_profile_save',assetId:c.assetId,expectedVersion:c.expectedVersion,profile,asset,sha256:hash(asset.content),tokens:documentTokens(JSON.stringify([asset.content,profile])),media:profileMedia(profile)});
}
export async function prepareBusinessProject(ctx:PitchContext,command:Generation,expectedAssetVersions?:ReadonlyMap<string,number>, expectedDataFingerprint?:string, compareOutline = false, preparedSnapshot?: PitchDataSnapshot, expectedBinding?: DataBinding & { dataVersion:string }) {
  const registry=z.object({theme:z.object({definition:designThemeSchema})}).parse(await pitchRpc(ctx,{action:'registry',templateId:'business-content',templateVersion:1,themeId:command.themeId,themeVersion:command.themeVersion}));
  const theme=registry.theme.definition,bindings:{id:string;version:number}[]=[],snapshots:PitchDataSnapshot[]=[],recipes:{id:string;revision:number}[]=[],groups:(BusinessPage & { capture?: { snapshotIndex:number; contentIndex:number } })[]=[],mediaRows:z.infer<typeof mediaRowSchema>[]=[];
  // Keep one fact receipt per authorized query and source-only content for each
  // chapter. A research annotation must never mutate the shared query result.
  const queries = new Map<string, { source: PitchDataSnapshot; index: number; variants: Map<string, number[]> }>();
  const snapshotsByPart: PitchDataSnapshot[] = [];
  const currentPeriods=command.parts.filter(p=>p.mode==='dynamic'&&!p.parameters.templateId.endsWith('-trend')&&!p.parameters.templateId.startsWith('lease-')).map(p=>p.mode==='dynamic'?JSON.stringify(p.parameters.period):'');
  if(new Set(currentPeriods).size>1)throw new DocumentError('PITCH_PERIOD_MISMATCH','同一 Pitch 的项目对比页面需要采用同一正式季度。');
  for(const part of command.parts) {
    if(part.mode==='dynamic') {
      const parameters = dynamicParametersSchema.parse(part.parameters);
      const key = JSON.stringify(parameters);
      let query = queries.get(key);
      if (!query) {
        const source = preparedSnapshot && key === JSON.stringify(dynamicParametersSchema.parse(preparedSnapshot.parameters))
          ? preparedSnapshot : await runPitchDataAdapter(ctx, parameters, command.language, compareOutline);
        const index = snapshots.push({ ...source, content: [] }) - 1;
        query = { source, index, variants: new Map() };
        queries.set(key, query);
      }
      const { source, index: snapshotIndex, variants } = query;
      if (expectedBinding && (documentDataVersion(source.results) !== expectedBinding.dataVersion || source.binding.domain !== expectedBinding.domain ||
        source.binding.permissionRevision !== expectedBinding.permissionRevision || source.binding.policyVersion !== expectedBinding.policyVersion))
        throw new Error('PITCH_HANDOFF_CHANGED');
      if (expectedDataFingerprint && reviewedBuildingData(source, command.language).fingerprint !== expectedDataFingerprint)
        throw new Error('PITCH_OUTLINE_DATA_CHANGED');
      let variantKey = 'data';
      let variant = source.content;
      if(part.researchAssetId) {
        const stored=storedSchema.parse(await pitchRpc(ctx,{action:'business_generation_asset',assetId:part.researchAssetId}));
        const a:BusinessAsset={id:part.researchAssetId,version:stored.asset.current_version,scope:{organizationId:stored.asset.organization_id,region:stored.asset.region,city:stored.asset.city,businessLine:stored.asset.business_line},profile:stored.profile,content:stored.version.content};
        assertBusinessScope(a,command.scope,command.language,false);
        if(a.profile.kind!=='research')throw new DocumentError('PITCH_BUSINESS_CONTENT','组合分析必须选择正式研究资产。');
        validateBusinessProfile(a.profile,a.content);
        const insight=a.profile.content.blocks.filter(b=>b.kind==='insight').map(b=>({...b,basis:`${a.content.dataAsOf} · ${a.profile.kind==='research'?a.profile.evidenceType:''}\n${b.basis}`}));
        const chart=source.content.find(c=>c.blocks.some(b=>b.kind==='chart'));
        if(!chart||!insight.length)throw new DocumentError('PITCH_BUSINESS_CONTENT','需要原生图表及经确认的研究观点；不自动编造分析。');
        const researchSources = a.profile.content.sources.filter(s => !chart.sources.some(r => r.id === s.id));
        variant = source.content.map(content => content === chart ? { ...chart, blocks: [...chart.blocks, ...insight],
          sources: [...chart.sources, ...researchSources], isTestData: chart.isTestData || a.content.isTestData } : content);
        variantKey = a.id + ':' + a.version;
        if (!bindings.some(binding => binding.id === a.id && binding.version === a.version)) bindings.push({ id: a.id, version: a.version });
      }
      const stored = snapshots[snapshotIndex];
      let contentIndices = variants.get(variantKey);
      if (!contentIndices) {
        contentIndices = variant.map(content => {
          const index = stored.content.indexOf(content);
          return index >= 0 ? index : stored.content.push(content) - 1;
        });
        variants.set(variantKey, contentIndices);
      }
      snapshotsByPart.push({ ...source, content: variant });
      for (const [index, content] of variant.entries()) {
        const period = part.parameters.period;
        const english = command.language === 'en';
        const subtitle = expectedDataFingerprint
          ? [content.subtitle ?? `${period.year} Q${period.quarter}${index ? (english ? ' · Method and coverage' : ' · 口径与覆盖') : ''}`,
            english ? 'Internal use only' : '仅限内部'].join(' · ')
          : content.subtitle;
        groups.push({
          capture: { snapshotIndex, contentIndex: contentIndices[index] },
          content: part.title ? { ...content, title: part.title, subtitle } : content,
          layoutId: compareOutline && index >= variant.length - 2 ? 'table-insight' : content.blocks.some(b => b.kind === 'chart') ? 'chart-insight' : content.blocks.some(b => b.kind === 'table') ? 'data-table' : 'two-columns',
          variant: 'standard',
        });
      }
      continue;
    }
    if(part.mode==='static'&&part.assetIds.length!==1)throw new DocumentError('PITCH_BUSINESS_CONTENT','Static 模式只接受一份正式资产；多素材请选择 Semi-dynamic。');
    const recipe=recipeSchema.parse(await pitchRpc(ctx,{action:'business_recipe',templateId:part.templateId}));recipes.push({id:recipe.id,revision:recipe.revision});
    const assets:BusinessAsset[]=[];
    for(const id of part.assetIds) {
      const stored=storedSchema.parse(await pitchRpc(ctx,{action:'business_generation_asset',assetId:id}));
      if (expectedAssetVersions && expectedAssetVersions.get(id) !== stored.asset.current_version)
        throw new Error('PITCH_OUTLINE_SOURCE_CHANGED');
      const a:BusinessAsset={id,version:stored.asset.current_version,scope:{organizationId:stored.asset.organization_id,region:stored.asset.region,city:stored.asset.city,businessLine:stored.asset.business_line},profile:stored.profile,content:stored.version.content};
      assertBusinessScope(a,command.scope,command.language,part.allowFallback);assets.push(a);mediaRows.push(...stored.media);
      if(!bindings.some(b=>b.id===id))bindings.push({id,version:a.version});
    }
    for(const page of buildBusinessPages(recipe,assets,command.language,part.length,part.variant))groups.push({...page,content:part.title?{...page.content,title:part.title}:page.content});
  }
  const slides=[],generated=[];const changes:{group:number;reason:string}[]=[];
  const capturedAssets: { assetId:string; snapshotIndex:number; contentIndex:number }[]=[];
  for(const [group,page]of groups.entries()) {
    const content=slideContentSchema.parse(page.content),assetId=randomUUID();
    let parts;
    try { parts = [{ content, scenes: await layoutSlides(content, theme, page.layoutId, page.variant) }]; }
    catch(error) {
      if (!(error instanceof LayoutError) || PATTERN_BY_ID.has(page.layoutId)) throw error;
      const normalized = await normalizationPlan(content, theme);
      parts = [];
      for (const part of normalized) parts.push({ content: part.content, scenes: await layoutSlides(part.content, theme, part.layoutId, part.variant) });
      changes.push({ group, reason:error.code });
    }
    generated.push({id:assetId,content,sha256:hash(content)});
    if (page.capture) capturedAssets.push({ assetId, ...page.capture });
    for(const part of parts)for(const scene of part.scenes)slides.push({slideId:randomUUID(),assetId,assetVersion:1,content:part.content,scene,theme});
    if(slides.length>50)throw new DocumentError('PITCH_PAGE_LIMIT','本次生成超过 50 页，请拆为多个 Pitch；未静默删减内容。');
  }
  const media = await loadMedia(ctx, mediaRows, slides.map(page => page.scene), 'PITCH_DENIED');
  for (const page of slides) await assertSceneQuality(page.scene, theme, media);
  const numbered=numberDeckPages(slides).map(({slideId,assetId,assetVersion,content,scene})=>({slideId,assetId,assetVersion,content,scene}));
  const requestKey=hash(command);
  const input={...command,action:'business_generate_commit',requestKey,bindings,snapshots,recipes,changes,generated,slides:numbered};
  if(Buffer.byteLength(JSON.stringify(input))>8*1024*1024)throw new DocumentError('PITCH_PAGE_LIMIT','本次内容超过生成容量，请缩小范围或拆分提案。');
  return { input, capturedAssets, snapshotsByPart };
}
export async function generateBusinessProject(ctx:PitchContext,command:Generation,expectedAssetVersions?:ReadonlyMap<string,number>,
  expectedDataFingerprint?:string, compareOutline = false,
  evidence?: (DataBinding & { dataVersion:string }) | ((snapshots: readonly PitchDataSnapshot[]) => void | Promise<void>),
) {
  const expectedBinding = typeof evidence === 'function' ? undefined : evidence;
  const { input, snapshotsByPart } = await prepareBusinessProject(ctx,command,expectedAssetVersions,expectedDataFingerprint,compareOutline,undefined,expectedBinding);
  if (typeof evidence === 'function') await evidence(snapshotsByPart);
  return pitchRpc(ctx,input);
}
export async function restoreBusinessProject(ctx:PitchContext,command:{projectId:string;sourceProjectId:string;title:string}) {
  await pitchRpc(ctx,{action:'business_generation',projectId:command.sourceProjectId});
  return pitchRpc(ctx,{action:'business_restore',...command});
}
export function compareBusinessSnapshots(left:unknown,right:unknown) {
  const snapshot = z.object({ dataVersion: z.string(), dataAsOf: z.string(), results: z.array(z.object({ table: z.unknown() })),
    parameters: z.unknown().optional() });
  const schema = z.object({ snapshots: z.array(snapshot) });
  const compareTables = (items: z.infer<typeof snapshot>[]) => {
    const seen = new Set<string>();
    return items.flatMap(item => {
      const tables = item.results.map(result => result.table);
      if (item.parameters === undefined) return [tables];
      const key = JSON.stringify([item.parameters, tables]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [tables];
    });
  };
  const before = schema.parse(left).snapshots, after = schema.parse(right).snapshots;
  const display = ({ dataVersion, dataAsOf, results }: z.infer<typeof snapshot>) => ({ dataVersion, dataAsOf, results });
  return { before: before.map(display), after: after.map(display), changed: JSON.stringify(compareTables(before)) !== JSON.stringify(compareTables(after)) };
}
