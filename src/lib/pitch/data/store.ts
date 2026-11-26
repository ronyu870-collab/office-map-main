import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyQueryIdentity, type VerifiedQueryIdentity } from '@/src/lib/intelligence/query/serverAuthority';
import { fileReferenceSchema, type FileReference } from '../contracts/entities';
import { bytesDigest } from '@/src/lib/intelligence/knowledge/parser';

export type PitchContext = { client: SupabaseClient; identity: VerifiedQueryIdentity; signal: AbortSignal };
export type PitchDependencies = { client: SupabaseClient; enabled: boolean };
export function pitchDependencies(): PitchDependencies {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('PITCH_UNAVAILABLE');
  return { client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) } }), enabled: process.env.PITCH_STUDIO_ENABLED === 'true' };
}
export async function authorizePitch(request: Request, dependencies: PitchDependencies): Promise<PitchContext> {
  // Reject all simulation headers, including self-targeting. A pilot must never
  // use a real admin token to expand an effective user's grants or private drafts.
  const identity = await verifyQueryIdentity(request, dependencies.client);
  if (!dependencies.enabled) throw new Error('PITCH_DENIED');
  return { client: dependencies.client, identity, signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]) };
}
export async function pitchRpc(ctx: PitchContext, input: Record<string, unknown>): Promise<unknown> {
  ctx.signal.throwIfAborted();
  if (ctx.identity.expiresAt <= Date.now()) throw new Error('PITCH_DENIED');
  const { data, error } = await ctx.client.rpc('pitch_studio_access', { p_actor: ctx.identity.actorId, p_session: ctx.identity.sessionId, p_input: input }).abortSignal(ctx.signal);
  if (error) {
    if (error.code === '42501') throw new Error('PITCH_DENIED');
    if (error.code === '23505') throw new Error('PITCH_CONFLICT');
    if (error.message === 'PITCH_INVALID') throw new Error('PITCH_INVALID');
    throw new Error('PITCH_UNAVAILABLE');
  }
  return data;
}
export const digest = bytesDigest;
export function makeFile(path: string, mime: string, bytes: Uint8Array): FileReference {
  return fileReferenceSchema.parse({ bucket: 'pitch-studio-private', path, mime, size: bytes.length, sha256: digest(bytes) });
}
export async function uploadFile(ctx: PitchContext, file: FileReference, bytes: Uint8Array) {
  fileReferenceSchema.parse(file);
  if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error('PITCH_INVALID');
  const { error } = await ctx.client.storage.from(file.bucket).upload(file.path, bytes, { contentType: file.mime, upsert: false });
  // Immutable paths; retries may only reuse identical bytes, never overwrite.
  if (error) {
    const prior = await ctx.client.storage.from(file.bucket).download(file.path);
    if (prior.error || !prior.data || prior.data.size !== file.size || digest(new Uint8Array(await prior.data.arrayBuffer())) !== file.sha256) throw new Error('PITCH_STORAGE_UNAVAILABLE');
  }
}
export async function readFile(ctx: PitchContext, file: FileReference): Promise<Uint8Array> {
  fileReferenceSchema.parse(file);
  const { data, error } = await ctx.client.storage.from(file.bucket).download(file.path);
  if (error || !data || data.size !== file.size) throw new Error('PITCH_STORAGE_UNAVAILABLE');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (digest(bytes) !== file.sha256) throw new Error('PITCH_SOURCE_CHANGED');
  return bytes;
}
export const mediaRowSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), storage_path: z.string(), mime: z.string(), sha256: z.string(), size_bytes: z.coerce.number() });
