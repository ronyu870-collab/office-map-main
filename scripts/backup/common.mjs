import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const required = (env, key) => {
  if (!env[key]?.trim()) throw new Error(`MISSING_CONFIGURATION:${key}`);
  return env[key];
};
export const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
export async function temporary(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(dir, 0o700);
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function digest(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return { sha256: h.digest('hex'), bytes: (await stat(file)).size };
}
// Never include a command, arguments, child stderr or a connection string in an
// error: native tools can echo passwords or SQL. Evidence is a stage/code only.
export function command(program, args, { env = process.env, timeout = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (x) => { if (output.length < 262144) output += x; });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', () => { clearTimeout(timer); reject(new Error(`TOOL_UNAVAILABLE:${path.basename(program)}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`TOOL_FAILED:${path.basename(program)}:${code}`));
      else resolve(output);
    });
  });
}
const codes = new Set(`USAGE_BACKUP_CREATE DATABASE_CREDENTIALS_REQUIRED DATABASE_HOST_NOT_APPROVED DATABASE_PROJECT_MISMATCH DATABASE_TLS_CONFIGURATION_REJECTED INVALID_AGE_RECIPIENT INVALID_BACKUP_PROFILE INVALID_DATABASE_PROTOCOL INVALID_TARGET_CONFIGURATION SYNTHETIC_REQUIRES_LOCALHOST NO_RECENT_FULL_BACKUP BACKUP_DATABASE_REQUIRED BACKUP_ENTRY_INVALID BACKUP_HASH_MISMATCH BACKUP_MANIFEST_INVALID BACKUP_MARKER_INVALID BACKUP_PLAINTEXT_MISMATCH BACKUP_RUN_REJECTED FULL_COVERAGE_REQUIRED SOURCE_SIZE_MISMATCH PRODUCTION_TRANSPORT_OVERRIDE_REJECTED NATIVE_RESTORE_SYNTHETIC_ONLY RESTORE_DATA_MISMATCH MISSING_OSS_CREDENTIALS MISSING_STORAGE_CREDENTIALS OSS_INVENTORY_INVALID OSS_PAGINATION_INVALID OSS_TARGET_INVALID SOURCE_CHANGED_DURING_BACKUP SOURCE_ENDPOINT_REJECTED SOURCE_NAME_REJECTED STORAGE_BUCKET_LIST_FAILED STORAGE_DOWNLOAD_FAILED STORAGE_FOLDER_CYCLE STORAGE_LIST_FAILED STORAGE_PAGINATION_INVALID POSTGRES_17_REQUIRED R2_ENDPOINT_REJECTED R2_PREFIX_REJECTED R2_PAGINATION_INVALID R2_PRIVACY_CHECK_FAILED R2_PUBLIC_OR_UNKNOWN R2_RETENTION_LOCK_REQUIRED`.split(' '));
export const safeCode = (error) => {
  const message = error?.message ?? '';
  if (message === 'RESTORE_EXTENSION_MISMATCH') return message;
  if (message === 'BACKUP_ROLE_PRIVILEGES_REJECTED' || message === 'BACKUP_CALLABLE_DEFINER_REJECTED') return message;
  return codes.has(message) || message === 'BACKUP_IDENTITY_PROTECTION_REQUIRED' || /^MISSING_CONFIGURATION:BACKUP_[A-Z0-9_]+$/.test(message) || /^TOOL_(UNAVAILABLE|FAILED):(age|pg_dump|pg_dumpall|pg_restore|psql|pg_ctl|initdb)(:(-?\d+|null))?$/.test(message) ? message : 'BACKUP_FAILED';
};
