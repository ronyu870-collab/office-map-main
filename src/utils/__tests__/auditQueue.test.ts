import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: { getSession: fixture.getSession } } }));
vi.mock('@/src/services/deviceIdentity', () => ({ getOrCreateDeviceId: () => 'test-device' }));
const user = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = `e30.${btoa(JSON.stringify({ session_id: sessionId }))}.fixture`;
let queue: typeof import('../audit');
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
async function rows() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('colliers-audit-outbox-v1', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!db.objectStoreNames.contains('events')) { db.close(); return []; }
  const data = await new Promise<unknown[]>((resolve, reject) => {
    const request = db.transaction('events').objectStore('events').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close(); return data;
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  fixture.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: user }, access_token: token } } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  queue = await import('../audit');
  queue.setAuditSessionContext({ userId: user, authSessionId: sessionId });
});
afterEach(() => { queue.clearAuditSessionContext(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('does not interpret HTTP 200 without explicit event acknowledgements as persistence', async () => {
  queue.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { building: 'fixture' } });
  await pause();
  await queue.flushAuditLogs();
  expect(await rows()).toHaveLength(1);
});

test('a burst uses bounded batch storage work, not a capacity query for each event', async () => {
  const count = vi.spyOn(IDBObjectStore.prototype, 'count');
  for (let i = 0; i < 40; i++) queue.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { id: i } });
  await pause();
  expect((await rows()).length).toBe(40);
  expect(count.mock.calls.length).toBeLessThanOrEqual(3);
  expect(fixture.getSession).not.toHaveBeenCalled();
});

test('event origin is captured before asynchronous storage and account switching', async () => {
  queue.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { id: 1 } });
  queue.setAuditSessionContext({ userId: 'other-user', authSessionId: 'other-session' });
  await pause();
  expect(await rows()).toEqual([expect.objectContaining({ origin_user_id: user, origin_auth_session_id: sessionId })]);
});

test('business reading observations deduplicate by object/state, retain origin and stay asynchronous', async () => {
  const { auditBuildingReading } = await import('../buildingReadingAudit');
  const a = { id: 'building-a', name: '甲楼' };
  auditBuildingReading('VIEW_BUILDING', a);
  auditBuildingReading('VIEW_BUILDING', a);
  auditBuildingReading('VIEW_BUILDING_CONTACT', a);
  auditBuildingReading('VIEW_BUILDING_CONTACT', a);
  auditBuildingReading('VIEW_BUILDING_TREND', a, { metric: 'rent' });
  auditBuildingReading('VIEW_BUILDING_TREND', a, { metric: 'vac' });
  auditBuildingReading('VIEW_BUILDING_TREND', a, { metric: 'vac' });
  auditBuildingReading('VIEW_BUILDING', { id: 'building-b' });
  expect(fetch).not.toHaveBeenCalled();
  expect(fixture.getSession).not.toHaveBeenCalled();
  queue.setAuditSessionContext({ userId: 'other-user', authSessionId: 'other-session' });
  await pause();
  const saved = await rows();
  expect(saved).toHaveLength(5);
  expect(saved.every((row: any) => row.origin_user_id === user && row.origin_auth_session_id === sessionId && row.request_source === 'frontend')).toBe(true);
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ target_table: 'buildings', target_id: 'building-a', target_name: '甲楼' })]));
});

test('only acknowledgements belonging to the submitted batch remove events', async () => {
  queue.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { id: 1 } });
  await pause();
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ accepted_event_ids: ['unrelated'], discarded_event_ids: [] })));
  await queue.flushAuditLogs();
  expect(await rows()).toHaveLength(1);
});

test('a stale asynchronous session refresh cannot restore an account after logout', async () => {
  let release!: (v: unknown) => void;
  fixture.getSession.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const refreshing = queue.refreshAuditSessionContext();
  queue.clearAuditSessionContext();
  release({ data: { session: { user: { id: user }, access_token: token } } });
  await refreshing;
  queue.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { id: 1 } });
  await pause();
  expect(await rows()).toHaveLength(0);
});

test('records separate rapid mutation observations without treating them as database proof', async () => {
  const { reportSupabaseMutation } = await import('../auditMutationBridge');
  for (let i = 0; i < 2; i++) reportSupabaseMutation({ kind: 'table', target: 'buildings', operation: 'UPDATE', method: 'PATCH', status: 204, occurredAt: new Date().toISOString() });
  await pause();
  expect(await rows()).toHaveLength(2);
});

test('suppresses per-frame interactions before opening IndexedDB', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  for (const action_type of ['MAP_MOVE', 'MAP_ZOOM', 'HOVER', 'SCROLL', 'INPUT_CHANGE']) queue.logAuditEvent({ action_type, details: {} });
  await pause();
  expect(open).not.toHaveBeenCalled();
});

test('partial acknowledgements delete exactly confirmed IDs and retry the remainder', async()=>{
  for(let i=0;i<3;i++)queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{id:i}});
  await pause();
  const before=await rows() as {event_id:string}[];
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({accepted_event_ids:[before[0].event_id],discarded_event_ids:[before[1].event_id,'foreign-id']})));
  await queue.flushAuditLogs();
  expect(await rows()).toEqual([expect.objectContaining({event_id:before[2].event_id})]);
  expect(queue.getAuditQueueHealth()).toMatchObject({acknowledged:1,discarded:1,retries:1});
});

test('network errors, timeout and malformed responses keep the durable batch with bounded retry state',async()=>{
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{id:1}});await pause();
 for(const error of [new TypeError('offline'),new DOMException('timeout','TimeoutError')]){
  vi.mocked(fetch).mockRejectedValueOnce(error);await queue.flushAuditLogs();expect(await rows()).toHaveLength(1);
 }
 vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid JSON'));await queue.flushAuditLogs();
 expect(await rows()).toHaveLength(1);expect(queue.getAuditQueueHealth().failureCount).toBe(3);
 vi.mocked(fetch).mockImplementationOnce(async(_url,init)=>new Response(JSON.stringify({accepted_event_ids:JSON.parse(String(init?.body)).events.map((e:{event_id:string})=>e.event_id)})));
 await queue.flushAuditLogs();expect(await rows()).toHaveLength(0);expect(queue.getAuditQueueHealth().failureCount).toBe(0);
});

test('IndexedDB failure retains bounded detached data and prioritizes critical supplements',async()=>{
 const open=vi.spyOn(indexedDB,'open').mockImplementation(()=>{throw new Error('storage unavailable');});
 const details={value:'before',large:'x'.repeat(1000000)};
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details});details.value='after';
 for(let i=0;i<250;i++)queue.logAuditEvent({action_type:'CLIENT_MUTATION_OBSERVED',details:{id:i}});
 queue.logAuditEvent({action_type:'DATA_DELETE',details:{id:'critical'}});await pause();
 expect(queue.getAuditQueueHealth()).toMatchObject({buffered:200,criticalSupplementDrops:0});
 expect(queue.getAuditQueueHealth().storageFailures).toBeGreaterThan(0);
 open.mockRestore();await queue.flushAuditLogs();
 const stored=await rows() as {action_type:string;details:Record<string,unknown>}[];
 expect(stored.some(e=>e.action_type==='DATA_DELETE')).toBe(true);
 expect(JSON.stringify(stored).length).toBeLessThan(200000);
 expect(JSON.stringify(stored)).not.toContain('after');
});

test('a recovered queue never sends old account rows under a new session or counts them as accepted',async()=>{
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{id:1}});await pause();
 const otherSession='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const otherToken=`e30.${btoa(JSON.stringify({session_id:otherSession}))}.fixture`;
 queue.setAuditSessionContext({userId:'other-user',authSessionId:otherSession});
 fixture.getSession.mockResolvedValue({data:{session:{user:{id:'other-user'},access_token:otherToken}}});
 await queue.flushAuditLogs();expect(fetch).not.toHaveBeenCalled();expect(await rows()).toHaveLength(0);
 expect(queue.getAuditQueueHealth()).toMatchObject({stale:1,acknowledged:0});
});

test('disk pressure drops ordinary events but never capacity-drops critical observations',async()=>{
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{seed:true}});await pause();
 const seed=(await rows())[0] as Record<string,unknown>;
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('colliers-audit-outbox-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('events','readwrite');const store=tx.objectStore('events');for(let i=0;i<1499;i++)store.put({...seed,event_id:`seed-${i}`});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{pressure:true}});
 queue.logAuditEvent({action_type:'DATA_DELETE',details:{critical:true}});await pause();
 const stored=await rows() as {action_type:string}[];
 expect(stored).toHaveLength(1501);expect(stored.filter(e=>e.action_type==='DATA_DELETE')).toHaveLength(1);
 expect(queue.getAuditQueueHealth().pressureDrops).toBe(1);
});


test('reload recovers the same durable event IDs and does not relabel their account',async()=>{
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{reload:true}});await pause();const persisted=await rows() as {event_id:string}[];
 queue.clearAuditSessionContext();vi.resetModules();queue=await import('../audit');queue.setAuditSessionContext({userId:user,authSessionId:sessionId});
 vi.mocked(fetch).mockImplementationOnce(async(_url,init)=>{const events=JSON.parse(String(init?.body)).events;expect(events[0].event_id).toBe(persisted[0].event_id);expect(events[0].origin_user_id).toBe(user);return Response.json({accepted_event_ids:events.map((e:{event_id:string})=>e.event_id)});});
 await queue.flushAuditLogs();expect(await rows()).toHaveLength(0);
});

test('bounds top-level strings and never retains unknown caller properties',async()=>{
 const giant='x'.repeat(1000000);
 queue.logAuditEvent({action_type:'VIEW_BUILDING',details:{},target_name:giant,page_url:giant,module:giant,unexpected:giant} as Parameters<typeof queue.logAuditEvent>[0]);await pause();
 const stored=(await rows())[0] as Record<string,unknown>;expect(stored).not.toHaveProperty('unexpected');expect(JSON.stringify(stored).length).toBeLessThan(2000);
});
