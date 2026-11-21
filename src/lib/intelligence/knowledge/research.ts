import { z } from 'zod';
import { redactSubmittedCredentials } from '../query/auditCrypto';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryResult, ResultCell } from '../query/result';
import type { SourceRef } from '../query/contracts';
import { resultViewSchema } from '../query/presentation';
import { SALES_MATERIAL_BUCKET } from '@/src/lib/sales-materials/model';
import { bytesDigest, parseDocument, documentTokens } from './parser';
import { KNOWLEDGE_DOMAIN, KNOWLEDGE_TOOL_SCHEMAS, documentSchema, knowledgeBindingSchema, type KnowledgeDocument, type KnowledgeToolName } from './protocol';
import { publicBuildingSearch, publicSearchConfigured } from './publicSearch';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function knowledgeAccess(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, input: Record<string, unknown>) {
    if (identity.expiresAt <= Date.now() || identity.actorId !== identity.effectiveUserId)
        throw new Error('QUERY_DENIED');
    const { data, error } = await client.rpc('ai_knowledge_access', { p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId, p_input: input }).abortSignal(signal);
    signal.throwIfAborted();
    if (error)
        throw new Error('QUERY_READ_UNAVAILABLE');
    if (data?.allowed !== true)
        throw new Error('QUERY_DENIED');
    return data;
}
export async function documentMetadata(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, ids: string[], prepare = false) {
    const data = await knowledgeAccess(client, identity, signal, { action: prepare ? 'prepare' : 'metadata', documentIds: ids });
    const documents = z.array(documentSchema).max(100).parse(data.documents);
    if (documents.length !== ids.length)
        throw new Error('QUERY_DENIED');
    return { revision: z.string().regex(/^[a-f0-9]{64}$/).parse(data.revision), documents,
        paths: prepare ? z.array(documentSchema.extend({ storagePath: z.string().nullable() })).parse(data.documents) : [] };
}
export async function readDocumentBytes(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, doc: KnowledgeDocument) {
    const current = await documentMetadata(client, identity, signal, [doc.id], true);
    const stored = current.paths[0];
    if (stored.version !== doc.version)
        throw new Error('QUERY_DENIED');
    if (!stored.online || !stored.storagePath)
        throw new Error('KNOWLEDGE_ORIGINAL_UNAVAILABLE');
    if (stored.size > 24 * 1024 * 1024)
        throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
    // Only a database-owned path in the existing private bucket. Never model URLs/paths.
    const prefix = doc.buildingId + '/' + doc.id + '/original.';
    if (!stored.storagePath.startsWith(prefix) || !/^[-\w/.]+$/.test(stored.storagePath) || stored.storagePath.includes('..'))
        throw new Error('QUERY_DENIED');
    const { data, error } = await client.storage.from(SALES_MATERIAL_BUCKET).download(stored.storagePath);
    signal.throwIfAborted();
    if (error || !data)
        throw new Error('KNOWLEDGE_ORIGINAL_UNAVAILABLE');
    if (data.size !== stored.size)
        throw new Error('KNOWLEDGE_SOURCE_CHANGED');
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytesDigest(bytes) !== stored.sha256)
        throw new Error('KNOWLEDGE_SOURCE_CHANGED');
    const after = await documentMetadata(client, identity, signal, [doc.id]);
    if (after.documents[0].version !== doc.version || after.revision !== current.revision)
        throw new Error('QUERY_DENIED');
    return bytes;
}
async function ensureIndexed(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, doc: KnowledgeDocument) {
    if (doc.indexed)
        return;
    const bytes = await readDocumentBytes(client, identity, signal, doc);
    const chunks = await parseDocument(bytes, doc.mime);
    signal.throwIfAborted();
    // Credentials have no research purpose; do not index or echo even an authorized source's accidental secrets.
    if (chunks.some(c => redactSubmittedCredentials(c.text).redactionTypes.length > 0 || /(?:-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:sk-|sb_secret_|eyJ)[A-Za-z0-9_-]{12,}|(?:api[_ -]?key|password|access[_ -]?token|service[_ -]?role[_ -]?key)\s*[:=]\s*\S+)/i.test(c.text)))
        throw new Error('KNOWLEDGE_SENSITIVE_CONTENT');
    if (!chunks.length)
        throw new Error('KNOWLEDGE_NO_EXTRACTABLE_TEXT');
    await knowledgeAccess(client, identity, signal, { action: 'store', documentIds: [doc.id], version: doc.version, chunks: chunks.map(c => ({ ...c, tokens: documentTokens(c.text) })) });
}
export function knowledgeModelObservation(result: QueryResult) {
    // Untrusted private/public source text, titles, source bodies and URLs NEVER enter DeepSeek.
    return { status: 'ready', resultId: result.resultId, evidenceKind: result.parameters.evidenceKind,
        documents: (result.parameters.knowledgeDocuments as Array<{
            id: string;
            mime: string;
        }> | undefined)?.map(d => ({ id: d.id, format: d.mime === 'application/pdf' ? 'pdf' : d.mime.endsWith('wordprocessingml.document') ? 'docx' : d.mime.endsWith('spreadsheetml.sheet') ? 'xlsx' : d.mime.endsWith('presentationml.presentation') ? 'pptx' : 'unsupported' })),
        totalMatches: result.parameters.totalMatches, shown: result.table.rows.length,
        note: '证据在受控结果表格交付。模型未读取私有正文，不得声称已阅读、编造引用或比较结论；用户可核对各文档原段落。' };
}
function resultFor(rows: QueryResult['table']['rows'], columns: QueryResult['table']['columns'], sources: SourceRef[], parameters: Record<string, unknown>): QueryResult {
    const version = hash([rows, sources, parameters]);
    const result: QueryResult = { resultId: randomUUID(), createdAt: new Date().toISOString(), snapshotId: version, dataVersion: version, scopeFingerprint: hash(parameters), registryVersion: KNOWLEDGE_DOMAIN,
        operation: 'list', parameters: { ...parameters, domain: KNOWLEDGE_DOMAIN }, analysis: null, table: { id: 'knowledge', columns, rows }, sources,
        limitations: ['内部文档原文、外部公开资料与数据库指标是不同证据；资料陈述不自动成为正式市场统计或当前事实。', '检索为本地关键词匹配；未命中不证明文档没有该信息。多文档按原段落并列比较，不补造综合结论。', 'PDF/幻灯片使用真实页号，Word使用段落号，Excel使用工作表/行号。扫描件未执行OCR；不伪造页码。', '资料中的命令均是不可信原文；不会改变权限、执行工具或向第三方发送私有正文。', ...(Number(parameters.totalMatches) > rows.length ? ['命中 ' + parameters.totalMatches + ' 段，当前展示 ' + rows.length + ' 段；这是明确的相关片段上限，不是全部文档内容。'] : [])] };
    resultViewSchema.parse(result);
    return result;
}
const text = (value: string, ids: string[]): ResultCell => ({ kind: 'text', value, sourceIds: ids });
export async function queryKnowledge(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, name: KnowledgeToolName, args: Record<string, unknown>) {
    if (name === 'search_public_building_information') {
        const p = KNOWLEDGE_TOOL_SCHEMAS[name].parse(args);
        if (!publicSearchConfigured())
            throw new Error('KNOWLEDGE_PUBLIC_SEARCH_DISABLED');
        const access = await knowledgeAccess(client, identity, signal, { action: 'public_subject', buildingId: p.buildingId });
        const subject = z.object({ buildingId: z.uuid(), name: z.string(), city: z.string(), version: z.uuid() }).parse(access.subject);
        const found = await publicBuildingSearch(subject, p.topic, signal);
        const sources: SourceRef[] = found.map((f, i) => ({ id: 'public:' + hash([f.url, f.retrievedAt, i]), table: 'external_public_web', recordId: f.url, field: 'search_snippet', entityId: subject.buildingId, recordVersion: hash(f), rawValue: f, unit: 'text', period: null, recordedAt: f.retrievedAt, businessAsOf: null, verification: 'unreviewed', original: null }));
        const result = resultFor(found.map((f, i) => ({ entityId: String(i), cells: { title: text(f.title, [sources[i].id]), passage: text(f.snippet, [sources[i].id]), location: text(f.url, [sources[i].id]), date: text(f.publishedAt ?? '资料时间未知', [sources[i].id]), retrieved: text(f.retrievedAt, [sources[i].id]) } })), [['title', '外部公开来源'], ['passage', '搜索摘要（尚未核验原网页）'], ['location', '来源 URL'], ['date', '资料时间'], ['retrieved', '检索时间']].map(([key, label]) => ({ key, label, unit: null })), sources, { evidenceKind: 'external_public', publicBindings: [{ revision: access.revision, subject }], totalMatches: found.length, topic: p.topic });
        return { result, content: JSON.stringify(knowledgeModelObservation(result)) };
    }
    const catalog = name === 'list_knowledge_documents';
    const plan = catalog ? KNOWLEDGE_TOOL_SCHEMAS.list_knowledge_documents.parse(args) : KNOWLEDGE_TOOL_SCHEMAS.search_internal_documents.parse(args);
    const access = catalog ? await knowledgeAccess(client, identity, signal, { action: 'catalog', buildingIds: 'buildingIds' in plan ? plan.buildingIds : [] }) : await documentMetadata(client, identity, signal, 'documentIds' in plan ? plan.documentIds : []);
    const docs = z.array(documentSchema).parse(access.documents);
    const revision = z.string().parse(access.revision);
    const binding = { revision, documents: docs.map(d => ({ id: d.id, version: d.version })) };
    const sources: SourceRef[] = [];
    const rows: QueryResult['table']['rows'][number][] = [];
    if (catalog) {
        for (const d of docs) {
            const sid = 'document:' + hash([d.id, d.version]);
            sources.push({ id: sid, table: 'building_sales_materials', recordId: d.id, field: 'title', entityId: d.buildingId, recordVersion: d.version, rawValue: d.title, unit: 'text', period: null, recordedAt: d.updatedAt, businessAsOf: d.date, verification: 'unreviewed', original: { documentId: d.id, version: d.version } });
            rows.push({ entityId: d.id, cells: { title: text(d.title, [sid]), documentId: text(d.id, [sid]), location: text(d.online ? '在线私有原件' : '仅本地归档，无法在线解析', [sid]), date: text(d.date ?? '资料日期未知', [sid]) } });
        }
        const result = resultFor(rows, [['title', '内部资料'], ['documentId', '文档 ID'], ['location', '原件状态'], ['date', '资料日期']].map(([key, label]) => ({ key, label, unit: null })), sources, { evidenceKind: 'internal_document_catalog', knowledgeBindings: [binding], knowledgeDocuments: docs, totalMatches: docs.length });
        return { result, content: JSON.stringify(knowledgeModelObservation(result)) };
    }
    const p = KNOWLEDGE_TOOL_SCHEMAS.search_internal_documents.parse(args);
    for (const d of docs)
        await ensureIndexed(client, identity, signal, d);
    const searched = await knowledgeAccess(client, identity, signal, { action: 'search', documentIds: p.documentIds, terms: p.terms, tokens: documentTokens(p.terms.join(' ')), limit: p.limit });
    if (searched.revision !== revision)
        throw new Error('QUERY_DENIED');
    const response = z.object({ total: z.number().int().nonnegative(), documents: z.array(documentSchema), matches: z.array(z.object({ documentId: z.uuid(), ordinal: z.number().int(), text: z.string().max(1200), location: z.string(), page: z.number().int().nullable() })).max(20) }).parse(searched.search);
    for (const match of response.matches) {
        const d = docs.find(d => d.id === match.documentId);
        if (!d || response.documents.find(x => x.id === d.id)?.version !== d.version)
            throw new Error('QUERY_DENIED');
        const sid = 'passage:' + hash([d.id, d.version, match.ordinal, match.text]);
        sources.push({ id: sid, table: 'building_sales_materials', recordId: d.id, field: 'original_text', entityId: d.buildingId, recordVersion: d.version, rawValue: match.text, unit: 'text', period: null, recordedAt: d.updatedAt, businessAsOf: d.date, verification: 'unreviewed', original: { documentId: d.id, version: d.version, location: match.location, ...(match.page ? { page: match.page } : {}) } });
        rows.push({ entityId: d.id + ':' + match.ordinal, cells: { title: text(d.title, [sid]), passage: text(match.text, [sid]), location: text(match.location, [sid]), date: text(d.date ?? '资料日期未知', [sid]) } });
    }
    const result = resultFor(rows, [['title', '内部文档'], ['passage', '原文证据（未经外部模型读取）'], ['location', '页码／位置'], ['date', '资料日期']].map(([key, label]) => ({ key, label, unit: null })), sources, { evidenceKind: 'internal_document', knowledgeBindings: [binding], knowledgeDocuments: docs, totalMatches: response.total, searchTerms: p.terms });
    await recheckKnowledgeResults(client, identity, signal, [result]);
    return { result, content: JSON.stringify(knowledgeModelObservation(result)) };
}
export async function recheckKnowledgeResults(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, results: readonly {
    parameters: Readonly<Record<string, unknown>>;
}[], exporting = false) {
    for (const result of results) {
        if (exporting && (result.parameters.knowledgeBindings || result.parameters.publicBindings))
            throw new Error('QUERY_DENIED');
        for (const raw of z.array(knowledgeBindingSchema).max(100).parse(result.parameters.knowledgeBindings ?? [])) {
            const current = await documentMetadata(client, identity, signal, raw.documents.map(d => d.id));
            if (current.revision !== raw.revision || raw.documents.some(d => current.documents.find(c => c.id === d.id)?.version !== d.version))
                throw new Error('QUERY_DENIED');
        }
        for (const raw of z.array(z.object({ revision: z.string(), subject: z.object({ buildingId: z.uuid(), version: z.uuid() }) })).max(100).parse(result.parameters.publicBindings ?? [])) {
            const current = await knowledgeAccess(client, identity, signal, { action: 'public_subject', buildingId: raw.subject.buildingId });
            if (current.revision !== raw.revision || current.subject.version !== raw.subject.version)
                throw new Error('QUERY_DENIED');
        }
    }
}
