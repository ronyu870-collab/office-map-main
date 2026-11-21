/** Small, controlled navigation context; never copy search text, URLs or credentials. */
export const READING_ENTRIES = ['map_marker','map_list','map_full_list','map_search','direct_link','map_return','map_detail','map_gallery','search','ai_query','library','stacking_plan','lease_history','quarterly_research','occupier_insights','compare','submarket','unknown'] as const;
export type ReadingEntry = typeof READING_ENTRIES[number];
export type ReadingContext = { entry: ReadingEntry; correlation_id: string; origin_request_id?:string };
export function readingEntry(value: unknown): ReadingEntry {
  return READING_ENTRIES.includes(value as ReadingEntry) ? value as ReadingEntry : 'unknown';
}
export function createReadingContext(entry?: ReadingEntry): ReadingContext {
  let origin:string|undefined;
  if (typeof window !== 'undefined') {
    const url=new URL(window.location.href);
    const request=url.searchParams.get('aiRequest');
    if(request && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request))origin=request;
    if(!entry)entry=origin?'ai_query':url.searchParams.get('back')?.startsWith('/search')?'search':url.pathname==='/map'?'map_detail':'unknown';
    if(entry==='lease_history')entry=url.searchParams.get('back')?.startsWith('/search')?'search':url.searchParams.get('back')?.startsWith('/map')?'map_detail':entry;
  }
  let correlation='';try{correlation=globalThis.crypto?.randomUUID?.() ?? '';}catch{}
  return {entry:entry ?? 'unknown',correlation_id:correlation,...(origin?{origin_request_id:origin}:{})};
}

export function readingHeaders(context: ReadingContext): Record<string,string> {
  return { 'x-reading-entry': context.entry, 'x-reading-id': context.correlation_id,...(context.origin_request_id?{'x-reading-origin-id':context.origin_request_id}:{}) };
}

// Shared by all building entry points and resource panels. Bounded, memory only.
const buildingContexts=new Map<string,ReadingContext>();
export function beginBuildingReading(buildingId:string,entry:ReadingEntry,relatedBuildingId?:string){
  const context=createReadingContext(entry);buildingContexts.delete(buildingId);buildingContexts.set(buildingId,context);
  if(relatedBuildingId && relatedBuildingId!==buildingId)buildingContexts.set(relatedBuildingId,context);
  while(buildingContexts.size>30)buildingContexts.delete(buildingContexts.keys().next().value!);
  return context;
}
export function buildingReadingContext(buildingId:string):ReadingContext {
  return buildingContexts.get(buildingId) ?? createReadingContext();
}
