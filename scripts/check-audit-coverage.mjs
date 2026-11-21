import { RELIABLE_ROUTES,unawaitedServerAuditCalls,reliableSourceGaps } from './audit-coverage-policy.mjs';
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
// Explicit managed lifecycle is allowed only through the runtime-guarded B-class helper.
const MANAGED_AUDIT_CALL = /\bscheduleAuditBestEffort\s*\(/;
const TRANSACTION_AUDIT_RPCS = new Set(['submit_quarterly_batch_v2', 'lease_expiry_review_save', 'admin_rename_building']);

const SERVER_MUTATION_AUDIT_EXEMPTIONS = new Map([
  [
    'src/app/api/audit-events/route.ts',
    'This route is the audit ingestion sink itself; recursively auditing its own audit write would create an audit loop.',
  ],
]);
// A route is not covered merely because its source contains the word audit.
// These contracts complement the actual HTTP/PG tests; they do not prove control flow.

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
    errors.push(`${path}: server audit write is unawaited (${[...new Set(violations)].join(', ')}); critical/reliable writes must be awaited; ordinary events must use scheduleAuditBestEffort (Next after), never a detached promise.`);
  }

  const signals = mutationSignals(text);
  if (!Object.values(signals).some(Boolean)) continue;
  reviewedServerMutationRoutes += 1;

  const exemption = SERVER_MUTATION_AUDIT_EXEMPTIONS.get(path);
  if (exemption) {
    exemptServerMutationRoutes += 1;
    continue;
  }

  const hasTransactionAudit = rpcNames(text).some(name => TRANSACTION_AUDIT_RPCS.has(name));
  const required=RELIABLE_ROUTES.get(path);
  const hasAuditSignal = Boolean(required && reliableSourceGaps(path,text).length===0) || hasTransactionAudit;
  if (!hasAuditSignal) {
    errors.push(`${path}: server mutation route has no explicit audit signal. Add a reliable transaction/server source or guarded managed B-class delivery, or a narrowly reviewed exemption in scripts/check-audit-coverage.mjs.`);
  }
}

for(const [path,markers] of RELIABLE_ROUTES){
 if(!serverRoutes.includes(path))errors.push(`${path}: stale reliable audit contract`);
 else if(!markers.every(marker=>source(path).includes(marker)))errors.push(`${path}: critical audit source missing or changed; update the reliable contract and behavioral regression together`);
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

console.log(`Audit coverage contract passed: shared browser fallback is wired; ${reviewedServerMutationRoutes} server mutation route(s) reviewed across the full API baseline; ${exemptServerMutationRoutes} explicit exemption(s); critical routes match explicit reliable-source contracts; managed ordinary delivery is runtime guarded; known transaction sources are supported.`);
