import type { QuarterlyDraftRow } from './quarterlyDataEntry';

export interface DraftIdentity { userId: string; year: number; quarter: number; tab: string }
export interface DraftPayload { regular: Record<string, QuarterlyDraftRow>; future: Record<string, QuarterlyDraftRow> }
export interface RemoteDraft { payload: DraftPayload; revision: number; updatedAt: string; year: number; quarter: number; periodConfirmed?: boolean }
export interface DraftTransport {
  read: () => Promise<RemoteDraft | null>;
  save: (payload: DraftPayload, expectedRevision: number) => Promise<{ revision: number; updatedAt: string }>;
}
export interface DraftSnapshot {
  payload: DraftPayload;
  revision: number;
  dirty: boolean;
  loaded: boolean;
  saving: boolean;
  conflict: RemoteDraft | null;
  remoteMissing: boolean;
  historical: RemoteDraft | null;
  error: string | null;
  localError: string | null;
  updatedAt: string | null;
  retryCount: number;
  quarantined?: { raw: unknown };
}
interface CachedDraft {
  version: 1;
  identity: DraftIdentity;
  payload: DraftPayload;
  revision: number;
  dirty: boolean;
  updatedAt: string | null;
  cachedAt: number;
}
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
const EMPTY = (): DraftPayload => ({ regular: {}, future: {} });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const payloadEqual = (a: DraftPayload, b: DraftPayload) => JSON.stringify(a) === JSON.stringify(b);
export const draftCacheKey = (id: DraftIdentity) => `quarterly-draft:v1:${encodeURIComponent(id.userId)}:${id.year}:Q${id.quarter}:${id.tab}`;

export function hasConfirmedDraftPeriod(value: unknown, revision: number, year: number, quarter: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const meta = (value as Record<string, unknown>).__quarterly_meta__;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const marker = meta as Record<string, unknown>;
  return marker.version === 2 && marker.year === year && marker.quarter === quarter && marker.revision === revision;
}

export function isCurrentDraft(remote: RemoteDraft, identity: DraftIdentity): boolean {
  // Legacy period labels/timestamps cannot establish what the broker confirmed.
  // Only the v2 server marker tied to this exact period AND revision can do so.
  return remote.year === identity.year && remote.quarter === identity.quarter
    && remote.periodConfirmed === true && Number.isFinite(Date.parse(remote.updatedAt));
}

export class InvalidDraftPayloadError extends Error {
  constructor(readonly raw: unknown) { super('invalid_draft_payload'); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validRows(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((row) => isRecord(row)
    && Object.values(row).every((field) => field == null || typeof field === 'string'
      || (typeof field === 'number' && Number.isFinite(field))));
}
export function unpackDraft(value: unknown): DraftPayload {
  if (value == null) return EMPTY();
  if (!isRecord(value)) throw new InvalidDraftPayloadError(value);
  const { __futureSupply__ } = value;
  const regular = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '__futureSupply__' && key !== '__quarterly_meta__'));
  // Legacy null future maps represent no future entries; row values never do.
  const future = __futureSupply__ == null ? {} : __futureSupply__;
  if (!validRows(regular) || !validRows(future)) throw new InvalidDraftPayloadError(value);
  return { regular: regular as DraftPayload['regular'], future: future as DraftPayload['future'] };
}
export const packDraft = (payload: DraftPayload) => ({ ...payload.regular, __futureSupply__: payload.future });

/** One controller per account/quarter/category. No auth tokens are persisted. */
export class QuarterlyDraftStore {
  private snapshot: DraftSnapshot = { payload: EMPTY(), revision: 0, dirty: false, loaded: false, saving: false, conflict: null, remoteMissing: false, historical: null, error: null, localError: null, updatedAt: null, retryCount: 0 };
  private listeners = new Set<() => void>();
  private editVersion = 0;
  private loading: Promise<void> | null = null;
  private inFlight: Promise<boolean> | null = null;
  private generation = 0;
  private storage: DraftStorage | null;
  private lastPersisted: string | null = null;
  readonly key: string;

  constructor(readonly identity: DraftIdentity, private transport: DraftTransport, storage: DraftStorage | null) {
    this.key = draftCacheKey(identity);
    this.storage = storage;
    if (!storage) this.snapshot.localError = '本机恢复存储不可用，请勿关闭页面，先保存云端草稿。';
    try {
      const raw = storage?.getItem(this.key);
      this.lastPersisted = raw ?? null;
      if (raw) {
        const cached = JSON.parse(raw) as CachedDraft;
        if (cached.version !== 1 || draftCacheKey(cached.identity) !== this.key || !validRows(cached.payload?.regular) || !validRows(cached.payload?.future) || !Number.isSafeInteger(cached.revision)) throw new Error('invalid_cache');
        // Only acknowledged copies expire. Unsynced work never expires silently.
        if (!cached.dirty && Date.now() - cached.cachedAt > 30 * 86400_000) storage?.removeItem(this.key);
        else this.snapshot = { ...this.snapshot, payload: cached.payload, revision: cached.revision, dirty: cached.dirty, updatedAt: cached.updatedAt };
      }
    } catch {
      this.snapshot.localError = '本机恢复副本读取失败；原始副本未删除，请先导出或检查浏览器存储。';
      this.storage = null;
    }
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<DraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private quarantine(error: unknown): boolean {
    if (!(error instanceof InvalidDraftPayloadError)) return false;
    this.publish({ loaded: false, saving: false, quarantined: { raw: error.raw }, error: '云端草稿格式异常，原始内容已隔离保留；请导出并联系管理员，修复后重试读取。' });
    return true;
  }
  private persist() {
    if (!this.storage) return;
    const cached: CachedDraft = { version: 1, identity: this.identity, payload: this.snapshot.payload, revision: this.snapshot.revision, dirty: this.snapshot.dirty, updatedAt: this.snapshot.updatedAt, cachedAt: Date.now() };
    try {
      const previous = this.storage.getItem(this.key);
      // Another browser tab may have unsynced work under the same identity.
      // Archive it before replacing the shared recovery pointer.
      if (previous && previous !== this.lastPersisted && !this.preserveVersion('other-window', JSON.parse(previous))) return;
      const serialized = JSON.stringify(cached);
      this.storage.setItem(this.key, serialized);
      this.lastPersisted = serialized;
      if (this.snapshot.localError?.startsWith('本机恢复副本保存失败')) this.publish({ localError: null });
    } catch {
      this.publish({ localError: '本机恢复副本保存失败（空间不足或隐私限制）。修改仍在本页，请先保存云端或导出。' });
    }
  }
  private preserveVersion(label: string, value: unknown): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(`${this.key}:recovery:${Date.now()}:${label}:${crypto.randomUUID()}`, JSON.stringify({ identity: this.identity, savedAt: new Date().toISOString(), value }));
      return true;
    } catch {
      this.publish({ localError: '恢复版本保存失败；请先导出本地修改，再处理冲突。' });
      return false;
    }
  }
  edit(kind: 'regular' | 'future', id: string, field: string, value: string, legacyId?: string) {
    if (this.snapshot.quarantined) return;
    const rows = this.snapshot.payload[kind];
    const nextRows = { ...rows, [id]: { ...(legacyId ? rows[legacyId] : {}), ...rows[id], [field]: value } };
    if (legacyId && legacyId !== id) delete nextRows[legacyId];
    this.editVersion++;
    this.publish({ payload: { ...this.snapshot.payload, [kind]: nextRows }, dirty: true });
    // Synchronous persistence at the edit boundary also covers immediate reload.
    this.persist();
  }
  replaceFromFormal(payload: DraftPayload) {
    if (this.snapshot.quarantined) return false;
    if (!this.preserveVersion('before-formal-restore', this.snapshot.payload)) return false;
    this.editVersion++;
    this.publish({ payload: copy(payload), dirty: true });
    this.persist();
    return true;
  }
  load = (): Promise<void> => {
    if (this.loading) return this.loading;
    const startedAtVersion = this.editVersion;
    const generation = ++this.generation;
    this.loading = (async () => {
      try {
        const remote = await this.transport.read();
        if (generation !== this.generation) return;
        if (remote && (!Number.isSafeInteger(remote.revision) || remote.revision < 0 || !Number.isFinite(Date.parse(remote.updatedAt)))) throw new Error('invalid_remote_revision');
        this.publish({ quarantined: undefined });
        const edited = this.snapshot.dirty || this.editVersion !== startedAtVersion;
        if (remote && !isCurrentDraft(remote, this.identity)) {
          const referenceKey = `${this.key}:reference:${remote.year}:Q${remote.quarter}:r${remote.revision}`;
          try {
            if (this.storage && !this.storage.getItem(referenceKey)) this.storage.setItem(referenceKey, JSON.stringify({ identity: this.identity, savedAt: new Date().toISOString(), value: remote }));
          } catch { this.publish({ localError: '原有草稿的本机参考副本保存失败；服务器版本仍会保留，请及时导出。' }); }
          this.publish({ historical: remote });
          // This revision still guards the server's rolling owner/category row.
          if (edited && this.snapshot.revision !== remote.revision) {
            this.publish({ loaded: true, conflict: remote, remoteMissing: remote === null, error: '云端草稿版本已变化；本地修改已保留，请核对后选择版本。' });
            return;
          }
          this.publish({ payload: edited ? this.snapshot.payload : EMPTY(), revision: remote.revision, loaded: true, error: null });
        } else if (edited) {
          if (remote && payloadEqual(remote.payload, this.snapshot.payload)) {
            this.publish({ revision: remote.revision, dirty: false, loaded: true, conflict: null, remoteMissing: false, error: null, updatedAt: remote.updatedAt });
          } else if ((remote?.revision ?? 0) !== this.snapshot.revision) {
            this.publish({ loaded: true, conflict: remote, remoteMissing: remote === null, error: '云端草稿版本已变化；本地修改已保留，请核对后选择版本。' });
          } else this.publish({ loaded: true, error: null });
        } else {
          this.publish({ payload: remote?.payload ?? EMPTY(), revision: remote?.revision ?? 0, loaded: true, conflict: null, remoteMissing: false, error: null, updatedAt: remote?.updatedAt ?? null });
        }
        this.persist();
      } catch (error) {
        if (generation !== this.generation) return;
        if (this.quarantine(error)) return;
        this.publish({ error: '云端草稿读取失败；已保留本页及本机副本，重试读取后才能同步。', retryCount: this.snapshot.retryCount + 1 });
      } finally { if (generation === this.generation) this.loading = null; }
    })();
    return this.loading;
  };
  cancelLoad(): void {
    if (!this.loading) return;
    this.generation += 1;
    this.loading = null;
  }
  flush = (): Promise<boolean> => {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => { this.inFlight = null; });
    return this.inFlight;
  };
  private async drain(): Promise<boolean> {
    if (this.snapshot.quarantined) return false;
    if (!this.snapshot.loaded) await this.load();
    if (this.snapshot.quarantined || !this.snapshot.loaded || this.snapshot.conflict || this.snapshot.remoteMissing || (this.snapshot.error && !this.snapshot.dirty)) return false;
    while (this.snapshot.dirty) {
      // A concurrent explicit read may quarantine a malformed remote while a save awaits its receipt.
      if (this.snapshot.quarantined) return false;
      const version = this.editVersion;
      const payload = copy(this.snapshot.payload);
      const expectedRevision = this.snapshot.revision;
      this.publish({ saving: true, error: null });
      try {
        const ack = await this.transport.save(payload, expectedRevision);
        if (!Number.isSafeInteger(ack.revision) || ack.revision !== expectedRevision + 1 || !Number.isFinite(Date.parse(ack.updatedAt))) throw new Error('invalid_draft_ack');
        this.publish({ revision: ack.revision, updatedAt: ack.updatedAt, dirty: this.editVersion !== version, retryCount: 0 });
        this.persist();
      } catch (error) {
        // A response may have been lost after commit. Read back before any retry;
        // never replace another writer's payload using a guessed revision.
        try {
          const remote = await this.transport.read();
          if (remote && Number.isSafeInteger(remote.revision) && remote.revision > expectedRevision && isCurrentDraft(remote, this.identity) && payloadEqual(remote.payload, payload)) {
            this.publish({ revision: remote.revision, updatedAt: remote.updatedAt, dirty: this.editVersion !== version, retryCount: 0 });
            this.persist();
            continue;
          }
          if ((remote?.revision ?? 0) !== expectedRevision) this.publish({ conflict: remote, remoteMissing: remote === null, error: '云端存在其他版本；本地修改已保留，请核对冲突。' });
        } catch (readError) {
          if (this.quarantine(readError)) return false;
          // Offline: keep the known revision and all local edits.
        }
        const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? '');
        this.publish({ saving: false, error: this.snapshot.error ?? (message.includes('submission_period_changed') ? '填报季度已变化；修改已保留，请重新打开本季度任务。' : '云端保存失败；修改已保留，将自动重试。'), retryCount: this.snapshot.retryCount + 1 });
        return false;
      }
    }
    if (this.snapshot.quarantined) return false;
    this.publish({ saving: false, error: null });
    return true;
  }
  async resolveConflict(choice: 'local' | 'remote'): Promise<boolean> {
    // Re-read immediately: another writer may have edited since the dialog opened.
    const previouslyShown = this.snapshot.conflict;
    if (this.snapshot.quarantined || (!previouslyShown && !this.snapshot.remoteMissing)) return false;
    let remote: RemoteDraft | null;
    try { remote = await this.transport.read(); } catch (error) { this.quarantine(error); return false; }
    if (this.snapshot.quarantined) return false;
    if ((remote?.revision ?? 0) !== (previouslyShown?.revision ?? 0)) {
      this.publish({ conflict: remote, remoteMissing: remote === null, error: '云端版本再次变化，请重新核对。' });
      return false;
    }
    if (!this.preserveVersion('conflict-local', this.snapshot.payload) || !this.preserveVersion('conflict-server', remote)) return false;
    this.editVersion++;
    this.publish({ payload: choice === 'remote' ? (remote && isCurrentDraft(remote, this.identity) ? remote.payload : EMPTY()) : this.snapshot.payload, revision: remote?.revision ?? 0, dirty: choice === 'local', conflict: null, remoteMissing: false, error: null, loaded: true });
    this.persist();
    return true;
  }
  clearAcknowledgedLocalCopy(): boolean {
    if (this.snapshot.quarantined || this.snapshot.dirty || this.snapshot.saving || this.snapshot.conflict || this.snapshot.remoteMissing) return false;
    try { this.storage?.removeItem(this.key); return true; } catch { return false; }
  }
}

