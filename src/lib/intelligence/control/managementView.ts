import { administrationInputs } from './administrationView';
import { operationsInputs } from './operationsView';
import { z } from 'zod';
import { controlConfigSchema, managementCapabilitySchema, modelSchema } from './config';
import type { ControlConfig, ManagementCapability } from './config';

export const controlStateSchema = z.object({ version: z.uuid().nullable(), revision: z.uuid(), paused: z.boolean(),
  disabled_providers: z.array(z.enum(['deepseek', 'openai'])).max(2), disabled_models: z.array(z.string().max(120)).max(100), changed_at: z.iso.datetime({ offset: true }) });
export const draftSchema = z.object({ id: z.uuid(), actor_id: z.uuid(), base_revision: z.uuid(), config: controlConfigSchema, updated_at: z.iso.datetime({ offset: true }) });
export const managementReadSchema = z.object({ allowed: z.literal(true), capabilities: z.array(managementCapabilitySchema), state: controlStateSchema,
  globalControl:z.object({enabled:z.boolean(),revision:z.uuid()}).optional(), config: controlConfigSchema.nullable(), models: z.array(modelSchema).max(100), drafts: z.array(draftSchema).max(1) });
export type ManagementRead = z.infer<typeof managementReadSchema>;
export const historySchema = z.object({ allowed: z.literal(true), versions: z.array(z.object({ version: z.uuid(), created_at: z.iso.datetime({ offset: true }),
  actor_id: z.uuid(), reason: z.string().max(500), restored_from: z.uuid().nullable(), config: controlConfigSchema })).max(50) });
const expectedRevision = z.uuid(), reason = z.string().trim().min(1).max(500);
export const managementInputSchema = z.discriminatedUnion('action', [
  ...operationsInputs, ...administrationInputs,
  z.strictObject({ action: z.literal('read') }), z.strictObject({ action: z.literal('history') }),
  z.strictObject({ action: z.literal('validate'), config: controlConfigSchema, expectedRevision }),
  z.strictObject({ action: z.literal('draft'), config: controlConfigSchema, expectedRevision }),
  z.strictObject({ action: z.literal('publish'), draftId: z.uuid(), expectedRevision, reason }),
  z.strictObject({ action: z.literal('rollback'), version: z.uuid(), expectedRevision, reason }),
  z.strictObject({ action: z.literal('emergency'), expectedRevision, reason, paused: z.boolean(), disabledProviders: z.array(z.enum(['deepseek','openai'])).max(2),
    disabledModels: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/)).max(100) }),
]);
export type ManagementInput = z.infer<typeof managementInputSchema>;

export function mayChangeConfiguration(before:ControlConfig|null,after:ControlConfig,caps:ManagementCapability[]) {
  if(!before)return caps.includes('models:write')&&caps.includes('budgets:write');
  const changed=configurationDiff(before,after);
  return changed.every(item=>item.path.startsWith('budget.')||item.path.includes('.limits.')
    ?caps.includes('budgets:write'):caps.includes('models:write'));
}

/** Structural diff, no inferred prices, model capabilities or historical routing. */
export function configurationDiff(before: unknown, after: unknown): { path: string; before: unknown; after: unknown }[] {
  const differences: { path: string; before: unknown; after: unknown }[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
      for(const key of new Set([...Object.keys(left),...Object.keys(right)])) visit(left[key],right[key],path ? `${path}.${key}` : key);
    } else differences.push({ path, before: a ?? null, after: b ?? null });
  };
  visit(before,after,'');return differences;
}
