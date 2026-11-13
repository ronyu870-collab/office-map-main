import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkVisualAcceptance } from './visual-acceptance.mjs';

const head = 'a'.repeat(40);
const record = (...lines) => ['```visual-acceptance', ...lines, '```'].join('\n');
const check = body => checkVisualAcceptance({ body, head: { sha: head } });
const passFields = [
  'result: passed', 'head: ' + head, 'scope: 首页 / 常用工作',
  'reviewer: Hang Yu', 'evidence: https://github.com/example/repo/pull/2#issuecomment-3',
];

test('accepts the current revision with a reviewer and an evidence link', () => {
  assert.equal(check(record(...passFields).replaceAll('\n', '\r\n')), null);
});

test('rejects missing, pending and ambiguous records', () => {
  assert.match(check(null), /exactly one/);
  assert.match(check(record('result: pending')), /pending/);
  assert.match(check(record(...passFields) + '\n' + record('result: pending')), /exactly one/);
  assert.match(check(record(...passFields, 'result: not-applicable')), /once each/);
});

test('a push invalidates both a pass and a not-applicable decision', () => {
  const oldHead = 'b'.repeat(40);
  assert.match(check(record(...passFields).replace(head, oldHead)), /current PR head/);
  assert.match(check(record('result: not-applicable', 'head: ' + oldHead, 'reason: Docs only')), /current PR head/);
});

test('a pass requires a reviewer and a usable HTTPS evidence link', () => {
  assert.match(check(record(...passFields.filter(line => !line.startsWith('reviewer:')))), /person/);
  assert.match(check(record(...passFields.slice(0, -1))), /HTTPS/);
  assert.match(check(record(...passFields.slice(0, -1), 'evidence: file:///tmp/review.png')), /HTTPS/);
});

test('a non-visual PR must explain why it is out of scope', () => {
  const fields = ['result: not-applicable', 'head: ' + head];
  assert.match(check(record(...fields, 'reason: ')), /Explain/);
  assert.equal(check(record(...fields, 'reason: Corrected an internal documentation link')), null);
});
