import { z } from 'zod';

/** The caller supplies references only. Text always comes from an owned archive. */
export const assistantCopyInputSchema = z.strictObject({ action: z.literal('copy'), requestId: z.uuid(), conversationId: z.uuid() });
export type AssistantCopyInput = z.infer<typeof assistantCopyInputSchema>;
export const assistantCopyOutputSchema = z.object({ status: z.literal('ready'), requestId: z.uuid(),
  conversationId: z.uuid(), text: z.string().min(1).max(12000) });

