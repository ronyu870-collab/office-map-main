import { z } from 'zod';

/** References only. Conditions, permissions and prior answers are never client input. */
export const queryConversationSchema = z.strictObject({ id: z.uuid(), parentRequestId: z.uuid().optional(), resumeToken: z.string().min(1).max(3000).optional() });
export type QueryConversation = z.infer<typeof queryConversationSchema>;
export const queryActionSchema = z.strictObject({
  id: z.string().min(1).max(80), label: z.string().min(1).max(120), question: z.string().min(1).max(1000),
});
export type QueryAction = z.infer<typeof queryActionSchema>;
/** Shared explanation envelope: business clarifications use 422; bounded assistant help uses 200. */
export const queryClarificationReasonSchema = z.enum([
  'assistant_help', 'metric_required', 'period_required', 'scope_required', 'ambiguous_reference',
  'unsupported', 'unrecognized', 'unavailable_periods', 'invalid_model_intent',
]);
export type QueryClarificationReason = z.infer<typeof queryClarificationReasonSchema>;

export const SEMANTIC_PROTOCOL_VERSION = 'research-conversation/1';
