/**
 * 客户端审计事件队列。
 *
 * 业务操作永远不等待审计网络请求：事件先异步写入浏览器 IndexedDB，
 * 每 3 秒（或累计 20 条）批量发送。离线/临时失败的事件会保留到下次
 * 打开系统后继续发送，服务端以 event_id 去重。
 *
 * LOGIN / LOGIN_FAILED / LOGOUT 已由 Supabase Auth Audit Logs 作为权威来源，
 * 客户端兼容调用不会再生成重复的应用审计事件。
 */
import { supabase } from '../services/supabaseClient';
import { getOrCreateDeviceId } from '../services/deviceIdentity';
import { getSessionIdFromAccessToken } from './authSession';
import { AUDIT_ORIGIN_SCHEMA_VERSION, isAuditOriginCurrent } from './auditOrigin';

const DB_NAME = 'colliers-audit-outbox-v1';
const STORE_NAME = 'events';
const BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 3000;
const MAX_BACKOFF_MS = 60_000;
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

interface AuditSessionContext {
  userId: string;
  authSessionId: string;
  deviceId: string | null;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;
let failureCount = 0;
let initialized = false;
let currentAuditContext: AuditSessionContext | null = null;

function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function isAuthorityOwnedAuthAction(actionType: string): boolean {
  return AUTHORITY_OWNED_AUTH_ACTIONS.has(actionType.trim().toUpperCase());
}

export function setAuditSessionContext(params: { userId: string; accessToken?: string | null; authSessionId?: string | null }): void {
  if (!params.userId) {
    currentAuditContext = null;
    return;
  }
  const authSessionId = params.authSessionId ?? getSessionIdFromAccessToken(params.accessToken);
  if (!authSessionId) {
    currentAuditContext = null;
    return;
  }
  currentAuditContext = {
    userId: params.userId,
    authSessionId,
    deviceId: getOrCreateDeviceId(),
  };
}

export function clearAuditSessionContext(): void {
  currentAuditContext = null;
}

export async function refreshAuditSessionContext(expectedUserId?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id || !session.access_token || (expectedUserId && session.user.id !== expectedUserId)) {
    clearAuditSessionContext();
    return;
  }
  setAuditSessionContext({ userId: session.user.id, accessToken: session.access_token });
}

export async function ensureAuditSessionContext(userId: string): Promise<void> {
  await refreshAuditSessionContext(userId);
}

function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'event_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function saveEvent(event: AuditEvent): Promise<void> {
  const db = await getDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getBatch(): Promise<AuditEvent[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll(null, BATCH_SIZE);
    request.onsuccess = () => resolve(request.result as AuditEvent[]);
    request.onerror = () => reject(request.error);
  });
}

async function removeEvents(eventIds: string[]): Promise<void> {
  if (!eventIds.length) return;
  const db = await getDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    eventIds.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (typeof window === 'undefined' || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAuditLogs();
  }, delay);
}

function queueFlushAfterFailure(): void {
  failureCount += 1;
  scheduleFlush(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failureCount, 6)));
}

function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAuditLogs();
  });
  window.addEventListener('online', () => void flushAuditLogs());
  void flushAuditLogs();
}

async function enqueueAuditEvent(
  event: Omit<AuditEvent, 'event_id' | 'occurred_at' | 'client_device_id' | 'origin_schema_version' | 'origin_user_id' | 'origin_auth_session_id'>,
  occurredAt: string,
): Promise<void> {
  let context = currentAuditContext;
  if (!context) {
    await refreshAuditSessionContext().catch(() => {});
    context = currentAuditContext;
  }
  if (!context) return;

  const queuedEvent: AuditEvent = {
    ...event,
    event_id: createEventId(),
    occurred_at: occurredAt,
    client_device_id: context.deviceId || undefined,
    origin_schema_version: AUDIT_ORIGIN_SCHEMA_VERSION,
    origin_user_id: context.userId,
    origin_auth_session_id: context.authSessionId,
  };
  await saveEvent(queuedEvent);
  scheduleFlush();
}

/** 以不阻塞当前操作的方式写入队列。 */
export function logAuditEvent(
  event: Omit<AuditEvent, 'event_id' | 'occurred_at' | 'client_device_id' | 'origin_schema_version' | 'origin_user_id' | 'origin_auth_session_id'> & Partial<Pick<AuditEvent, 'occurred_at'>>,
): void {
  if (typeof window === 'undefined') return;
  try { if (sessionStorage.getItem('__impersonation_state')) return; } catch { /* continue */ }

  ensureInit();
  const occurredAt = event.occurred_at || new Date().toISOString();
  const { occurred_at: _occurredAt, ...payload } = event;
  void enqueueAuditEvent(payload, occurredAt).catch(() => { /* audit must never block business */ });
}

/** 将待发事件提交到服务端。仅供生命周期事件或测试使用；业务代码不要 await 它。 */
export async function flushAuditLogs(): Promise<void> {
  if (typeof window === 'undefined' || isFlushing) return;
  isFlushing = true;
  try {
    const events = await getBatch();
    if (!events.length) { failureCount = 0; return; }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session.user?.id) { queueFlushAfterFailure(); return; }
    const authSessionId = getSessionIdFromAccessToken(session.access_token);
    if (!authSessionId) { queueFlushAfterFailure(); return; }
    setAuditSessionContext({ userId: session.user.id, authSessionId });

    // Drop legacy or cross-session events locally before they ever reach the API.
    // The server repeats this check as the authoritative boundary.
    const currentEvents = events.filter(event => isAuditOriginCurrent(event, session.user.id, authSessionId));
    const staleIds = events
      .filter(event => !isAuditOriginCurrent(event, session.user.id, authSessionId))
      .map(event => event.event_id);
    await removeEvents(staleIds);

    if (!currentEvents.length) {
      failureCount = 0;
      if (events.length === BATCH_SIZE) scheduleFlush(0);
      return;
    }

    const response = await fetch('/api/audit-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ events: currentEvents }),
      keepalive: currentEvents.length <= BATCH_SIZE,
    });
    if (!response.ok) { queueFlushAfterFailure(); return; }

    const result = await response.json().catch(() => ({}));
    const acceptedIds = Array.isArray(result.accepted_event_ids)
      ? result.accepted_event_ids.filter((id: unknown): id is string => typeof id === 'string')
      : currentEvents.map(event => event.event_id);
    const discardedIds = Array.isArray(result.discarded_event_ids)
      ? result.discarded_event_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    await removeEvents(Array.from(new Set([...acceptedIds, ...discardedIds])));
    failureCount = 0;
    if (events.length === BATCH_SIZE) scheduleFlush(0);
  } catch {
    queueFlushAfterFailure();
  } finally {
    isFlushing = false;
  }
}

/** 兼容已有调用；身份由服务端 JWT 决定，userId 不再直接写入数据库。 */
export function logAction(_userId: string | undefined, actionType: string, details: Record<string, unknown> = {}): void {
  // Authentication lifecycle is authoritative in Supabase Auth Audit Logs.
  // Keep old call sites harmless so duplicate LOGIN/LOGOUT rows cannot return.
  if (isAuthorityOwnedAuthAction(actionType)) {
    if (actionType.trim().toUpperCase() === 'LOGIN') {
      void refreshAuditSessionContext().catch(() => {});
    }
    return;
  }

  logAuditEvent({
    action_type: actionType,
    details,
    request_source: 'frontend',
    page_url: typeof window === 'undefined' ? undefined : window.location.pathname,
    module: typeof window === 'undefined' ? undefined : window.location.pathname.split('/')[1] || 'home',
    user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent.slice(0, 500),
  });
}

/** 兼容旧接口：关键事件只提前安排发送，仍不阻塞用户操作。 */
export async function logActionImmediate(userId: string | undefined, actionType: string, details: Record<string, unknown> = {}): Promise<void> {
  logAction(userId, actionType, details);
  // Even when the auth action itself is Supabase-owned, use this lifecycle hint
  // to opportunistically drain valid business audit events before navigation.
  scheduleFlush(0);
}
