import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getScope, hasAffectedTestCoverage } from './ci-scope.mjs';

const base = execFileSync('git', ['rev-parse', '--verify', process.argv[2] || process.env.CI_COMPARISON_SHA || 'origin/main'], { encoding: 'utf8' }).trim();
const scope = getScope(base, { quickRequested: true });
if (!scope.quickOnly) throw new Error('Change exceeds quick-update scope; use the normal verification workflow.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const code = scope.paths.filter(path => /\.tsx?$/.test(path));
run('npm', ['run', 'typecheck']);
if (code.length) run('npx', ['--no-install', 'eslint', ...code]);
// Vitest follows static imports. A zero-test/unknown report or a missing changed
// test falls back to the full suite; real test failures remain blocking.
const files = scope.paths.filter(path => path.startsWith('src/'));
const changedTests = files.filter(path => /\.(test|spec)\.tsx?$/.test(path));
const dir = mkdtempSync(join(tmpdir(), 'ci-related-'));
try {
  const report = join(dir, 'results.json');
  run('npx', ['--no-install', 'vitest', 'related', '--run', '--passWithNoTests',
    '--reporter=default', '--reporter=json', '--outputFile.json=' + report, ...files]);
  let coverage;
  try { coverage = JSON.parse(readFileSync(report, 'utf8')); } catch { /* use full suite */ }
  if (!hasAffectedTestCoverage(coverage, changedTests)) {
    console.log('Affected test coverage is uncertain; running full unit/component suite.');
    run('npm', ['run', 'test']);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
