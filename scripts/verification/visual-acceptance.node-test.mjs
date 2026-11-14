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

test('records a one-time user-authorized visual waiver for the exact PR without claiming it passed', () => {
  const reason = 'User explicitly waived independent visual review and real-device acceptance for PR #190 on 2026-11-14';
  const fields = [
    'result: waived', 'head: ' + head,
    'scope: Homepage market communication P0, PR #190',
    'reason: ' + reason,
  ];
  const candidate = {
    number: 190,
    body: record(...fields),
    head: {
      sha: head,
      ref: 'codex/market-communication-p0-20261113',
      repo: { full_name: 'ronyu870-collab/office-map-main' },
    },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 191 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'another/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(head, 'b'.repeat(40)) }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields.filter(line => !line.startsWith('reason:'))) }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(reason, 'Documentation only') }), /specifically authorized/);
  assert.match(check(record(...fields)), /specifically authorized/);
});

test('PR #191 reuses the prior visual/real-device waiver by explicit user instruction, without broadening it', () => {
  const reason = 'User explicitly authorized reusing PR #190 visual and real-device acceptance waiver for PR #191 on 2026-11-14';
  const fields = [
    'result: waived', 'head: ' + head,
    'scope: Homepage communication compact composer, PR #191',
    'reason: ' + reason,
  ];
  const candidate = {
    number: 191,
    body: record(...fields),
    head: {
      sha: head,
      ref: 'codex/communication-compact-home-20261114',
      repo: { full_name: 'ronyu870-collab/office-map-main' },
    },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 192 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, number: 190 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'another/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(head, 'b'.repeat(40)) }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace('PR #191', 'PR #192') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(reason, 'Documentation only') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields.filter(line => !line.startsWith('reason:'))) }), /specifically authorized/);
  assert.match(check(record(...fields)), /specifically authorized/);
});

test('allows the audit log exception only for PR #192 with the exact head, scope and reason', () => {
  const reason = 'User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #192';
  const body = record('result: waived', 'head: ' + head, 'scope: Audit log Codex exclusion, PR #192', 'reason: ' + reason);
  const candidate = {
    number: 192,
    body,
    head: { sha: head, ref: 'codex/audit-exclude-codex', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 194 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Not applicable') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
});

test('recognizes the default audit filter waiver only for its own PR and branch', () => {
  const candidate = {
    number: 193,
    body: record(
      'result: waived',
      'head: ' + head,
      'scope: Audit log default Codex exclusion, PR #193',
      'reason: User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #193',
    ),
    head: { sha: head, ref: 'codex/audit-exclude-codex-default', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 192 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/audit-exclude-codex' } }), /specifically authorized/);
});

test('PR #194 single-use waiver requires the matching district boundary scope and user authorization', () => {
  const reason = 'User explicitly waived independent visual review and mobile testing for PR #194 on 2026-11-14; this record applies only to the district boundary dotted-line change';
  const scope = 'Map district boundary dotted lines, PR #194';
  const fields = ['result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason];
  const candidate = {
    number: 194,
    body: record(...fields),
    head: { sha: head, ref: 'codex/dotted-district-boundaries-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 195 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, number: 193 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'another/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(scope, 'Other map changes, PR #194') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields).replace(reason, 'Documentation only') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: record(...fields.filter(line => !line.startsWith('reason:'))) }), /specifically authorized/);
  assert.match(check(record(...fields)), /specifically authorized/);
});


test('PR #195 search P0 waiver requires the exact PR, branch, head, scope and reason', () => {
  const reason = 'User explicitly waived independent visual review and real-device acceptance for map search P0 fixes in PR #195 on 2026-11-14';
  const scope = 'Map search navigation and future-supply visibility P0, PR #195';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = {
    number: 195, body,
    head: { sha: head, ref: 'codex/map-search-p0-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 194 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Not applicable') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other changes') }), /specifically authorized/);
});
