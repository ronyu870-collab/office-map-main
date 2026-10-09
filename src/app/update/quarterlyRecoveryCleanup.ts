import { draftCacheKey, unpackDraft, type DraftIdentity } from './quarterlyDraftStore';

type RecoveryInspection = { status: 'safe' | 'pending' | 'invalid'; keys: string[] };
import { isDefiniteSubmissionRejection } from './quarterlySubmissionAttempt';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Inspect every account-scoped record before deleting anything. Unknown data fails closed. */
export function inspectAccountRecovery(storage: Storage, userId: string): RecoveryInspection {
  const keys: string[] = [];
  try {
    const prefix = `quarterly-draft:v1:${encodeURIComponent(userId)}:`;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    let pending = false;
    for (const key of keys) {
      const item: unknown = JSON.parse(storage.getItem(key) ?? 'null');
      if (!record(item)) return { status: 'invalid', keys };
      const suffix = key.slice(prefix.length);
      const match = /^(\d+):Q([1-4]):(GradeA|GradeB|BP)(.*)$/.exec(suffix);
      if (!match) return { status: 'invalid', keys };
      const identity: DraftIdentity = { userId, year: Number(match[1]), quarter: Number(match[2]), tab: match[3] };
      const kind = match[4];
      if (kind === ':submission' || kind.startsWith(':submission:request:')) {
        const batch = item.batch;
        if (typeof item.requestId !== 'string' || !item.requestId || !record(batch)
          || batch.p_user_id !== userId || batch.p_year !== identity.year || batch.p_quarter !== identity.quarter || batch.p_tab !== identity.tab
          || !Array.isArray(batch.p_regular_rows) || !Array.isArray(batch.p_future_rows)
          || !batch.p_regular_rows.every((row) => record(row) && typeof row.building_id === 'string' && Boolean(row.building_id))
          || !batch.p_future_rows.every((row) => record(row) && typeof row.future_supply_id === 'string' && Boolean(row.future_supply_id))
          || (item.receipt !== undefined && item.rejected !== undefined)
          || (kind !== ':submission' && kind !== `:submission:request:${item.requestId}`)) return { status: 'invalid', keys };
        if (item.receipt !== undefined) {
          const receipt = item.receipt;
          if (!record(receipt) || receipt.regular_count !== batch.p_regular_rows.length || receipt.future_count !== batch.p_future_rows.length
            || typeof receipt.submitted_at !== 'string' || !Number.isFinite(Date.parse(receipt.submitted_at))) return { status: 'invalid', keys };
        }
        if (item.rejected !== undefined) {
          const rejection = item.rejected;
          if (!record(rejection) || typeof rejection.code !== 'string' || typeof rejection.message !== 'string'
            || !isDefiniteSubmissionRejection(rejection)) return { status: 'invalid', keys };
        }
        if (!item.receipt && !item.rejected) pending = true;
      } else {
        if (!record(item.identity) || draftCacheKey(item.identity as unknown as DraftIdentity) !== draftCacheKey(identity)) return { status: 'invalid', keys };
        if (kind === '') {
          if (item.version !== 1 || typeof item.dirty !== 'boolean' || !record(item.payload)
            || !record(item.payload.regular) || !record(item.payload.future) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0) return { status: 'invalid', keys };
          unpackDraft({ ...item.payload.regular, __futureSupply__: item.payload.future });
          if (item.dirty) pending = true;
        } else if (/^:(reference|recovery):.+/.test(kind)) {
          if (!Object.hasOwn(item, 'value') || typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt))) return { status: 'invalid', keys };
        } else return { status: 'invalid', keys };
      }
    }
    return { status: pending ? 'pending' : 'safe', keys };
  } catch { return { status: 'invalid', keys }; }
}

