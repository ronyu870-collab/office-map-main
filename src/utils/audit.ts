/** Client events are supplementary observations; critical evidence lives in trusted transactions. */
import { supabase } from '../services/supabaseClient';
import { getOrCreateDeviceId } from '../services/deviceIdentity';
import { getSessionIdFromAccessToken } from './authSession';
import { AUDIT_ORIGIN_SCHEMA_VERSION, isAuditOriginCurrent } from './auditOrigin';
import { auditPolicyGate } from './auditPolicy';
import { auditDefinition, AUDIT_SCHEMA_VERSION } from './auditRegistry';
import { sanitizeAuditPayload, sanitizeAuditDetails } from './auditSanitizer';
import { subscribeSupabaseMutations, setSupabaseMutationOrigin, type SupabaseMutationNotice } from './auditMutationBridge';
const DB_NAME = 'colliers-audit-outbox-v1';
const STORE_NAME = 'events';
const BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 3000;
const MAX_BACKOFF_MS = 60_000;
const MAX_OUTBOX_EVENTS = 1500;
const MAX_BUFFER_EVENTS = 200;
const MAX_BATCH_BYTES = 30 * 1024;
const AUTHORITY_OWNED_AUTH_ACTIONS = new Set(['LOGIN', 'LOGIN_FAILED', 'LOGOUT']);
export interface AuditEvent {
  event_id: string;
  action_type: string;
  details: Record<string, unknown>;
  request_source?: 'frontend';
  module?: string;
  page_url?: string;
  target_table?: string;
  target_id?: string;
  target_name?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  duration_ms?: number;
  error_message?: string;
  user_agent?: string;
  occurred_at: string;
  client_device_id?: string;
  origin_schema_version: number;
  origin_user_id: string;
  origin_auth_session_id: string;
}

interface AuditSessionContext { userId: string; authSessionId: string; deviceId: string | null }
let databasePromise: Promise<IDBDatabase> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let isFlushing = false;
let failureCount = 0;
let initialized = false;
let contextRevision = 0;
let currentAuditContext: AuditSessionContext | null = null;
const pending: AuditEvent[] = [];
const health = { stored: 0, acknowledged: 0, discarded: 0, stale: 0, storageFailures: 0, retries: 0, pressureDrops: 0, criticalSupplementDrops: 0, missingOrigin: 0 };
/** Local diagnostic snapshot, read only on demand by authorized admin UI. Never polled on normal routes. */
export function getAuditQueueHealth() { return { ...health, buffered: pending.length, failureCount, isFlushing }; }
function createEventId(): string { return crypto.randomUUID(); }
function isAuthorityOwnedAuthAction(action: string) { return AUTHORITY_OWNED_AUTH_ACTIONS.has(action.trim().toUpperCase()); }
export function setAuditSessionContext(params: { userId: string; accessToken?: string | null; authSessionId?: string | null }): void {
  const authSessionId = params.authSessionId ?? getSessionIdFromAccessToken(params.accessToken);
  if (!params.userId || !authSessionId) { clearAuditSessionContext(); return; }
  if (currentAuditContext?.userId === params.userId && currentAuditContext.authSessionId === authSessionId) return;
  contextRevision += 1;
  auditPolicyGate.reset();
  currentAuditContext = { userId: params.userId, authSessionId, deviceId: getOrCreateDeviceId() };
  setSupabaseMutationOrigin({userId:params.userId,authSessionId});
}
export function clearAuditSessionContext(): void {
  contextRevision += 1;
  currentAuditContext = null;
  setSupabaseMutationOrigin(null);
  auditPolicyGate.reset();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
export async function refreshAuditSessionContext(expectedUserId?: string): Promise<void> {
  const revision = contextRevision;
  const { data: { session } } = await supabase.auth.getSession();
  if (revision !== contextRevision) return;
  if (!session?.user?.id || !session.access_token || (expectedUserId && session.user.id !== expectedUserId)) {
    clearAuditSessionContext(); return;
  }
  setAuditSessionContext({ userId: session.user.id, accessToken: session.access_token });
  // Recover persisted events after reload without an eager initialization read.
  ensureInit(); scheduleFlush();
}
export async function ensureAuditSessionContext(userId: string): Promise<void> {
  if (currentAuditContext?.userId !== userId) await refreshAuditSessionContext(userId);
}
function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'event_id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('AUDIT_STORAGE_BLOCKED'));
  }).catch(error => { databasePromise = null; throw error; });
  return databasePromise;
}
/** One capacity read and one atomic transaction for a burst, including concurrent tabs. A observations are never capacity-dropped. */
async function savePending(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (saving) { await saving; return; }
  if (!pending.length) return;
  const events = pending.splice(0, MAX_BUFFER_EVENTS);
  saving = (async () => {
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const count = store.count();
        let written = 0; let dropped = 0;
        count.onsuccess = () => {
          let size = count.result;
          for (const event of events) {
            if (size >= MAX_OUTBOX_EVENTS && auditDefinition(event.action_type).tier !== 'A') { dropped++; continue; }
            store.put(event); size++; written++;
          }
        };
        tx.oncomplete = () => { health.stored += written; health.pressureDrops += dropped; resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      scheduleFlush();
    } catch {
      health.storageFailures++;
      // Retain a bounded buffer on unavailable IndexedDB; critical authoritative logs never depend on this buffer.
      const retained=[...events,...pending].sort((a,b)=>Number(auditDefinition(b.action_type).tier==='A')-Number(auditDefinition(a.action_type).tier==='A'));
      const dropped=retained.slice(MAX_BUFFER_EVENTS);
      health.criticalSupplementDrops+=dropped.filter(event=>auditDefinition(event.action_type).tier==='A').length;
      health.pressureDrops+=dropped.length;
      pending.splice(0,pending.length,...retained.slice(0,MAX_BUFFER_EVENTS));
      queueFlushAfterFailure();
    }
  })();
  await saving; saving = null;
}
async function getBatch(): Promise<AuditEvent[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll(null, BATCH_SIZE);
    request.onsuccess = () => resolve(request.result as AuditEvent[]);
    request.onerror = () => reject(request.error);
  });
}
async function removeEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const id of ids) tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (typeof window === 'undefined' || flushTimer || !currentAuditContext) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flushAuditLogs(); }, delay);
}
function queueFlushAfterFailure(): void {
  failureCount++; health.retries++;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  scheduleFlush(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failureCount, 6)) * (0.75 + Math.random() * 0.25));
}
function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAuditLogs(); });
  window.addEventListener('online', () => { if (!flushTimer) scheduleFlush(0); });
}
type AuditInput = Omit<AuditEvent, 'event_id' | 'occurred_at' | 'client_device_id' | 'origin_schema_version' | 'origin_user_id' | 'origin_auth_session_id'> & Partial<Pick<AuditEvent, 'occurred_at'>>;
/** Snapshot origin synchronously. Never discover an identity after the event happened. */
export function logAuditEvent(event: AuditInput): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem('__impersonation_state')) return;
    const actionType = event.action_type.trim().toUpperCase();
    if (isAuthorityOwnedAuthAction(actionType)) return;
    if (!auditPolicyGate.shouldRecord(actionType, event.details || {})) return;
    const context = currentAuditContext;
    if (!context) { health.missingOrigin++; return; }
    if (pending.length >= MAX_BUFFER_EVENTS) {
      const expendable=auditDefinition(actionType).tier==='A'?pending.findIndex(item=>auditDefinition(item.action_type).tier!=='A'):-1;
      health.pressureDrops++;
      if(expendable<0){if(auditDefinition(actionType).tier==='A')health.criticalSupplementDrops++;return;}
      pending.splice(expendable,1);
    }
    ensureInit();
    pending.push({ ...event,details:snapshotAuditValue(event.details),old_values:event.old_values?snapshotAuditValue(event.old_values):undefined,new_values:event.new_values?snapshotAuditValue(event.new_values):undefined, action_type: actionType, event_id: createEventId(), occurred_at: event.occurred_at || new Date().toISOString(),
      client_device_id: context.deviceId || undefined, origin_schema_version: AUDIT_ORIGIN_SCHEMA_VERSION,
      origin_user_id: context.userId, origin_auth_session_id: context.authSessionId });
    if (!saveTimer) saveTimer = setTimeout(() => { void savePending(); }, 20);
  } catch { health.storageFailures++; /* supplementary audit cannot fail a business call */ }
}
/** Bound and detach caller-owned objects before buffering; no large JSON serialization on interaction. */
function snapshotAuditValue(value: Record<string, unknown>): Record<string, unknown> {
  let remaining=4000;
  const visit=(input:unknown,depth:number):unknown=>{
    if(remaining<=0||depth>4)return '[TRUNCATED]';
    if(typeof input==='string'){const clipped=input.slice(0,Math.min(500,remaining));remaining-=clipped.length;return clipped;}
    if(Array.isArray(input))return input.slice(0,16).map(child=>visit(child,depth+1));
    if(input&&typeof input==='object'){
      const result:Record<string,unknown>={};let count=0;
      for(const key in input){if(!Object.prototype.hasOwnProperty.call(input,key))continue;if(++count>32||remaining<=0)break;remaining-=key.length+8;result[key.slice(0,100)]=visit((input as Record<string,unknown>)[key],depth+1);}
      return result;
    }
    remaining-=8;return typeof input==='number'&&!Number.isFinite(input)?null:input;
  };
  return (visit(value,0)||{}) as Record<string,unknown>;
}
function boundedEvent(event: AuditEvent): AuditEvent {
  const bounded = (value: unknown): Record<string, unknown> => {
    const sanitized = sanitizeAuditPayload(value) as Record<string, unknown>;
    return JSON.stringify(sanitized || {}).length > 2000 ? { _truncated: true } : sanitized;
  };
  return { ...event,action_type:event.action_type.slice(0,100),module:event.module?.slice(0,100),target_table:event.target_table?.slice(0,100),error_message:event.error_message?.slice(0,1000),client_device_id:event.client_device_id?.slice(0,100), target_name:event.target_name?.slice(0,500),target_id:event.target_id?.slice(0,200),page_url:event.page_url?.slice(0,500),user_agent:undefined, details: { ...sanitizeAuditDetails(event.action_type,bounded(event.details),event.module), _schema_version: AUDIT_SCHEMA_VERSION, _evidence: 'client_reported' },
    old_values: bounded(event.old_values), new_values: bounded(event.new_values) };
}
/** Lifecycle only. HTTP success is insufficient; remove only explicit, in-batch acknowledgements. */
export async function flushAuditLogs(): Promise<void> {
  if (typeof window === 'undefined' || isFlushing || !currentAuditContext) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  isFlushing = true;
  try {
    await savePending();
    const events = await getBatch();
    if (!events.length) { failureCount = 0; return; }
    const revision = contextRevision;
    const { data: { session } } = await supabase.auth.getSession();
    if (revision !== contextRevision) { scheduleFlush(); return; }
    if (!session?.access_token || !session.user?.id) { queueFlushAfterFailure(); return; }
    const sessionId = getSessionIdFromAccessToken(session.access_token);
    if (!sessionId) { queueFlushAfterFailure(); return; }
    const current = events.filter(event => isAuditOriginCurrent(event, session.user.id, sessionId));
    const stale = events.filter(event => !isAuditOriginCurrent(event, session.user.id, sessionId));
    await removeEvents(stale.map(event => event.event_id)); health.stale += stale.length;
    const batch: AuditEvent[] = [];
    for (const event of current) {
      const next = boundedEvent(event);
      if (new TextEncoder().encode(JSON.stringify({ events: [...batch, next] })).byteLength > MAX_BATCH_BYTES) break;
      batch.push(next);
    }
    if (!batch.length) { if (events.length === BATCH_SIZE) scheduleFlush(0); return; }
    const response = await fetch('/api/audit-events', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ events: batch }), keepalive: true, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { queueFlushAfterFailure(); return; }
    const result = await response.json();
    const submitted = new Set(batch.map(event => event.event_id));
    const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && submitted.has(id)) : [];
    const accepted = ids(result.accepted_event_ids); const discarded = ids(result.discarded_event_ids);
    const removed = [...new Set([...accepted, ...discarded])];
    if (!removed.length) { queueFlushAfterFailure(); return; }
    await removeEvents(removed); health.acknowledged += accepted.length; health.discarded += discarded.length;
    failureCount = 0;
    if (removed.length < batch.length) queueFlushAfterFailure();
    else if (events.length === BATCH_SIZE || batch.length < current.length || pending.length) scheduleFlush(0);
  } catch { queueFlushAfterFailure(); }
  finally { isFlushing = false; }
}
function handleAutomaticMutation(notice: SupabaseMutationNotice): void {
  // This is an observation, never database proof. No time-window de-duplication of distinct requests.
  if ('origin' in notice && (!notice.origin || notice.origin.userId!==currentAuditContext?.userId || notice.origin.authSessionId!==currentAuditContext.authSessionId)) return;
  const page = window.location.pathname;
  logAuditEvent({ action_type: 'CLIENT_MUTATION_OBSERVED', details: { table: notice.target, operation: notice.operation,
    http_status: notice.status, coverage: 'automatic_fallback', outcome: 'observed' }, request_source: 'frontend',
    module: page.split('/')[1] || 'home', page_url: page, target_table: notice.kind === 'table' ? notice.target : undefined,
    target_name: notice.kind === 'rpc' ? notice.target : undefined, occurred_at: notice.occurredAt });
}
if (typeof window !== 'undefined') subscribeSupabaseMutations(handleAutomaticMutation);
/** 兼容已有调用；身份由服务端 JWT 决定，userId 不再直接写入数据库。 */
export function logAction(_userId: string | undefined, actionType: string, details: Record<string, unknown> = {}): void {
  if (isAuthorityOwnedAuthAction(actionType)) {
    if (actionType.trim().toUpperCase() === 'LOGIN') void refreshAuditSessionContext().catch(() => {});
    return;
  }

  const detailText = (...keys: string[]) => {
    for (const key of keys) {
      const value = details[key];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return undefined;
  };
  const page = typeof window === 'undefined' ? undefined : window.location.pathname;

  logAuditEvent({
    action_type: actionType,
    details,
    request_source: 'frontend',
    page_url: page,
    module: detailText('module') || (page ? page.split('/')[1] || 'home' : undefined),
    user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent.slice(0, 500),
    target_table: detailText('target_table', 'targetTable', 'table'),
    target_id: detailText('target_id', 'targetId', 'record_id', 'recordId', 'issue_id', 'building_id', 'buildingId'),
    target_name: detailText('target_name', 'targetName', 'file_name', 'fileName', 'filename', 'report_name', 'reportName', 'table_label', 'building_name', 'buildingName', 'company'),
  });
}

/** 兼容接口仅安排辅助观察发送；A 类可靠性由可信事务／服务端负责。 */
export async function logActionImmediate(userId: string | undefined, actionType: string, details: Record<string, unknown> = {}): Promise<void> {
  logAction(userId, actionType, details);
  scheduleFlush(0);
}
