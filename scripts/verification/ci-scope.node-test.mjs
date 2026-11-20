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

const jobs = ['search-focus', 'engineering', 'ai-query-auth', 'lease-expiry-auth'];
function results(docsOnly = false) {
  return { quick: { result: 'skipped' }, changes: { result: 'success', outputs: { docs_only: String(docsOnly) } },
    ...Object.fromEntries(jobs.map(job => [job, { result: docsOnly ? 'skipped' : 'success' }])) };
}

test('required status passes only full success or an explicitly classified docs-only skip', () => {
  assert.match(checkResults(results()), /passed/);
  assert.match(checkResults(results(true)), /Documentation only/);
  for (const docsOnly of [false, true]) {
    for (const job of jobs) {
      for (const result of ['failure', 'cancelled', undefined, ...(docsOnly ? [] : ['skipped'])]) {
        const needs = results(docsOnly);
        needs[job].result = result;
        assert.throws(() => checkResults(needs), new RegExp(job));
      }
    }
    const needs = results(docsOnly);
    needs.changes.result = 'failure';
    assert.throws(() => checkResults(needs), /classification/);
  }
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
test('quick summary requires its checks and rejects any failed, cancelled or missing job', () => {
  const needs = results(true);
  needs.changes.outputs = { docs_only: 'false', quick_only: 'true' };
  needs.quick.result = 'success';
  needs['search-focus'].result = 'success';
  assert.match(checkResults(needs), /Quick update/);
  for (const job of ['quick', ...jobs]) {
    for (const result of ['failure', 'cancelled', undefined]) {
      const bad = structuredClone(needs);
      bad[job].result = result;
      assert.throws(() => checkResults(bad), new RegExp(job));
    }
  }
  for (const job of ['quick', 'search-focus']) {
    const bad = structuredClone(needs);
    bad[job].result = 'skipped';
    assert.throws(() => checkResults(bad), new RegExp(job));
  }
  needs.changes.outputs.docs_only = 'true';
  assert.throws(() => checkResults(needs), /Conflicting/);
});
