import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const READ_ONLY_RPCS = new Set([
  'get_all_tables',
  'get_table_columns',
  'get_all_memo_tags',
  'verify_backup_password',
  'admin_get_auth_audit_logs',
  'get_quarterly_submission_summary',
]);
const SERVER_AUDIT_CALL = /\b(?:audit|logAudit|logAction|writeAudit)[A-Za-z0-9_$]*\s*\(/gi;
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

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles() {
  const files = new Set();
  const base = process.env.AUDIT_COVERAGE_BASE_SHA;
  if (base && !/^0+$/.test(base)) {
    for (const file of gitLines(['diff', '--name-only', `${base}..HEAD`])) files.add(file);
  } else {
    for (const file of gitLines(['diff', '--name-only', 'HEAD'])) files.add(file);
    for (const line of gitLines(['status', '--porcelain'])) files.add(line.slice(3));
    if (files.size === 0) for (const file of gitLines(['diff', '--name-only', 'HEAD^', 'HEAD'])) files.add(file);
  }
  return [...files].map(path => path.replaceAll('\\', '/'));
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
for (const path of serverRoutes) {
  const violations = unawaitedServerAuditCalls(source(path));
  if (violations.length > 0) {
    errors.push(`${path}: server audit write is unawaited (${[...new Set(violations)].join(', ')}); await best-effort audit persistence before returning the response.`);
  }
}

const changedRoutes = changedFiles().filter(path => /^src\/app\/api\/.+\/route\.[jt]s$/.test(path) && existsSync(join(ROOT, path)));
let reviewedServerMutationRoutes = 0;
for (const path of changedRoutes) {
  const text = source(path);
  const hasPostgrestMutation = /\.from\s*\([^)]*\)[\s\S]{0,1800}?\.(?:insert|update|delete|upsert)\s*\(/.test(text)
    && !/^src\/app\/api\/audit-events\/route\.[jt]s$/.test(path);
  const hasAuthAdminMutation = /auth\.admin\.(?:createUser|updateUserById|deleteUser|inviteUserByEmail)\s*\(/.test(text);
  const hasUnknownRpc = rpcNames(text).some(name => !READ_ONLY_RPCS.has(name));
  if (!hasPostgrestMutation && !hasAuthAdminMutation && !hasUnknownRpc) continue;

  reviewedServerMutationRoutes += 1;
  const hasAuditSignal = /audit_logs|logAudit|logAction|AuditService|writeAudit|audit-coverage:/i.test(text);
  if (!hasAuditSignal) {
    errors.push(`${path}: changed server mutation route has no explicit audit signal. Add audit logging or an "audit-coverage:" review comment with rationale.`);
  }
}

if (errors.length) {
  console.error('\nAudit coverage contract failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Audit coverage contract passed: shared browser fallback is wired; ${reviewedServerMutationRoutes} changed server mutation route(s) reviewed; server audit writes are awaited.`);