import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';

const PREFIX = '__lease_transfer_v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeaseTransferRecord = {
  id?: string;
  submitter_id?: string | null;
  updated_at?: string | null;
  company?: string;
  new_building?: string;
  area_sqm?: number | null;
};

export type PendingLeaseTransfer = {
  version: 1;
  actorId: string;
  requestId: string;
  submissionId: string;
  targetUserId: string;
  expectedSubmitterId: string | null;
  expectedUpdatedAt: string | null;
  state: 'prepared' | 'unknown';
};

export type LeaseTransferReceipt = {
  success: true;
  requestId: string;
  submissionId: string;
  targetUserId: string;
  targetUserName: string;
  updatedAt: string | null;
  transferredAt: string;
  replayed: boolean;
};

export class LeaseTransferError extends Error {
  constructor(message: string, readonly certainty: 'rejected' | 'unknown' | 'not-sent') {
    super(message);
    this.name = 'LeaseTransferError';
  }
}

const inFlight = new Map<string, Promise<LeaseTransferReceipt>>();
const actorPrefix = (actorId: string) => `${PREFIX}${encodeURIComponent(actorId)}:`;
const keyFor = (pending: PendingLeaseTransfer) => `${actorPrefix(pending.actorId)}${pending.submissionId}:${pending.requestId}`;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function parsePending(raw: string | null, actorId: string): PendingLeaseTransfer {
  let value: Partial<PendingLeaseTransfer>;
  try { value = JSON.parse(raw ?? '') as Partial<PendingLeaseTransfer>; } catch { throw new Error('本地转交确认信息损坏，请联系管理员核对后再操作'); }
  if (!value || value.version !== 1 || value.actorId !== actorId || !UUID.test(value.requestId ?? '')
    || !UUID.test(value.submissionId ?? '') || !UUID.test(value.targetUserId ?? '')
    || !Object.hasOwn(value, 'expectedSubmitterId') || !nullableString(value.expectedSubmitterId)
    || !Object.hasOwn(value, 'expectedUpdatedAt') || !nullableString(value.expectedUpdatedAt)
    || !['prepared', 'unknown'].includes(value.state ?? '')) {
    throw new Error('本地转交确认信息损坏，请联系管理员核对后再操作');
  }
  return value as PendingLeaseTransfer;
}

function savePending(pending: PendingLeaseTransfer, key = keyFor(pending)): void {
  const raw = JSON.stringify(pending);
  try {
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error('pending write not retained');
  } catch {
    throw new LeaseTransferError('无法保存本地转交确认信息，本次未发送请求。请恢复浏览器存储后重试', 'not-sent');
  }
}

/** Every request has its own durable key so simultaneous tabs cannot erase an
 * uncertain request. The server's row-version condition arbitrates races. */
export function getPendingLeaseTransfers(actorId: string): PendingLeaseTransfer[] {
  if (!actorId) return [];
  const items = new Map<string, PendingLeaseTransfer>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(actorPrefix(actorId))) continue;
      const pending = parsePending(localStorage.getItem(key), actorId);
      const base = keyFor(pending);
      const attemptPrefix = `${base}:attempt:`;
      if (key !== base && !(key.startsWith(attemptPrefix) && UUID.test(key.slice(attemptPrefix.length)) && pending.state === 'unknown')) {
        throw new Error('本地转交确认信息与记录不匹配，请联系管理员核对');
      }
      const existing = items.get(base);
      if (existing && JSON.stringify({ ...existing, state: 'prepared' }) !== JSON.stringify({ ...pending, state: 'prepared' })) {
        throw new Error('本地转交确认信息存在冲突，请联系管理员核对');
      }
      if (!existing || pending.state === 'unknown') items.set(base, pending);
    }
  } catch (error) {
    throw new LeaseTransferError(error instanceof Error ? error.message : '无法读取本地转交确认信息', 'not-sent');
  }
  return [...items.values()];
}

export function prepareLeaseTransfer(actorId: string, record: LeaseTransferRecord, targetUserId: string): PendingLeaseTransfer {
  if (!actorId || !UUID.test(record.id ?? '') || !UUID.test(targetUserId)) {
    throw new LeaseTransferError('转交对象信息不完整，请刷新后重试', 'not-sent');
  }
  const existing = getPendingLeaseTransfers(actorId).filter((item) => item.submissionId === record.id);
  if (existing.length > 1) throw new LeaseTransferError('这条记录有多笔待确认转交，请先逐笔确认原操作', 'not-sent');
  if (existing.length === 1) {
    if (existing[0].targetUserId !== targetUserId) throw new LeaseTransferError('原转交结果尚未确认，请先确认原接收人的操作', 'not-sent');
    return existing[0];
  }
  // Missing and explicit null are different: never guess a stale row version.
  if (!Object.hasOwn(record, 'submitter_id') || !nullableString(record.submitter_id)
    || !Object.hasOwn(record, 'updated_at') || !nullableString(record.updated_at)) {
    throw new LeaseTransferError('记录版本信息缺失，请刷新记录后再转交', 'not-sent');
  }
  const pending: PendingLeaseTransfer = {
    version: 1, actorId, requestId: crypto.randomUUID(), submissionId: record.id!, targetUserId,
    expectedSubmitterId: record.submitter_id, expectedUpdatedAt: record.updated_at, state: 'prepared',
  };
  savePending(pending);
  return pending;
}

function forgetPending(pending: PendingLeaseTransfer): void {
  // A receipt confirms the entire request, including concurrent retry attempts.
  try {
    const keys: string[] = [];
    const base = keyFor(pending);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === base || key?.startsWith(`${base}:attempt:`)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* A retained receipt can safely be replayed. */ }
}

export function discardUnsentLeaseTransfer(pending: PendingLeaseTransfer): void {
  const stored = getPendingLeaseTransfers(pending.actorId).find((item) => item.requestId === pending.requestId);
  if (stored?.state === 'prepared' && !inFlight.has(`${pending.actorId}:${pending.requestId}`)) {
    // Do not remove another tab's attempt marker if it starts concurrently.
    try { localStorage.removeItem(keyFor(stored)); } catch { /* Retain on storage failure. */ }
  }
}

function matchesReceipt(value: unknown, pending: PendingLeaseTransfer): value is LeaseTransferReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<LeaseTransferReceipt>;
  return receipt.success === true && receipt.requestId === pending.requestId && receipt.submissionId === pending.submissionId
    && receipt.targetUserId === pending.targetUserId && typeof receipt.targetUserName === 'string' && receipt.targetUserName.trim().length > 0
    && Object.hasOwn(receipt, 'updatedAt') && nullableString(receipt.updatedAt)
    && typeof receipt.transferredAt === 'string' && Number.isFinite(Date.parse(receipt.transferredAt))
    && typeof receipt.replayed === 'boolean';
}

export function submitLeaseTransfer(pending: PendingLeaseTransfer): Promise<LeaseTransferReceipt> {
  const key = `${pending.actorId}:${pending.requestId}`;
  try {
    const stored = getPendingLeaseTransfers(pending.actorId).find((item) => item.requestId === pending.requestId);
    if (!stored || JSON.stringify({ ...stored, state: 'prepared' }) !== JSON.stringify({ ...pending, state: 'prepared' })) {
      return Promise.reject(new LeaseTransferError('转交确认信息已变化，请重新打开待确认操作', 'not-sent'));
    }
  } catch (error) { return Promise.reject(error); }
  const active = inFlight.get(key);
  if (active) return active;
  const request = executeTransfer(pending).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

async function executeTransfer(pending: PendingLeaseTransfer): Promise<LeaseTransferReceipt> {
  const stored = getPendingLeaseTransfers(pending.actorId).find((item) => item.requestId === pending.requestId);
  if (!stored || JSON.stringify({ ...stored, state: 'prepared' }) !== JSON.stringify({ ...pending, state: 'prepared' })) {
    throw new LeaseTransferError('转交确认信息已变化，请重新打开待确认操作', 'not-sent');
  }
  const session = await getSessionFast();
  if (session?.user?.id !== pending.actorId || !session.session?.access_token) {
    throw new LeaseTransferError('登录账号已变化或已失效，请使用原账号确认转交结果', 'not-sent');
  }
  const current = getPendingLeaseTransfers(pending.actorId).find((item) => item.requestId === pending.requestId);
  if (!current) throw new LeaseTransferError('转交确认信息已变化，请重新打开记录', 'not-sent');
  const wasUnknown = current.state === 'unknown';
  const attemptKey = `${keyFor(stored)}:attempt:${crypto.randomUUID()}`;
  // Persist uncertainty BEFORE issuing fetch. Reloading never generates a new ID.
  // Each tab/attempt owns its marker: a rejected attempt cannot erase an
  // overlapping retry whose response may still be lost.
  savePending({ ...stored, state: 'unknown' }, attemptKey);
  let response: Response;
  let body: unknown;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    response = await fetch('/api/admin/transfer-submission', {
      method: 'POST',
      signal: controller.signal,
      headers: withImpersonationHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}` }),
      body: JSON.stringify({ requestId: stored.requestId, submissionId: stored.submissionId, targetUserId: stored.targetUserId,
        expectedSubmitterId: stored.expectedSubmitterId, expectedUpdatedAt: stored.expectedUpdatedAt }),
    });
    body = await response.json().catch(() => null);
  } catch {
    throw new LeaseTransferError('转交结果尚未确认。请重试确认原操作，不要重新转交或更换接收人', 'unknown');
  } finally {
    clearTimeout(timeout);
  }
  const currentSession = await getSessionFast().catch(() => null);
  if (currentSession?.user?.id !== pending.actorId) {
    throw new LeaseTransferError('登录账号已变化，请回到原账号确认这次转交', 'unknown');
  }
  if (response.ok && matchesReceipt(body, stored)) {
    forgetPending(stored);
    return body;
  }
  const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
  if (!response.ok && [400, 401, 403, 404, 409].includes(response.status) && !wasUnknown) {
    try { localStorage.removeItem(attemptKey); localStorage.removeItem(keyFor(stored)); } catch { /* Retain on storage failure. */ }
    if (!getPendingLeaseTransfers(pending.actorId).some((item) => item.requestId === pending.requestId)) {
      throw new LeaseTransferError(message || '转交未完成，请刷新记录后重试', 'rejected');
    }
  }
  throw new LeaseTransferError(`${message ? `${message}。` : ''}原转交结果尚未确认，请重试确认原操作；若持续被拒绝，请联系管理员核对`, 'unknown');
}
