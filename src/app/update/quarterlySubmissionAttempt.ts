import { draftCacheKey, type DraftIdentity, type DraftStorage } from './quarterlyDraftStore';

export interface QuarterlyBatch {
  p_user_id: string;
  p_user_name: string;
  p_year: number;
  p_quarter: number;
  p_tab: string;
  p_regular_rows: Record<string, unknown>[];
  p_future_rows: Record<string, unknown>[];
}
export interface SubmissionReceipt { regular_count: number; future_count: number; submitted_at: string }
interface Attempt { requestId: string; batch: QuarterlyBatch; receipt?: SubmissionReceipt; rejected?: { code: string; message: string } }

export function isDefiniteSubmissionRejection(error: unknown): error is { code: string; message: string } {
  const value = error as { code?: string; message?: string };
  if (value?.code === '42501' && /^(regular|future)_submission_assignment_or_category_mismatch$/.test(value.message ?? '')) return true;
  return value?.code === '22023' && /^(invalid_submission_(numeric|numeric_range|payload|row|row_id|tab|period)|duplicate_submission_row|vacant_area_exceeds_total|regular_submission_assignment_or_category_mismatch|future_submission_assignment_or_category_mismatch|submission_period_changed)(:|$)/.test(value.message ?? '');
}

/** Retains the exact request across retries/restarts, including ambiguous timeouts. */
export class QuarterlySubmissionAttempt {
  private inFlight: Promise<SubmissionReceipt> | null = null;
  private attempt: Attempt | null = null;
  private key: string;
  constructor(private identity: DraftIdentity, private storage: DraftStorage | null) {
    this.key = `${draftCacheKey(identity)}:submission`;
    this.refreshPending();
  }
  private parse(raw: string): Attempt {
    const saved = JSON.parse(raw) as Attempt;
    if (!saved.requestId || saved.batch.p_user_id !== this.identity.userId || saved.batch.p_year !== this.identity.year || saved.batch.p_quarter !== this.identity.quarter || saved.batch.p_tab !== this.identity.tab) throw new Error('提交恢复副本无效，请导出后联系管理员。');
    return saved;
  }
  private refreshPending() {
    const raw = this.storage?.getItem(this.key);
    if (raw) this.attempt = this.parse(raw);
    // Each request also has its own durable record. Another window can replace
    // the shared pointer, but cannot erase an unresolved request's identity.
    const candidates: Attempt[] = [];
    for (let index = 0; index < (this.storage?.length ?? 0); index++) {
      const key = this.storage?.key?.(index);
      if (!key?.startsWith(`${this.key}:request:`)) continue;
      const record = this.storage?.getItem(key);
      if (record) candidates.push(this.parse(record));
    }
    const canonical = candidates.find((item) => item.requestId === this.attempt?.requestId);
    if (canonical) this.attempt = canonical;
    const pending = candidates.find((item) => !item.receipt && !item.rejected);
    if (pending) this.attempt = pending;
  }
  private persist(attempt: Attempt) {
    if (!this.storage) throw new Error('no_storage');
    this.storage.setItem(`${this.key}:request:${attempt.requestId}`, JSON.stringify(attempt));
    this.storage.setItem(this.key, JSON.stringify(attempt));
  }
  hasPending() { return Boolean(this.attempt && !this.attempt.receipt && !this.attempt.rejected); }
  getPendingBatch() { return this.hasPending() ? this.attempt?.batch : null; }
  submit(batch: QuarterlyBatch, send: (batch: QuarterlyBatch, requestId: string) => Promise<SubmissionReceipt>): Promise<SubmissionReceipt> {
    if (this.inFlight) return this.inFlight;
    const run = async () => {
      this.refreshPending();
      const sameBatch = this.attempt && JSON.stringify(this.attempt.batch) === JSON.stringify(batch);
      if (sameBatch && this.attempt?.receipt) return this.attempt.receipt;
      if (!this.hasPending()) {
        this.attempt = { requestId: crypto.randomUUID(), batch: JSON.parse(JSON.stringify(batch)) as QuarterlyBatch };
        try { this.persist(this.attempt); }
        catch { this.attempt = null; throw new Error('无法保存提交恢复凭据。请先导出草稿并允许本机存储，再提交。'); }
      }
      const attempt = this.attempt!;
      try {
        const receipt = await send(attempt.batch, attempt.requestId);
        if (!receipt || receipt.regular_count !== attempt.batch.p_regular_rows.length || receipt.future_count !== attempt.batch.p_future_rows.length || !Number.isFinite(Date.parse(receipt.submitted_at))) throw new Error('提交回执校验失败；请使用相同请求重试核验，勿创建新提交。');
        attempt.receipt = receipt;
        try { this.persist(attempt); } catch { /* durable pending record still retries the same server key */ }
        return receipt;
      } catch (error) {
        // Only an explicit known SQL validation error proves this transaction
        // rolled back. Timeouts, malformed receipts and authorization errors
        // remain unresolved and must keep the original key.
        if (isDefiniteSubmissionRejection(error)) {
          attempt.rejected = { code: error.code, message: error.message };
          try { this.persist(attempt); } catch { /* fail closed on restart */ }
        }
        throw error;
      }
    };
    // Browser-wide lock coordinates distinct windows. The immutable per-request
    // records still protect recovery on browsers without the Web Locks API.
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const withLock = async (): Promise<SubmissionReceipt> => locks ? await locks.request(this.key, run) : await run();
    this.inFlight = withLock().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

