import { z } from 'zod';

/** Shared, bounded server/client transport contract. Terminal reply content
 * goes through the existing QueryReply and signed receipt validators. */
export const agentStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('run_started'), requestId: z.uuid() }),
  z.strictObject({ type: z.literal('tool_started'), name: z.string().min(1).max(100) }),
  z.strictObject({ type: z.literal('tool_completed'), name: z.string().min(1).max(100),
    status: z.enum(['ready', 'limited']) }),
  z.strictObject({ type: z.literal('message_delta'), delta: z.string().min(1).max(4000) }),
  z.strictObject({ type: z.literal('run_completed'), reply: z.unknown(),
    receipt: z.strictObject({ deliveryToken: z.string().min(1).max(4000),
      bodySha256: z.string().regex(/^[a-f0-9]{64}$/) }) }),
  z.strictObject({ type: z.literal('run_failed'),
    status: z.number().int().min(200).max(599), message: z.string().min(1).max(1000) }),
]);
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
export type AgentProgressEvent = Exclude<AgentStreamEvent,
  { type: 'run_completed' | 'run_failed' }>;
