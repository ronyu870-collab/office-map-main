import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const registryPath = 'scripts/search-focus-coverage.json';
const policyFiles = new Set([registryPath, 'scripts/search-focus-gate.mjs',
  'scripts/verify-search-focus-gate.mjs', '.github/workflows/verify.yml']);
const globalFiles = new Set(['src/app/globals.css', 'src/app/layout.tsx', 'src/app/template.tsx',
  'tsconfig.json', 'vitest.config.ts', 'vitest.setup.ts', 'package.json', 'package-lock.json']);
const sharedControls = new Set(['src/components/SearchBar.tsx', 'src/components/ui/SearchableSelect.tsx']);
const source = path => /^src\/.*\.(?:[cm]?[jt]sx?|css)$/.test(path)
  && !/\/__(?:tests|mocks)__\/|\.(?:test|spec)\.[jt]sx?$|\.d\.ts$/.test(path);
const testFile = path => /^src\/[^\0]+\.(?:test|spec)\.[jt]sx?$/.test(path) && posix.normalize(path) === path;
const control = /<(?:[\w.]*?(?:SearchBar|Search(?:Box|Field|Input)|Searchable\w*|QuickFilter\w*))\b/;
const editable = /<(?:input|Input|TextField|Combobox|Autocomplete|[\w.]*FilterInput)\b/;
const sharedImport = /\bimport\b[^;]*\b(?:SearchBar|SearchableSelect)\b[^;]*\bfrom\b/;
const query = /\b(?:search\w*|\w*(?:SearchTerm|SearchQuery|FilterText|FilterKeyword)|query|keyword|quickFilter\w*|textFilter\w*|filter(?:Value|Query|Term)|inputMode\s*=\s*['"]search|type\s*=\s*['"]search)\b|搜索|筛选|检索|查找|关键词/i;

function isEntry(path, text) {
  return /\.[jt]sx$/.test(path) && !sharedControls.has(path) &&
    (control.test(text) || sharedImport.test(text) || (editable.test(text) && query.test(text)) ||
      /\b(?:quickFilterText|agTextColumnFilter)\b/.test(text));
}

function references(path, text, files) {
  const imports = path.endsWith('.css')
    ? [...text.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    : ts.preProcessFile(text, true, true).importedFiles.map(entry => entry.fileName);
  return new Set(imports.flatMap(specifier => {
    const stem = specifier.startsWith('@/') ? specifier.slice(2) : specifier.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(path), specifier)) : null;
    if (!stem) return [];
    const result = [stem, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'].flatMap(ext =>
      [stem + ext, stem + '/index' + ext])].find(candidate => files.has(candidate));
    return result ? [result] : [];
  }));
}

function graph(files) {
  const forward = new Map();
  const reverse = new Map();
  for (const [path, content] of files) {
    const dependencies = references(path, content, files);
    forward.set(path, dependencies);
    for (const dependency of dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(path);
    }
  }
  return { forward, reverse };
}

function intersects(root, edges, changed) {
  const pending = [root];
  const seen = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (changed.has(path)) return true;
    if (seen.has(path)) continue;
    seen.add(path);
    pending.push(...(edges.get(path) ?? []));
  }
  return false;
}

function validateRegistry(entries, required) {
  if (!Array.isArray(entries) || (required && !entries.length)) throw new Error('Coverage registry must contain entries.');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
      !Array.isArray(entry.roots) || !entry.roots.length ||
      !entry.roots.every(p => typeof p === 'string' && source(p) && posix.normalize(p) === p) ||
      typeof entry.file !== 'string' || !testFile(entry.file) ||
      !Array.isArray(entry.cases) || !entry.cases.length || !entry.cases.every(c => typeof c === 'string' && c.trim()) ||
      new Set(entry.cases).size !== entry.cases.length) throw new Error(`Invalid coverage registry entry: ${JSON.stringify(entry)}`);
    ids.add(entry.id);
  }
}

export function planCoverage({ before, after, changed, previous, current }) {
  validateRegistry(previous, false);
  validateRegistry(current, true);
  const errors = [];
  const byId = new Map(current.map(entry => [entry.id, entry]));
  const covered = new Map();
  const roots = new Set();
  for (const entry of previous) {
    const next = byId.get(entry.id);
    if (!next) errors.push(`Removed registered regression: ${entry.id}`);
    else {
      for (const title of entry.cases) {
        if (!next.cases.includes(title)) errors.push(`${entry.id}: removed required case "${title}".`);
      }
      for (const root of entry.roots) {
        if (after.has(root) && !next.roots.includes(root)) errors.push(`${entry.id}: removed coverage for ${root}.`);
      }
    }
  }
  for (const entry of [...previous, ...current]) {
    for (const root of entry.roots) {
      roots.add(root);
      if (!covered.has(root)) covered.set(root, new Set());
      covered.get(root).add(entry.id);
    }
  }
  for (const entry of current) {
    if (!entry.roots.some(root => after.has(root))) errors.push(`${entry.id}: no registered entrypoint exists.`);
  }
  for (const files of [before, after]) {
    for (const [path, content] of files) if (isEntry(path, content)) roots.add(path);
  }
  const runtime = new Set([...changed].filter(source));
  const global = [...changed].some(path => globalFiles.has(path) || /^src\/styles\/.*\.css$/.test(path));
  const routeContainers = [...runtime].filter(path =>
    /^src\/app\/(?:.+\.css|(?:.*\/)?(?:layout|template)\.[jt]sx)$/.test(path));
  const policy = [...changed].some(path => policyFiles.has(path));
  const versions = runtime.size ? [graph(before), graph(after)] : [];
  const selected = new Set();
  const impacted = [];
  for (const root of [...roots].sort()) {
    if (!global && !routeContainers.some(path => root.startsWith(posix.dirname(path) + '/')) &&
      !versions.some(({ forward, reverse }) =>
      intersects(root, forward, runtime) || intersects(root, reverse, runtime))) continue;
    impacted.push(root);
    const ids = covered.get(root);
    if (!ids) errors.push(`Missing search/focus regression for affected entrypoint: ${root}`);
    else for (const id of ids) selected.add(id);
  }
  for (const entry of [...previous, ...current]) {
    if (policy || changed.has(entry.file)) selected.add(entry.id);
  }
  return { impacted, errors: [...new Set(errors)], entries: current.filter(entry => selected.has(entry.id)) };
}

export function verifyReport(entries, report, root = process.cwd()) {
  const errors = [];
  for (const entry of entries) {
    const files = report?.testResults?.filter(file => resolve(root, file.name) === resolve(root, entry.file)) ?? [];
    for (const title of entry.cases) {
      const cases = files.flatMap(file => file.assertionResults ?? []).filter(item => item.title === title);
      if (files.length !== 1 || cases.length !== 1 || cases[0].status !== 'passed') {
        errors.push(`${entry.id}: required case must run and pass exactly once: "${title}" (${cases.map(item => item.status).join(', ') || 'missing'})`);
      }
    }
  }
  return errors;
}

function run() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const paths = text => text.split('\0').filter(Boolean);
  const base = process.env.SEARCH_FOCUS_BASE_SHA;
  if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('SEARCH_FOCUS_BASE_SHA must be the exact comparison commit SHA.');
  git('merge-base', '--is-ancestor', base, 'HEAD');
  const untracked = paths(git('ls-files', '-z', '--others', '--exclude-standard'));
  const changed = new Set([...paths(git('diff', '--name-only', '--no-renames', '-z', base)), ...untracked]);
  const oldNames = new Set(paths(git('ls-tree', '-r', '--name-only', '-z', base)));
  const current = JSON.parse(readFileSync(registryPath, 'utf8'));
  const previous = oldNames.has(registryPath) ? JSON.parse(git('show', `${base}:${registryPath}`)) : [];
  const after = new Map(paths(git('ls-files', '-z', '--cached')).concat(untracked)
    .filter(path => source(path) && existsSync(path)).map(path => [path, readFileSync(path, 'utf8')]));
  const before = new Map([...oldNames].filter(source).map(path =>
    [path, changed.has(path) ? git('show', `${base}:${path}`) : after.get(path)]));
  const { impacted, errors, entries } = planCoverage({ before, after, changed, previous, current });
  if (impacted.length) console.log(`Affected search entrypoints:\n${impacted.map(path => `  ${path}`).join('\n')}`);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!entries.length) {
    console.log('Search focus coverage: no affected entrypoints or registered tests.');
    return;
  }
  const files = [...new Set(entries.map(entry => entry.file))];
  for (const path of files) if (!existsSync(path)) throw new Error(`Missing regression test file: ${path}`);
  console.log(`Running search focus regressions: ${entries.map(entry => entry.id).join(', ')}`);
  const dir = mkdtempSync(join(tmpdir(), 'search-focus-'));
  try {
    const report = join(dir, 'vitest.json');
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
      '--reporter=default', '--reporter=json', `--outputFile.json=${report}`, ...files], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!existsSync(report)) throw new Error(`Vitest did not generate a report (exit ${result.status}).`);
    const failures = verifyReport(entries, JSON.parse(readFileSync(report, 'utf8')));
    if (result.status !== 0 || failures.length) throw new Error(failures.join('\n') || `Vitest exited ${result.status}.`);
    console.log('Search focus coverage: all required regression cases ran and passed.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { run(); } catch (error) {
    console.error(`Search focus gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}
