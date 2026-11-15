import { z } from 'zod';
import type { QueryReply } from '@/src/services/trustedQueryClient';
import type { QueryConversation } from './conversationProtocol';

export const historyCursorSchema = z.string().min(1).max(3000);
export const historyInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list'), search: z.string().max(160).default(''), archived: z.boolean().default(false), cursor: historyCursorSchema.optional() }),
  z.strictObject({ action: z.literal('open'), conversationId: z.uuid().optional(), requestId: z.uuid().optional(), cursor: historyCursorSchema.optional() })
    .refine(value => !!value.conversationId || !!value.requestId),
  z.strictObject({ action: z.literal('rename'), conversationId: z.uuid(), title: z.string().trim().min(1).max(120) }),
  z.strictObject({ action: z.literal('archive'), conversationId: z.uuid(), archived: z.boolean() }),
]);
export type HistoryInput = z.infer<typeof historyInputSchema>;
export const historyEntrySchema = z.object({ conversationId: z.uuid(), title: z.string().max(120), updatedAt: z.string(),
  latestQuestion: z.string().max(400), requestId: z.uuid(), archived: z.boolean() });
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const historyTurnSchema = z.object({ requestId: z.uuid(), question: z.string().max(6000), submittedAt: z.string(), state: z.string() });
export type HistoryTurn = z.infer<typeof historyTurnSchema>;
export type HistoryOpened = { conversation: QueryConversation; title: string; turns: HistoryTurn[];
  selected: HistoryTurn & { reply: QueryReply }; hasMore: boolean; nextCursor?: string };
export type HistoryPage = { entries: HistoryEntry[]; nextCursor?: string; hasMore: boolean; indexing: boolean; unavailable: number };
