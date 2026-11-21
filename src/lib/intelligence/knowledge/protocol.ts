import { z } from 'zod';
export const KNOWLEDGE_DOMAIN = 'knowledge-research/1';
const uniqueIds = z.array(z.uuid()).min(1).max(8).refine(v => new Set(v).size === v.length);
export const KNOWLEDGE_TOOL_SCHEMAS = {
    list_knowledge_documents: z.strictObject({ buildingIds: uniqueIds }),
    search_internal_documents: z.strictObject({ documentIds: uniqueIds, terms: z.array(z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} ._-]+$/u)).min(1).max(6), limit: z.number().int().min(1).max(20).default(12) }),
    search_public_building_information: z.strictObject({ buildingId: z.uuid(), topic: z.enum(['completion_year', 'parking', 'hvac', 'green_certification']) }),
};
export type KnowledgeToolName = keyof typeof KNOWLEDGE_TOOL_SCHEMAS;
export const KNOWLEDGE_TOOL_NAMES = new Set<string>(Object.keys(KNOWLEDGE_TOOL_SCHEMAS));
export const chunkSchema = z.strictObject({ ordinal: z.number().int().min(0).max(1999), text: z.string().min(1).max(1200), location: z.string().min(1).max(160), page: z.number().int().min(1).max(500).nullable() });
export type DocumentChunk = z.infer<typeof chunkSchema>;
export const documentSchema = z.object({ id: z.uuid(), buildingId: z.uuid(), title: z.string().max(160), version: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.string(), size: z.number().int().positive(), date: z.string().nullable(), updatedAt: z.string(), online: z.boolean(), indexed: z.boolean() });
export type KnowledgeDocument = z.infer<typeof documentSchema>;
export const knowledgeBindingSchema = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/), documents: z.array(z.strictObject({ id: z.uuid(), version: z.string().regex(/^[a-f0-9]{64}$/) })).max(100) });
export const isKnowledgeResult = (r: {
    parameters: Readonly<Record<string, unknown>>;
}) => r.parameters.domain === KNOWLEDGE_DOMAIN;
