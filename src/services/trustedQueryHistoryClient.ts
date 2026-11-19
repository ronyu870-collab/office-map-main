import { z } from 'zod';
import { HISTORY_TIMELINE_PAGE_SIZE, historyEntrySchema, historySnapshotDeliverySchema, historyTurnSchema, type HistoryInput, type HistoryOpened, type HistoryPage } from '@/src/lib/intelligence/query/historyProtocol';
import { queryConversationSchema } from '@/src/lib/intelligence/query/conversationProtocol';
import { bindTrustedQueryReceipt, receiveTrustedQueryValue, trustedQueryClient, trustedQueryRequest, queryReplySchema, type QueryClientScope } from './trustedQueryClient';

const pageSchema = z.object({ entries: z.array(historyEntrySchema).max(15), nextCursor: z.string().max(3000).optional(),
  hasMore: z.boolean(), indexing: z.boolean(), unavailable: z.number().int().nonnegative() });
const openedSchema = z.object({ conversation: queryConversationSchema, title: z.string().max(120), turns: z.array(historyTurnSchema).max(10),
  selected: historyTurnSchema.extend({ reply: queryReplySchema, delivery: historySnapshotDeliverySchema.optional() }),
  timeline: z.array(historyTurnSchema.extend({ reply: queryReplySchema, delivery: historySnapshotDeliverySchema })).max(HISTORY_TIMELINE_PAGE_SIZE).optional(),
  nextCursor: z.string().max(3000).optional(), hasMore: z.boolean() });

async function request(scope: QueryClientScope, input: HistoryInput, signal: AbortSignal) {
  const raw = await trustedQueryRequest('/history', scope, signal, input);
  const envelope = z.object({ status: z.string(), error: z.string().optional() }).parse(raw);
  if (!['ready', 'saved'].includes(envelope.status)) throw new Error(envelope.error ?? '历史工作记录暂不可用。');
  return raw;
}
export const trustedQueryHistoryClient = {
  async list(scope: QueryClientScope, input: Omit<Extract<HistoryInput, { action: 'list' }>, 'action'>, signal: AbortSignal): Promise<HistoryPage> {
    const raw = await request(scope, { action: 'list', ...input }, signal);
    return receiveTrustedQueryValue(scope, raw, z.object({ page: pageSchema }).parse(raw).page);
  },
  async open(scope: QueryClientScope, input: Omit<Extract<HistoryInput, { action: 'open' }>, 'action'>, signal: AbortSignal): Promise<HistoryOpened> {
    const raw = await request(scope, { action: 'open', ...input }, signal);
    const opened = z.object({ opened: openedSchema }).parse(raw).opened;
    if (input.conversationId && opened.conversation.id !== input.conversationId
      || input.requestId && opened.selected.requestId !== input.requestId) throw new Error('历史回答与所选对话不一致。');
    if (opened.timeline) {
      // `openedSchema` has validated the shape. Digest the original objects,
      // not Zod's reordered/stripped projections of the saved result fields.
      const original = (raw as { opened: { selected: Record<string, unknown>; timeline: Record<string, unknown>[] } }).opened;
      const all = [...opened.timeline, opened.selected], wire = [...original.timeline, original.selected];
      const unique = new Map<string, typeof opened.selected>();
      for (let index = 0; index < all.length; index++) {
        const turn = all[index], previous = unique.get(turn.requestId);
        if (!turn.delivery || turn.reply.requestId !== turn.requestId
          || turn.reply.conversation && turn.reply.conversation.id !== opened.conversation.id
          || previous && (previous.delivery?.deliveryToken !== turn.delivery.deliveryToken || previous.delivery.bodySha256 !== turn.delivery.bodySha256))
          throw new Error('历史交付校验失败，请重新打开对话。');
        const snapshot = { ...wire[index] }; delete snapshot.delivery;
        await bindTrustedQueryReceipt(raw as object, snapshot, turn.reply, turn.delivery, signal);
        unique.set(turn.requestId, turn);
      }
      signal.throwIfAborted();
      // Only report received after every nested snapshot has validated, so a
      // partial or swapped batch cannot produce a misleading success receipt.
      receiveTrustedQueryValue(scope, raw, opened);
      for (const turn of unique.values()) void trustedQueryClient.reportDelivery(scope, turn.reply, 'client_received');
    } else receiveTrustedQueryValue(scope, raw, opened.selected.reply);
    return opened;
  },
  async change(scope: QueryClientScope, input: Extract<HistoryInput, { action: 'rename' | 'archive' }>, signal: AbortSignal): Promise<void> {
    const raw = await request(scope, input, signal);
    receiveTrustedQueryValue(scope, raw, z.object({ status: z.literal('saved') }).parse(raw));
  },
};
