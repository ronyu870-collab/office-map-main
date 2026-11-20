import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDocs = new Set(['AGENTS.md', 'README.md', 'CHANGELOG.md', '.github/pull_request_template.md']);
const ordinaryMode = mode => mode === '100644' || mode === '000000';

export function classifyChanges(changes) {
  return changes.length > 0 && changes.every(({ path, oldMode, newMode }) =>
    ordinaryMode(oldMode) && ordinaryMode(newMode) &&
    (rootDocs.has(path) || /^docs\/[^\0]+\.md$/.test(path)));
}

export function getScope(base, { cwd = process.cwd(), head = 'HEAD' } = {}) {
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
    return { docsOnly: classifyChanges(changes), paths: changes.map(change => change.path) };
  } catch (error) {
    // A missing/shallow/invalid base must never skip runtime verification.
    return { docsOnly: false, reason: error.message };
  }
}

export function checkResults(needs) {
  if (needs?.changes?.result !== 'success') throw new Error('Change classification or its regressions failed.');
  const docsOnly = needs.changes.outputs?.docs_only === 'true';
  for (const job of ['search-focus', 'engineering', 'ai-query-auth', 'lease-expiry-auth']) {
    const result = needs[job]?.result;
    if (result !== 'success' && !(docsOnly && result === 'skipped')) {
      throw new Error(`${job}: ${result ?? 'missing'}`);
    }
  }
  return docsOnly ? 'Documentation only: runtime checks were not required.' : 'All required engineering and real Auth regressions passed.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === '--check-results') {
    console.log(checkResults(JSON.parse(process.env.CI_JOB_RESULTS)));
  } else {
    const scope = getScope(process.env.CI_COMPARISON_SHA);
    console.log(JSON.stringify(scope));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${scope.docsOnly}\n`);
  }
}
