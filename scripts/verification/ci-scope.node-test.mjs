import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkResults, getScope } from './ci-scope.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci@example.invalid');
  const write = (path, text) => { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), text); };
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  write('README.md', 'before');
  write('src/runtime.ts', 'export const value = 1;');
  const base = commit();
  return { cwd, git, write, commit, base };
}

test('real Git doc-only diff skips runtime suites, including deleted docs and unusual filenames', t => {
  const f = fixture(t);
  f.write('README.md', 'after');
  f.write('docs/中文\n说明.md', 'notes');
  f.commit();
  assert.equal(getScope(f.base, f).docsOnly, true);
  rmSync(join(f.cwd, 'README.md'));
  f.commit();
  assert.equal(getScope(f.base, f).docsOnly, true);
});

for (const path of ['src/runtime.ts', 'src/content.md', 'public/data.md', 'package-lock.json', '.github/workflows/verify.yml', 'supabase/migrations/fix.sql', 'scripts/verification/ci-scope.mjs', 'docs/example.json']) {
  test(`runtime or unknown path always runs full CI: ${path}`, t => {
    const f = fixture(t);
    f.write('README.md', 'mixed change');
    f.write(path, 'changed');
    f.commit();
    assert.equal(getScope(f.base, f).docsOnly, false);
  });
}

test('renaming runtime code into docs and changing a doc into a symlink cannot use the fast path', t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, 'docs'));
  renameSync(join(f.cwd, 'src/runtime.ts'), join(f.cwd, 'docs/runtime.md'));
  f.commit();
  assert.equal(getScope(f.base, f).docsOnly, false);
  const secondBase = f.git('rev-parse', 'HEAD');
  rmSync(join(f.cwd, 'README.md'));
  symlinkSync('docs/runtime.md', join(f.cwd, 'README.md'));
  f.commit();
  assert.equal(getScope(secondBase, f).docsOnly, false);
});

test('missing, invalid, unavailable and empty comparison commits fall back to full CI', t => {
  const f = fixture(t);
  for (const base of [undefined, 'not-a-sha', '0'.repeat(40), 'a'.repeat(40), f.base]) {
    assert.equal(getScope(base, f).docsOnly, false);
  }
});

const jobs = ['search-focus', 'standard', 'engineering', 'ai-query-auth', 'lease-expiry-auth'];
function results(mode) {
  const required = mode === 'docs' ? [] : mode === 'full' ? ['search-focus', 'engineering', 'ai-query-auth', 'lease-expiry-auth'] : ['search-focus', 'standard'];
  return { changes: { result: 'success', outputs: { docs_only: String(mode === 'docs'), full_only: String(mode === 'full') } },
    ...Object.fromEntries(jobs.map(job => [job, { result: required.includes(job) ? 'success' : 'skipped' }])) };
}
test('all three scopes require exactly their applicable jobs and reject missing, cancelled and failed jobs', () => {
  for (const mode of ['docs', 'standard', 'full']) {
    assert.match(checkResults(results(mode)), /passed|Documentation only/);
    for (const job of jobs) {
      const good = results(mode);
      for (const result of ['failure', 'cancelled', undefined, good[job].result === 'success' ? 'skipped' : 'success']) {
        const bad = structuredClone(good);
        bad[job].result = result;
        assert.throws(() => checkResults(bad), new RegExp(job));
      }
    }
  }
  const bad = results('standard');
  delete bad.changes.outputs.full_only;
  assert.throws(() => checkResults(bad), /scope/);
  const conflict = results('full');
  conflict.changes.outputs.docs_only = 'true';
  assert.throws(() => checkResults(conflict), /Conflicting/);
  const broken = results('standard');
  broken.changes.result = 'failure';
  assert.throws(() => checkResults(broken), /classification/);
});

const uiPath = 'src/components/home/Title.tsx';
const client = title => `'use client';\nexport default function Title() { return <h1>${title}</h1>; }\n`;
function uiFixture(t) {
  const f = fixture(t);
  f.write(uiPath, client('Before'));
  f.base = f.commit();
  f.write(uiPath, client('After'));
  return f;
}
test('quick mode requires an explicit request and accepts actual client UI with related tests and docs', t => {
  const f = uiFixture(t);
  f.write('src/__tests__/title.test.tsx', 'export {};');
  f.write('README.md', 'UI note');
  f.commit();
  assert.equal(getScope(f.base, f).quickOnly, false);
  assert.equal(getScope(f.base, { ...f, quickRequested: true }).quickOnly, true);
});
for (const path of ['src/lib/permissions.ts', 'src/app/api/test/route.ts', 'src/components/ui/Button.tsx', 'src/components/auth/Login.tsx', 'src/app/layout.tsx', 'package.json', '.github/workflows/verify.yml', 'supabase/migrations/example.sql']) {
  test(`mixed quick request still runs full checks: ${path}`, t => {
    const f = uiFixture(t);
    f.write(path, client('Other'));
    f.commit();
    assert.equal(getScope(f.base, { ...f, quickRequested: true }).quickOnly, false);
  });
}
for (const content of ['export default function Title() { return <h1>Server</h1>; }', client('{fetch("/api/data")}'), client('{localStorage.getItem("x")}'), client('{permissions.canEdit}'), client('long\n'.repeat(201))]) {
  test('server, data, permission and oversized edits cannot use quick mode', t => {
    const f = uiFixture(t);
    f.write(uiPath, content);
    f.commit();
    assert.equal(getScope(f.base, { ...f, quickRequested: true }).quickOnly, false);
  });
}
test('deletion and symlink changes fall back to full even when quick was requested', t => {
  const f = uiFixture(t);
  rmSync(join(f.cwd, uiPath));
  f.commit();
  assert.equal(getScope(f.base, { ...f, quickRequested: true }).quickOnly, false);
  symlinkSync('../../runtime.ts', join(f.cwd, uiPath));
  f.commit();
  assert.equal(getScope(f.base, { ...f, quickRequested: true }).quickOnly, false);
});
test('ordinary feature changes select standard CI, including large map and home updates', t => {
  const f = fixture(t);
  f.write('src/components/map/Workspace.tsx', client('Map'));
  f.write('src/components/home/Answer.tsx', client('Home'));
  f.commit();
  const scope = getScope(f.base, f);
  assert.equal(scope.docsOnly, false);
  assert.equal(scope.fullOnly, false);
  assert.equal(scope.mapBrowser, true);
  assert.equal(scope.aiBrowser, true);
});
for (const path of ['supabase/migrations/change.sql', 'src/app/api/foo/route.ts', 'src/lib/permissions.ts', 'src/services/buildings.ts', 'src/lib/server/query.ts', 'src/components/ui/Overlay.tsx', 'src/lib/pitch/export.ts', 'package-lock.json', '.github/workflows/verify.yml', 'scripts/verification/ci-scope.mjs', 'unknown/path.txt']) {
  test('full CI remains required for sensitive or unknown change: ' + path, t => {
    const f = fixture(t);
    f.write(path, 'changed');
    f.commit();
    assert.equal(getScope(f.base, f).fullOnly, true);
  });
}
test('sensitive calls in otherwise ordinary components trigger full verification', t => {
  const f = uiFixture(t);
  f.write(uiPath, client('{supabase.rpc("change")}'));
  f.commit();
  assert.equal(getScope(f.base, f).fullOnly, true);
});
test('scheduled/manual runs are full, main pushes reuse the standard path, and invalid comparisons fail closed', t => {
  const f = fixture(t);
  f.write('src/app/api/foo/route.ts', 'changed');
  f.commit();
  assert.equal(getScope(f.base, { ...f, forceFull: true, postMerge: true }).fullOnly, true);
  assert.equal(getScope(f.base, { ...f, postMerge: true }).fullOnly, false);
  assert.equal(getScope('invalid', { ...f, postMerge: true }).fullOnly, true);
  f.write('README.md', 'updated');
  const last = f.git('rev-parse', 'HEAD');
  f.commit();
  assert.equal(getScope(last, { ...f, forceFull: true }).fullOnly, true);
});

test('draft uses routine checks; ready-for-review restores sensitive checks', t => {
  const f = fixture(t);
  f.write('src/app/api/foo/route.ts', 'changed');
  f.commit();
  assert.equal(getScope(f.base, { ...f, draft: true }).fullOnly, false);
  assert.equal(getScope(f.base, f).fullOnly, true);
});
