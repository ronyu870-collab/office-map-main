import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const READ_ONLY_RPCS = new Set([
  'lease_expiry_context_list',
  'lease_expiry_review_list',
  'get_all_tables',
  'get_table_columns',
  'get_all_memo_tags',
  'verify_backup_password',
  'admin_get_auth_audit_logs',
  'get_quarterly_submission_summary',
]);
const SERVER_AUDIT_CALL = /\b(?:audit|logAudit|logAction|writeAudit)[A-Za-z0-9_$]*\s*\(/gi;
const SERVER_MUTATION_AUDIT_EXEMPTIONS = new Map([
  [
    'src/app/api/audit-events/route.ts',
    'This route is the audit ingestion sink itself; recursively auditing its own audit write would create an audit loop.',
  ],
]);
const errors = [];

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) output.push(path.replaceAll('\\', '/'));
  }
  return output;
}

function source(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function rpcNames(text) {
  const names = [];
  const regex = /\.rpc\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of text.matchAll(regex)) names.push(match[1]);
  return names;
}

function unawaitedServerAuditCalls(text) {
  const violations = [];
  SERVER_AUDIT_CALL.lastIndex = 0;
  for (const match of text.matchAll(SERVER_AUDIT_CALL)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 80), index);
    if (/(?:async\s+)?function\s+$/.test(prefix)) continue;
    if (/\bawait\s+$/.test(prefix)) continue;
    violations.push(match[0].replace(/\s*\($/, ''));
  }
  return violations;
}

function mutationSignals(text) {
  const hasPostgrestMutation = /\.from\s*\([^)]*\)[\s\S]{0,1800}?\.(?:insert|update|delete|upsert)\s*\(/.test(text);
  const hasAuthAdminMutation = /auth\.admin\.(?:createUser|updateUserById|deleteUser|inviteUserByEmail)\s*\(/.test(text);
  const hasUnknownRpc = rpcNames(text).some(name => !READ_ONLY_RPCS.has(name));
  const hasOssMutation = /\bclient\.(?:put|copy|delete|deleteMulti|multipartUpload)\s*\(/.test(text);
  return { hasPostgrestMutation, hasAuthAdminMutation, hasUnknownRpc, hasOssMutation };
}

const supabaseClient = source('src/services/supabaseClient.ts');
const auditQueue = source('src/utils/audit.ts');
if (!supabaseClient.includes('createAuditAwareFetch')) errors.push('shared Supabase client no longer wires createAuditAwareFetch');
if (!auditQueue.includes('subscribeSupabaseMutations')) errors.push('audit queue no longer subscribes to automatic Supabase mutation coverage');

const allSources = walk('src').filter(path => !path.includes('/__tests__/') && !/\.(test|spec)\.[jt]sx?$/.test(path));
for (const path of allSources) {
  if (path === 'src/services/supabaseClient.ts') continue;
  const text = source(path);
  const isClient = /^\s*['"]use client['"];?/m.test(text);
  if (isClient && /\bcreateClient\s*\(/.test(text)) {
    errors.push(`${path}: client code creates a Supabase client directly and would bypass the audit-aware singleton`);
  }
}

const serverRoutes = allSources.filter(path => /^src\/app\/api\/.+\/route\.[jt]s$/.test(path));
let reviewedServerMutationRoutes = 0;
let exemptServerMutationRoutes = 0;
for (const path of serverRoutes) {
  const text = source(path);
  const violations = unawaitedServerAuditCalls(text);
  if (violations.length > 0) {
    errors.push(`${path}: server audit write is unawaited (${[...new Set(violations)].join(', ')}); await best-effort audit persistence before returning the response.`);
  }

  const signals = mutationSignals(text);
  if (!Object.values(signals).some(Boolean)) continue;
  reviewedServerMutationRoutes += 1;

  const exemption = SERVER_MUTATION_AUDIT_EXEMPTIONS.get(path);
  if (exemption) {
    exemptServerMutationRoutes += 1;
    continue;
  }

  const hasAuditSignal = /audit_logs|logAudit|logAction|AuditService|writeAudit/i.test(text);
  if (!hasAuditSignal) {
    errors.push(`${path}: server mutation route has no explicit audit signal. Add awaited audit persistence or add a narrowly reviewed route exemption in scripts/check-audit-coverage.mjs.`);
  }
}

for (const [path, rationale] of SERVER_MUTATION_AUDIT_EXEMPTIONS) {
  if (!serverRoutes.includes(path)) {
    errors.push(`${path}: stale audit exemption; route no longer exists. Remove exemption: ${rationale}`);
    continue;
  }
  const signals = mutationSignals(source(path));
  if (!Object.values(signals).some(Boolean)) {
    errors.push(`${path}: stale audit exemption; route no longer contains a recognized mutation. Remove exemption: ${rationale}`);
  }
}

if (errors.length) {
  console.error('\nAudit coverage contract failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Audit coverage contract passed: shared browser fallback is wired; ${reviewedServerMutationRoutes} server mutation route(s) reviewed across the full API baseline; ${exemptServerMutationRoutes} explicit exemption(s); server audit writes are awaited.`);
