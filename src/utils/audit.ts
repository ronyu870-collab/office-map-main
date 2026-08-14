/**
 * 客户端审计事件队列。
 *
 * 业务操作永远不等待审计网络请求：事件先异步写入浏览器 IndexedDB，
 * 每 3 秒（或累计 20 条）批量发送。离线/临时失败的事件会保留到下次
 * 打开系统后继续发送，服务端以 event_id 去重。
 */
import { supabase } from '../services/supabaseClient';

const DB_NAME = 'colliers-audit-outbox-v1';
const STORE_NAME = 'events';
const BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 3000;
const MAX_BACKOFF_MS = 60_000;

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
}

let databasePromise: Promise<IDBDatabase> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;
let failureCount = 0;
let initialized = false;

function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'event_id' });
      }
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
    eventIds.forEach((id) => store.delete(id));
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

  // 不在 beforeunload 直接发送：该路径无法安全携带认证信息；
  // IndexedDB 中的事件会在下次进入系统时自动补发。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAuditLogs();
  });
  window.addEventListener('online', () => void flushAuditLogs());
  void flushAuditLogs();
}

/** 以不阻塞当前操作的方式写入队列。 */
export function logAuditEvent(event: Omit<AuditEvent, 'event_id'>): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem('__impersonation_state')) return;
  } catch {
    // sessionStorage 不可用时继续记录
  }

  ensureInit();
  const queuedEvent: AuditEvent = { ...event, event_id: createEventId() };
  void saveEvent(queuedEvent)
    .then(() => scheduleFlush())
    .catch(() => {
      // 审计不得影响业务操作；浏览器禁用 IndexedDB 时仅放弃本条前端行为日志。
    });
}

/**
 * 将待发事件提交到服务端。仅供生命周期事件或测试使用；业务代码不要 await 它。
 */
export async function flushAuditLogs(): Promise<void> {
  if (typeof window === 'undefined' || isFlushing) return;
  isFlushing = true;
  try {
    const events = await getBatch();
    if (!events.length) {
      failureCount = 0;
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      queueFlushAfterFailure();
      return;
    }

    const response = await fetch('/api/audit-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ events }),
      keepalive: events.length <= BATCH_SIZE,
    });

    if (!response.ok) {
      queueFlushAfterFailure();
      return;
    }

    const result = await response.json().catch(() => ({}));
    const acceptedIds = Array.isArray(result.accepted_event_ids)
      ? result.accepted_event_ids.filter((id: unknown): id is string => typeof id === 'string')
      : events.map((event) => event.event_id);
    await removeEvents(acceptedIds);
    failureCount = 0;

    // 一次只处理一个小批次，避免页面隐藏时长时间占用网络。
    if (events.length === BATCH_SIZE) scheduleFlush(0);
  } catch {
    queueFlushAfterFailure();
  } finally {
    isFlushing = false;
  }
}

/** 兼容已有调用；身份由服务端 JWT 决定，userId 不再写入数据库。 */
export function logAction(
  _userId: string | undefined,
  actionType: string,
  details: Record<string, unknown> = {},
): void {
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
export async function logActionImmediate(
  userId: string | undefined,
  actionType: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  logAction(userId, actionType, details);
  scheduleFlush(0);
}
