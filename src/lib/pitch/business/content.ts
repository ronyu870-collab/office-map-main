import { slideContentSchema, type SlideContent, type PitchScope } from '../contracts/content';
import type { LayoutId } from '../contracts/scene';
import { ECOSYSTEM_BY_ID } from '../templates/ecosystem';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import type { BusinessProfile, BusinessRecipe } from './protocol';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
export type BusinessAsset = { id: string; version: number; scope: PitchScope; profile: BusinessProfile; content: SlideContent };
export type BusinessPage = { content: SlideContent; layoutId: LayoutId; variant: 'standard'|'alternate' };
const fail = (message: string): never => { throw new DocumentError('PITCH_BUSINESS_CONTENT', message); };
export function localized(value: Record<string,string>, language: string): string {
  return value[language] || fail(`缺少 ${language} 已确认内容，请维护对应语言版本。`);
}
export function assertBusinessScope(asset: BusinessAsset, scope: PitchScope, language: string, allowFallback: boolean) {
  if (!asset.content.locale.startsWith(language)) fail('素材语言不匹配，不能自动翻译。');
  if (Object.entries(scope).every(([k,v])=>asset.scope[k as keyof PitchScope]===v)) return;
  const p = asset.profile;
  if (allowFallback && p.kind === 'corporate' && ['global','china'].includes(p.coverage)
    && asset.scope.organizationId === scope.organizationId && p.fallbackFor.some(s => Object.entries(scope).every(([k,v]) => s[k as keyof PitchScope] === v))) return;
  fail('所选素材不属于目标区域、城市或业务线；通用版本必须明确配置回退范围。');
}
export function validateBusinessProfile(profile: BusinessProfile, source: SlideContent) {
  const displays=profile.kind==='case'?[profile.display,...(profile.briefDisplay?[profile.briefDisplay]:[])]:profile.kind==='research'||profile.kind==='custom'?[profile.content]:[];
  for (const embedded of displays) {
    if (embedded.locale !== source.locale || embedded.dataAsOf !== source.dataAsOf || embedded.isTestData !== source.isTestData) fail('展示内容必须保留原素材语言、业务日期与测试标记。');
    if (JSON.stringify(embedded.sources) !== JSON.stringify(source.sources)) fail('业务档案必须保留完整来源引用。');
  }
  if (profile.kind === 'case') {
    if (!profile.displayApproved) fail('案例必须先确认完整展示版本。');
    if (profile.disclosureMode === 'anonymous') {
      const internalName=profile.internalClientName;
      if (!internalName) return fail('匿名案例需要维护受限客户名称以验证展示版本。');
      const publicText = JSON.stringify(displays.map(d=>({...d,sources:[]})));
      if (publicText.normalize('NFKC').toLowerCase().includes(internalName.normalize('NFKC').toLowerCase())) fail('匿名展示版本仍包含受限客户名称。');
      if (displays.some(d=>d.blocks.some(b=>b.kind==='image'||b.kind==='team'&&b.members.some(m=>m.mediaAssetId)))) fail('匿名案例首版仅支持已确认文字、表格和图表；照片请制作独立可公开资产。');
    }
  }
}
function envelope(asset: BusinessAsset, blocks: SlideContent['blocks'], title: string): SlideContent {
  return slideContentSchema.parse({...asset.content,title,subtitle:undefined,blocks});
}
/** Only the reviewed display allowlist enters SlideContent. Private profile fields never reach a scene or workbook. */
export function caseDisplay(asset: BusinessAsset,brief=false) {
  const p=asset.profile;if(p.kind!=='case') return fail('需要案例档案。');validateBusinessProfile(p,asset.content);
  const display=brief?(p.briefDisplay??fail('未维护已确认的案例精简展示版本，请先补充 briefDisplay。')):p.display;
  const sources=display.sources.map(s=>p.disclosureMode==='anonymous'?{...s,label:'经确认的匿名案例资料',locator:s.pageId?'来源页 '+s.pageId:'受控来源记录',version:s.sha256?.slice(0,32)??'approved-display/1',recordId:undefined}:s);
  return slideContentSchema.parse({...display,sources,disclosure:asset.content.disclosure});
}
export function buildBusinessPages(recipe: BusinessRecipe, assets: BusinessAsset[], language: 'zh'|'en', length: 'brief'|'detailed', variant: 'standard'|'alternate'): BusinessPage[] {
  if (!recipe.enabled || !assets.length || assets.length>recipe.maxAssets || assets.some(a=>!recipe.accepts.includes(a.profile.kind))) return fail('所选素材类型、数量或模板状态不匹配。');
  const spec=ECOSYSTEM_BY_ID.get(recipe.id);
  if(spec){
    if(recipe.layoutId!==spec.patternId||recipe.strategy!=='content')return fail('业务模板与已验证布局版本不一致。');
    const kinds=PATTERN_BY_ID.get(spec.patternId)!.slots.map(s=>s.kind);
    for(const a of assets)for(const kind of new Set(kinds)){
      if((a.profile.kind==='custom'?a.profile.content:a.content).blocks.filter(b=>b.kind===kind).length<kinds.filter(k=>k===kind).length)return fail('缺少模板所需内容：'+spec.fields.join('、'));
    }
  }
  const pages: BusinessPage[]=[];const en=language==='en';
  const add=(a:BusinessAsset,blocks:SlideContent['blocks'],title=localized(recipe.names,language),layoutId=recipe.layoutId)=>pages.push({content:envelope(a,blocks,title),layoutId,variant});
  const refs=(a:BusinessAsset)=>a.content.sources.map(s=>s.id);
  if (['team','roles','organization'].includes(recipe.strategy)) {
    const first=assets[0], allSources=[...new Map(assets.flatMap(a=>a.content.sources).map(s=>[s.id,s])).values()];
    const team=assets.map(a=>{if(a.profile.kind!=='team')return fail('需要团队档案。');return {a,p:a.profile};});
    if(recipe.strategy==='organization') {
      const ids=new Set(assets.map(a=>a.id));
      for(const {p} of team)if(p.reportsToAssetId&&!ids.has(p.reportsToAssetId))fail('组织结构需要同时选择上级成员，不能猜测汇报关系。');
      for(const {a} of team){const visited=new Set<string>();let next:string|null=a.id;while(next){if(visited.has(next))fail('团队汇报关系存在循环。');visited.add(next);next=team.find(t=>t.a.id===next)?.p.reportsToAssetId??null;}}
    }
    if(allSources.length>30)fail('组合来源超过协议容量，请拆分团队。');
    // Each page carries its actual contributing member sources, rather than a
    // deck-wide footer that grows with every selected member.
    const per=variant==='alternate'?2:3;
    for(let offset=0;offset<team.length;offset+=per){
      const selected=team.slice(offset,offset+per),localSources=[...new Map(selected.flatMap(t=>t.a.content.sources).map(s=>[s.id,s])).values()],sourceIds=localSources.map(s=>s.id);
      const combined={...first,content:{...selected[0].a.content,sources:localSources,isTestData:selected.some(t=>t.a.content.isTestData),disclosure:selected.every(t=>t.a.content.disclosure==='client_approved')?'client_approved' as const:'internal' as const}};
      if(recipe.strategy==='team')add(combined,[{kind:'team',members:selected.map(({a,p})=>({name:localized(p.name,language),title:localized(p.position,language),biography:p.team+'\n'+a.content.dataAsOf,...(p.photo?{mediaAssetId:p.photo.id,mediaVersion:p.photo.version}:{})})),sourceIds}]);
      else add(combined,[{kind:'table',columns:en?['Member','Position',recipe.strategy==='roles'?'Project role':'Reports to']:['成员','职位',recipe.strategy==='roles'?'项目角色':'汇报对象'],rows:selected.map(({p})=>[localized(p.name,language),localized(p.position,language),recipe.strategy==='roles'?localized(p.projectRole,language):p.reportsToAssetId?localized(team.find(t=>t.a.id===p.reportsToAssetId)!.p.name,language):en?'No superior specified':'未指定上级']),sourceIds}]);
    }
    // Long biographies, qualifications and projects remain as complete continuation pages.
    if(recipe.strategy==='team'&&length==='detailed')for(const {a,p}of team){const full=[localized(p.projectRole,language),localized(p.experience,language),...p.expertise,...p.qualifications,...p.representativeProjects].join('\n');add(a,(full.match(/[\s\S]{1,3900}/g)??[]).map(text=>({kind:'paragraph',text,sourceIds:refs(a)})),localized(p.name,language),'two-columns');}
    return pages;
  }
  if(['track-record','public-projects'].includes(recipe.strategy)) {
    for(const a of assets){const p=a.profile;if(p.kind!=='case')return fail('需要案例档案。');const safe=caseDisplay(a);
      if(p.disclosureMode==='anonymous'&&[p.city,p.serviceType].some(v=>v.normalize('NFKC').toLowerCase().includes(p.internalClientName!.normalize('NFKC').toLowerCase())))fail('案例汇总字段含受限客户信息，请确认匿名城市与服务字段。');
      if(recipe.strategy==='public-projects'&&p.disclosureMode!=='named')fail('公开项目展示只接受明确批准披露名称的案例。');
      // Never infer a sum or rename the transaction area as a performance total.
      pages.push({content:safe,layoutId:recipe.layoutId,variant});pages[pages.length-1].content={...safe,blocks:[{kind:'table',columns:en?['Case','Date','City','Service']:['案例','发生日期','城市','服务'],rows:[[safe.title,p.occurredOn,p.city,p.serviceType]],sourceIds:safe.sources.map(s=>s.id)}]};
    }return pages;
  }
  for(const a of assets){const p=a.profile,sourceIds=refs(a);
    if(p.kind==='corporate') {
      if(recipe.strategy==='metrics'){if(!p.metrics.length)fail('没有已确认企业指标。');add(a,p.metrics.map(m=>({kind:'metric',label:localized(m.label,language),value:m.value,unit:m.unit,sourceIds})));}
      else {const text=recipe.strategy==='capabilities'?[...p.capabilities,...p.honors].map(v=>localized(v,language)).join('\n'):localized(length==='brief'?p.brief:p.detailed,language);if(!text)fail('缺少已确认内容。');add(a,[{kind:'paragraph',text,sourceIds}]);
        for(const image of p.photos)add(a,[{kind:'image',mediaAssetId:image.id,mediaVersion:image.version,alt:a.content.title,sourceIds}],a.content.title,'cover');}
    }else if(p.kind==='case') {const safe=caseDisplay(a,recipe.strategy==='case-brief');pages.push({content:safe,layoutId:recipe.strategy==='case-brief'?'case-study':recipe.layoutId,variant});}
    else if(p.kind==='research') {
      validateBusinessProfile(p,a.content);const note=en?`Evidence: ${p.evidenceType}`:`资料性质：${({'published-report':'已发布报告','historical-view':'历史观点','current-data':'经确认的有效数据',forecast:'预测','custom-analysis':'自定义分析'})[p.evidenceType]}`;
      const combined=p.content.blocks.every(b=>b.kind==='chart'||b.kind==='insight')&&p.content.blocks.some(b=>b.kind==='chart')&&p.content.blocks.some(b=>b.kind==='insight');
      pages.push({content:{...p.content,subtitle:note},layoutId:combined?'chart-insight':recipe.layoutId,variant});
      add(a,[{kind:'paragraph',text:localized(p.methodology,language),sourceIds}],en?'Research methodology':'研究口径','two-columns');
    }
    else if(p.kind==='custom') {validateBusinessProfile(p,a.content);pages.push({content:p.content,layoutId:recipe.layoutId,variant});}
    else fail('模板不能处理此业务档案。');
  }
  return pages;
}
