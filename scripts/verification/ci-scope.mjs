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

// Ordinary changes use the core build/test gate; uncertainty and sensitive boundaries
// deliberately fall back to the existing full engineering and real Auth suite.
export function isHighRiskChange({ path, oldMode, newMode }, git, base, head) {
  if (!ordinaryMode(oldMode) || !ordinaryMode(newMode)) return true;
  if (isDoc(path)) return false;
  if (!/^src\/[\w./()[\]-]+\.(?:[cm]?[jt]sx?|css|json)$/.test(path) &&
      !/^public\/[\w./-]+\.(?:png|jpe?g|webp|svg|ico|woff2?)$/i.test(path)) return true;
  if (/^src\/(?:config\/|contexts\/|services\/|app\/(?:api|login|admin|settings)\/|lib\/(?:server|audit|leaseExpiry|quarterly-research|sales-materials|communication|building-photos|pitch)\/|components\/(?:data-entry|admin|layout|ui)\/)/i.test(path)) return true;
  if (/^src\/app\/(?:layout\.tsx|globals\.css)$|^src\/styles\/|^src\/components\/(?:SessionProvider|ImpersonationBanner|PageViewTracker)/i.test(path)) return true;
  if (/(?:auth|permission|authorize|credential|security|policy|audit|supabase|database|migration|mutation|persist|storage|server|verifiedData|dataSource|trustedQuery|budget)/i.test(path)) return true;
  if (!/\.[cm]?[jt]sx?$/.test(path) || /(?:\.test\.|\.spec\.|\/__tests__\/)/.test(path)) return false;
  const patch = git('diff', '--no-ext-diff', '--unified=0', base, head, '--', path);
  return patch.split('\n').filter(line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line))
    .some(line => /\b(?:supabase|rpc|createClient|service_role|authorize|authorization|permission|permissions|rls|signIn|signOut|audit|serverAudit|process\.env|localStorage|sessionStorage|useMutation|upsert|insert|deleteMany|updateMany)\b|['"](?:POST|PUT|PATCH|DELETE)['"]|use server/i.test(line));
}

function browserScopes(changes) {
  const paths = changes.map(change => change.path);
  return {
    mapBrowser: paths.some(path => /^src\/(?:components\/map\/|app\/map\/|lib\/map-)/.test(path)),
    aiBrowser: paths.some(path => /^src\/(?:components\/(?:intelligence|home)\/|app\/(?:intelligence\/|page\.tsx$)|lib\/intelligence\/)/.test(path)),
  };
}

export function getScope(base, { cwd = process.cwd(), head = 'HEAD', quickRequested = false, forceFull = false, postMerge = false, draft = false } = {}) {
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
    const docsOnly = !forceFull && classifyChanges(changes);
    const fullOnly = forceFull || (!docsOnly && !postMerge && !draft && (!changes.length || changes.some(change => isHighRiskChange(change, git, base, head))));
    return { docsOnly, fullOnly, postMerge: postMerge && !fullOnly && !forceFull, draft, quickOnly: !docsOnly && quickRequested && isQuickChange(changes, git, base, head),
      ...(!postMerge && !draft ? browserScopes(changes) : { mapBrowser: false, aiBrowser: false }), paths: changes.map(change => change.path) };
  } catch (error) {
    // A missing/shallow/invalid base must never skip runtime verification.
    return { docsOnly: false, fullOnly: true, postMerge: false, draft, quickOnly: false, mapBrowser: false, aiBrowser: false, reason: error.message };
  }
}

export function hasAffectedTestCoverage(report, changedTestPaths, cwd = process.cwd()) {
  if (!Number.isInteger(report?.numTotalTests) || report.numTotalTests < 1 || !Array.isArray(report.testResults)) return false;
  const executed = new Set(report.testResults
    .filter(test => typeof test.name === 'string' && Array.isArray(test.assertionResults) &&
      test.assertionResults.some(assertion => assertion.status === 'passed' || assertion.status === 'failed'))
    .map(test => resolve(cwd, test.name)));
  return executed.size > 0 && changedTestPaths.every(path => executed.has(resolve(cwd, path)));
}

export function checkResults(needs) {
  if (needs?.changes?.result !== 'success') throw new Error('Change classification or its regressions failed.');
  const outputs = needs.changes.outputs ?? {};
  for (const key of ['docs_only', 'full_only', 'draft']) {
    if (!['true', 'false'].includes(outputs[key])) throw new Error('Invalid or missing scope: ' + key);
  }
  const docsOnly = outputs.docs_only === 'true';
  const fullOnly = outputs.full_only === 'true';
  if (docsOnly && fullOnly) throw new Error('Conflicting verification scopes.');
  const required = docsOnly ? [] : fullOnly ? ['search-focus', 'engineering', 'full-app', 'ai-query-auth', 'lease-expiry-auth'] : ['search-focus', 'standard'];
  for (const job of ['search-focus', 'standard', 'engineering', 'full-app', 'ai-query-auth', 'lease-expiry-auth']) {
    const result = needs[job]?.result;
    if (result !== (required.includes(job) ? 'success' : 'skipped')) throw new Error(job + ': ' + (result ?? 'missing'));
  }
  // A successful lightweight draft must never be a reusable green merge gate.
  if (outputs.draft === 'true') throw new Error('Draft verification finished; mark ready for review to run the merge gate.');
  return docsOnly ? 'Documentation only: runtime checks were not required.' : fullOnly
    ? 'All required engineering and real Auth regressions passed.'
    : 'Routine engineering checks and applicable browser regressions passed.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === '--check-results') {
    console.log(checkResults(JSON.parse(process.env.CI_JOB_RESULTS)));
  } else {
    const forceFull = process.env.CI_FORCE_FULL === 'true';
    const base = process.env.CI_COMPARISON_SHA || (forceFull ? execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim() : '');
    const scope = getScope(base, { forceFull, quickRequested: true, postMerge: process.env.CI_POST_MERGE === 'true', draft: process.env.CI_DRAFT === 'true' });
    console.log(JSON.stringify(scope));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${scope.docsOnly}\nfull_only=${scope.fullOnly}\nmap_browser=${scope.mapBrowser}\nai_browser=${scope.aiBrowser}\ncomparison_sha=${base}\naffected_only=${!scope.fullOnly && scope.quickOnly}\npost_merge=${scope.postMerge}\ndraft=${scope.draft}\n`);
  }
}
