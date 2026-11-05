import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCoverage, verifyReport } from './search-focus-gate.mjs';

const testPath = 'src/app/map/__tests__/Search.test.tsx';
const root = 'src/app/map/Map.tsx';
const shared = 'src/components/SearchBar.tsx';
const unregistered = 'src/app/library/Library.tsx';
const model = 'src/app/map/query.ts';
const wrapper = 'src/app/map/page.tsx';
const css = 'src/app/map/Map.module.css';
const layout = 'src/app/map/layout.tsx';
const entry = { id: 'map', roots: [root], file: testPath, cases: ['continues typing'] };
const baseFiles = new Map([
  [root, 'import {SearchBar} from "@/src/components/SearchBar"; import {query} from "./query"; import "./Map.module.css"; const view = <SearchBar />;'],
  [shared, 'const view = <input type="search"/>;'],
  [model, 'export const query = [];'],
  [wrapper, 'const map = dynamic(() => import("./Map"));'],
  [css, '.input { color: black; }'],
]);
function plan(paths, after = baseFiles, before = baseFiles, current = [entry], previous = [entry]) {
  return planCoverage({ before, after, changed: new Set(paths), previous, current });
}

test('detects an imported model, an enclosing route, a stylesheet and a shared input', () => {
  for (const path of [root, shared, model, wrapper, css, layout]) {
    const result = plan([path]);
    assert.deepEqual(result.errors, [], path);
    assert.deepEqual(result.impacted, [root], path);
    assert.deepEqual(result.entries, [entry], path);
  }
});

test('a newly added or indirectly affected input requires its own coverage', () => {
  const after = new Map(baseFiles).set(unregistered,
    'import {SearchBar as TextBox} from "@/src/components/SearchBar"; const view = <TextBox />;');
  for (const path of [unregistered, shared]) {
    const result = plan([path], after);
    assert.deepEqual(result.errors, [`Missing search/focus regression for affected entrypoint: ${unregistered}`]);
  }
});

test('the old tree catches deleted controls and imports removed in the change', () => {
  const before = new Map(baseFiles).set(unregistered,
    'import {SearchBar} from "@/src/components/SearchBar"; const view = <SearchBar />;');
  const after = new Map(baseFiles).set(unregistered, 'export const view = null;');
  assert.equal(plan([unregistered], after, before).errors.length, 1);
  assert.equal(plan([shared], after, before).errors.length, 1);
  assert.equal(plan([unregistered], baseFiles, before).errors.length, 1);
});

test('editing tests or gate policy reruns required cases, but unrelated Markdown does not', () => {
  for (const path of [testPath, 'scripts/search-focus-coverage.json', '.github/workflows/verify.yml']) {
    assert.deepEqual(plan([path]).entries, [entry]);
  }
  assert.deepEqual(plan(['CHANGELOG.md']).entries, []);
  const replacement = { ...entry, id: 'new' };
  assert.deepEqual(plan(['scripts/search-focus-coverage.json'], baseFiles, baseFiles, [replacement]).errors,
    ['Removed registered regression: map']);
  const dropsCase = { ...entry, cases: ['other case'] };
  assert.deepEqual(plan(['scripts/search-focus-coverage.json'], baseFiles, baseFiles, [dropsCase]).errors,
    ['map: removed required case "continues typing".']);
});

test('a registered case must actually pass; missing, skipped, failed or duplicate cases are rejected', () => {
  const report = assertionResults => ({ testResults: [{ name: testPath, assertionResults }] });
  const row = status => ({ title: 'continues typing', status });
  assert.deepEqual(verifyReport([entry], report([row('passed')])), []);
  for (const rows of [[], [row('failed')], [row('skipped')], [row('pending')], [row('todo')], [row('passed'), row('passed')]]) {
    assert.equal(verifyReport([entry], report(rows)).length, 1);
  }
  assert.equal(verifyReport([entry], { testResults: [] }).length, 1);
});
