import { z } from 'zod';
import { historyEntrySchema, historyTurnSchema, type HistoryInput, type HistoryOpened, type HistoryPage } from '@/src/lib/intelligence/query/historyProtocol';
import { queryConversationSchema } from '@/src/lib/intelligence/query/conversationProtocol';
import { receiveTrustedQueryValue, trustedQueryRequest, queryReplySchema, type QueryClientScope } from './trustedQueryClient';

const pageSchema = z.object({ entries: z.array(historyEntrySchema).max(15), nextCursor: z.string().max(3000).optional(),
  hasMore: z.boolean(), indexing: z.boolean(), unavailable: z.number().int().nonnegative() });
const openedSchema = z.object({ conversation: queryConversationSchema, title: z.string().max(120), turns: z.array(historyTurnSchema).max(10),
  selected: historyTurnSchema.extend({ reply: queryReplySchema }),
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
    receiveTrustedQueryValue(scope, raw, opened.selected.reply);
    return opened;
  },
  async change(scope: QueryClientScope, input: Extract<HistoryInput, { action: 'rename' | 'archive' }>, signal: AbortSignal): Promise<void> {
    const raw = await request(scope, input, signal);
    receiveTrustedQueryValue(scope, raw, z.object({ status: z.literal('saved') }).parse(raw));
  },
};
