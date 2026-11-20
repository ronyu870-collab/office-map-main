import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDocs = new Set(['AGENTS.md', 'README.md', 'CHANGELOG.md', '.github/pull_request_template.md']);
const isDoc = path => rootDocs.has(path) || /^docs\/[^\0]+\.md$/.test(path);
const ordinaryMode = mode => mode === '100644' || mode === '000000';

export function classifyChanges(changes) {
  return changes.length > 0 && changes.every(({ path, oldMode, newMode }) =>
    ordinaryMode(oldMode) && ordinaryMode(newMode) &&
    isDoc(path));
}

// An explicit quick request is a scope choice, not an approval or a security boundary.
// Unknown, shared, server and business changes keep the existing full verification.
export function isQuickChange(changes, git, base, head) {
  if (!changes.length || changes.length > 8) return false;
  let uiFiles = 0;
  let lines = 0;
  for (const { path, oldMode, newMode } of changes) {
    if (!ordinaryMode(oldMode) || !ordinaryMode(newMode)) return false;
    if (isDoc(path)) continue;
    if (!/^[a-zA-Z0-9_./()[\]-]+$/.test(path) || newMode !== '100644') return false;
    if (/^src\/.*\.(test|spec)\.tsx?$/.test(path)) continue;
    if (!/^src\/(components\/[^/]+\/|app\/)/.test(path)) return false;
    if (/(^|\/)(api|auth|admin|login|providers?|ui|layout|settings)(\/|\.)/i.test(path)) return false;
    if (!/\.(tsx|module\.css)$/.test(path) || /\/(layout|loading|error|not-found|route)\./.test(path)) return false;
    const before = oldMode === '000000' ? '' : git('show', `${base}:${path}`);
    const after = git('show', `${head}:${path}`);
    if (path.endsWith('.tsx') && ![before, after].every(text => !text || /^\s*['"]use client['"];?/.test(text))) return false;
    const patch = git('diff', '--no-ext-diff', '--unified=0', base, head, '--', path);
    const edited = patch.split('\n').filter(line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line));
    lines += edited.length;
    // Avoid choosing the lightweight suite for edits to data, auth or persistence.
    if (edited.some(line => /\b(fetch|supabase|rpc|localStorage|sessionStorage|useSWR|useQuery|useMutation|permission\w*|authorize\w*|audit\w*|signIn|signOut)\b|@\/.*(services|lib|hooks|providers)|use server|process\.env|https?:\/\//i.test(line))) return false;
    uiFiles++;
  }
  return uiFiles > 0 && lines <= 200;
}

export function getScope(base, { cwd = process.cwd(), head = 'HEAD', quickRequested = false } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  try {
    if (!/^[0-9a-f]{40}$/.test(base ?? '') || /^0+$/.test(base)) throw new Error('Missing comparison commit');
    git('merge-base', '--is-ancestor', base, head);
    // No rename detection: both the removed and the added path must qualify.
    const records = git('diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head).split('\0');
    const changes = [];
    for (let i = 0; i < records.length - 1; i += 2) {
      const match = /^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} [AMDT]$/.exec(records[i]);
      if (!match || !records[i + 1]) throw new Error('Unexpected Git change record');
      changes.push({ path: records[i + 1], oldMode: match[1], newMode: match[2] });
    }
    const docsOnly = classifyChanges(changes);
    return { docsOnly, quickOnly: !docsOnly && quickRequested && isQuickChange(changes, git, base, head), paths: changes.map(change => change.path) };
  } catch (error) {
    // A missing/shallow/invalid base must never skip runtime verification.
    return { docsOnly: false, quickOnly: false, reason: error.message };
  }
}

export function checkResults(needs) {
  if (needs?.changes?.result !== 'success') throw new Error('Change classification or its regressions failed.');
  const docsOnly = needs.changes.outputs?.docs_only === 'true';
  const quickOnly = needs.changes.outputs?.quick_only === 'true';
  if (docsOnly && quickOnly) throw new Error('Conflicting verification scopes.');
  const required = docsOnly ? [] : quickOnly ? ['search-focus', 'quick'] : ['search-focus', 'engineering', 'ai-query-auth', 'lease-expiry-auth'];
  for (const job of ['search-focus', 'quick', 'engineering', 'ai-query-auth', 'lease-expiry-auth']) {
    const result = needs[job]?.result;
    if (result !== (required.includes(job) ? 'success' : 'skipped')) throw new Error(`${job}: ${result ?? 'missing'}`);
  }
  return docsOnly ? 'Documentation only: runtime checks were not required.' : quickOnly ? 'Quick update: types, changed-file lint and affected regressions passed.' : 'All required engineering and real Auth regressions passed.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === '--check-results') {
    console.log(checkResults(JSON.parse(process.env.CI_JOB_RESULTS)));
  } else {
    const scope = getScope(process.env.CI_COMPARISON_SHA, { quickRequested: process.env.CI_QUICK_REQUESTED === 'true' });
    console.log(JSON.stringify(scope));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${scope.docsOnly}\nquick_only=${scope.quickOnly}\n`);
  }
}
