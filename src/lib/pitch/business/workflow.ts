import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { designThemeSchema } from '../design/theme';
import { slideContentSchema } from '../contracts/content';
import { pitchRpc, mediaRowSchema, readFile, digest, type PitchContext } from '../data/store';
import { assetContext, assetInput } from '../library/workflow';
import { documentTokens } from '@/src/lib/intelligence/knowledge/parser';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { layoutSlides } from '../layout/engine';
import { normalizationPlan } from '../library/normalize';
import { numberDeckPages } from '../layout/pagination';
import { LayoutError } from '../layout/metrics';
import { assertSceneQuality } from '../layout/quality';
import { inspectMedia, sceneMediaReferences, type SceneMedia } from '../render/media';
import { businessProfileSchema, recipeSchema, type Generation, type BusinessProfile } from './protocol';
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
  const currentPeriods=command.parts.filter(p=>p.mode==='dynamic'&&!p.parameters.templateId.endsWith('-trend')&&!p.parameters.templateId.startsWith('lease-')).map(p=>p.mode==='dynamic'?JSON.stringify(p.parameters.period):'');
  if(new Set(currentPeriods).size>1)throw new DocumentError('PITCH_PERIOD_MISMATCH','同一 Pitch 的项目对比页面需要采用同一正式季度。');
  for(const part of command.parts) {
    if(part.mode==='dynamic') {
      const snapshot=preparedSnapshot ?? await runPitchDataAdapter(ctx,part.parameters,command.language,compareOutline);
      if (expectedBinding && (documentDataVersion(snapshot.results) !== expectedBinding.dataVersion || snapshot.binding.domain !== expectedBinding.domain ||
        snapshot.binding.permissionRevision !== expectedBinding.permissionRevision || snapshot.binding.policyVersion !== expectedBinding.policyVersion))
        throw new Error('PITCH_HANDOFF_CHANGED');
      if (expectedDataFingerprint && reviewedBuildingData(snapshot, command.language).fingerprint !== expectedDataFingerprint)
        throw new Error('PITCH_OUTLINE_DATA_CHANGED');
      const snapshotIndex=snapshots.push(snapshot)-1;
      if(part.researchAssetId) {
        const stored=storedSchema.parse(await pitchRpc(ctx,{action:'business_generation_asset',assetId:part.researchAssetId}));
        const a:BusinessAsset={id:part.researchAssetId,version:stored.asset.current_version,scope:{organizationId:stored.asset.organization_id,region:stored.asset.region,city:stored.asset.city,businessLine:stored.asset.business_line},profile:stored.profile,content:stored.version.content};
        assertBusinessScope(a,command.scope,command.language,false);
        if(a.profile.kind!=='research')throw new DocumentError('PITCH_BUSINESS_CONTENT','组合分析必须选择正式研究资产。');
        validateBusinessProfile(a.profile,a.content);
        const insight=a.profile.content.blocks.filter(b=>b.kind==='insight').map(b=>({...b,basis:`${a.content.dataAsOf} · ${a.profile.kind==='research'?a.profile.evidenceType:''}\n${b.basis}`}));
        const chart=snapshot.content.find(c=>c.blocks.some(b=>b.kind==='chart'));
        if(!chart||!insight.length)throw new DocumentError('PITCH_BUSINESS_CONTENT','需要原生图表及经确认的研究观点；不自动编造分析。');
        chart.blocks.push(...insight);chart.sources.push(...a.profile.content.sources.filter(s=>!chart.sources.some(r=>r.id===s.id)));chart.isTestData=chart.isTestData||a.content.isTestData;
        bindings.push({id:a.id,version:a.version});
      }
      for (const [index, content] of snapshot.content.entries()) {
        const period = part.parameters.period;
        const english = command.language === 'en';
        const subtitle = expectedDataFingerprint
          ? [content.subtitle ?? `${period.year} Q${period.quarter}${index ? (english ? ' · Method and coverage' : ' · 口径与覆盖') : ''}`,
            english ? 'Internal use only' : '仅限内部'].join(' · ')
          : content.subtitle;
        groups.push({
          capture: { snapshotIndex, contentIndex: index },
          content: part.title ? { ...content, title: part.title, subtitle } : content,
          layoutId: compareOutline && index >= snapshot.content.length - 2 ? 'table-insight' : content.blocks.some(b => b.kind === 'chart') ? 'chart-insight' : content.blocks.some(b => b.kind === 'table') ? 'data-table' : 'two-columns',
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
  const media:SceneMedia[]=[];
  for(const ref of sceneMediaReferences(slides.map(p=>p.scene))) {
    const row=mediaRows.find(m=>m.id===ref.id&&m.version===ref.version);if(!row)throw new Error('PITCH_DENIED');
    media.push({id:row.id,version:row.version,mime:row.mime,bytes:await readFile(ctx,{bucket:'pitch-studio-private',path:row.storage_path,mime:row.mime,size:row.size_bytes,sha256:row.sha256})});
  }
  const inspected=await inspectMedia(media);for(const p of slides)await assertSceneQuality(p.scene,theme,inspected);
  const numbered=numberDeckPages(slides).map(({slideId,assetId,assetVersion,content,scene})=>({slideId,assetId,assetVersion,content,scene}));
  const requestKey=hash(command);
  const input={...command,action:'business_generate_commit',requestKey,bindings,snapshots,recipes,changes,generated,slides:numbered};
  if(Buffer.byteLength(JSON.stringify(input))>8*1024*1024)throw new DocumentError('PITCH_PAGE_LIMIT','本次内容超过生成容量，请缩小范围或拆分提案。');
  return { input, capturedAssets };
}
export async function generateBusinessProject(
  ctx: PitchContext, command: Generation, expectedAssetVersions?: ReadonlyMap<string, number>,
  expectedDataFingerprint?: string, compareOutline = false,
  evidence?: (DataBinding & { dataVersion: string }) | ((snapshots: readonly PitchDataSnapshot[]) => void | Promise<void>),
) {
  const expectedBinding = typeof evidence === 'function' ? undefined : evidence;
  const { input } = await prepareBusinessProject(ctx, command, expectedAssetVersions, expectedDataFingerprint, compareOutline, undefined, expectedBinding);
  if (typeof evidence === 'function') await evidence(input.snapshots);
  return pitchRpc(ctx,input);
}
export async function restoreBusinessProject(ctx:PitchContext,command:{projectId:string;sourceProjectId:string;title:string}) {
  await pitchRpc(ctx,{action:'business_generation',projectId:command.sourceProjectId});
  return pitchRpc(ctx,{action:'business_restore',...command});
}
export function compareBusinessSnapshots(left:unknown,right:unknown) {
  const schema=z.object({snapshots:z.array(z.object({dataVersion:z.string(),dataAsOf:z.string(),results:z.array(z.object({table:z.unknown()}))}))});
  const a=schema.parse(left),b=schema.parse(right);
  return {before:a.snapshots,after:b.snapshots,changed:JSON.stringify(a.snapshots.map(s=>s.results.map(r=>r.table)))!==JSON.stringify(b.snapshots.map(s=>s.results.map(r=>r.table)))};
}
