import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkVisualAcceptance } from './visual-acceptance.mjs';

const head = 'a'.repeat(40);
const record = (...lines) => ['```visual-acceptance', ...lines, '```'].join('\n');
const check = body => checkVisualAcceptance({ body, head: { sha: head } });

test('Experience P1 waiver is limited to PR #206, exact source/main/head and all three authorized manual checks', () => {
  const scope = 'Colliers AI conversational experience 2.0 P1 continuous workspace, PR #206';
  const reason = 'User explicitly waived independent visual review, manual browser visual review and physical-phone manual acceptance for conversational experience P1 on 2026-11-17; applies only to PR #206';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 206, body, head: { sha: head, ref: 'codex/colliers-ai-experience-p1-20261117',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  for (const number of [205, 207]) assert.match(checkVisualAcceptance({ ...candidate, number }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other changes') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Please skip engineering CI') }), /specifically authorized/);
});

test('Experience P0 waiver is limited to PR #205, exact source/main/head and explicit user scope', () => {
  const scope = 'Colliers AI conversational experience 2.0 P0, PR #205';
  const reason = 'User explicitly waived independent visual review and browser review for conversational experience P0 on 2026-11-17; applies only to PR #205';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 205, body, head: { sha: head, ref: 'codex/colliers-experience-p0-20261117',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  for (const number of [204, 206]) assert.match(checkVisualAcceptance({ ...candidate, number }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other changes') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Unrelated approval') }), /specifically authorized/);
});

test('Colliers AI clarification fix waiver is limited to PR #204, exact branch/head/main and unchanged declared scope', () => {
  const scope = 'Colliers AI clarification response protocol and failure guidance, PR #204';
  const reason = 'User explicitly waived independent visual review and mobile browser testing for Colliers AI clarification bug fix on 2026-11-17; applies only to PR #204';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 204, body, head: { sha: head, ref: 'codex/fix-ai-clarification-protocol-20261117',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 205 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Unrelated interface redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Please skip review') }), /specifically authorized/);
});

test('Colliers AI P2 waiver is limited to PR #203, exact branch/head/main and disclosed manual-review scope', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Colliers AI P2 building, map, outputs and own work history, PR #203',
    'reason: User explicitly waived independent visual review, manual browser visual review and physical-phone manual acceptance for Colliers AI P2 on 2026-11-15; applies only to PR #203');
  const candidate = { number: 203, body, head: { sha: head, ref: 'codex/colliers-ai-p2-20261116', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 204 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('scope: Colliers AI P2 building, map, outputs and own work history, PR #203', 'scope: Unrelated interface redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('reason: User explicitly waived independent visual review, manual browser visual review and physical-phone manual acceptance for Colliers AI P2 on 2026-11-15; applies only to PR #203', 'reason: Please skip review') }), /specifically authorized/);
});

test('Colliers AI P1 cross-trend continuation waiver is limited to PR #202, exact branch/head/main and declared scope', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Colliers AI P1 cross-dimensional quarterly trends, PR #202',
    'reason: User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested remaining work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #202');
  const candidate = { number: 202, body, head: { sha: head, ref: 'codex/colliers-ai-p1-cross-trends', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 203 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('scope: Colliers AI P1 cross-dimensional quarterly trends, PR #202', 'scope: Unrelated interface redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('reason: User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested remaining work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #202', 'reason: Please skip review') }), /specifically authorized/);
});

test('Colliers AI P1 continuation waiver is limited to PR #201, exact branch/head/main and disclosed inherited scope', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Colliers AI P1 follow-up multi-metric analysis and verification, PR #201',
    'reason: User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested unresolved work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #201');
  const candidate = { number: 201, body, head: { sha: head, ref: 'codex/colliers-ai-p1-followup', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 202 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('scope: Colliers AI P1 follow-up multi-metric analysis and verification, PR #201', 'scope: Unrelated interface redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('reason: User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested unresolved work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #201', 'reason: Please skip review') }), /specifically authorized/);
});

test('Colliers AI P1 waiver is limited to PR #200, exact branch/head/main and the authorized scope and reason', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Colliers AI P1 semantic conversation and trusted research, PR #200',
    'reason: User explicitly waived independent visual review, browser visual review and physical-phone manual acceptance for Colliers AI P1 on 2026-11-15; applies only to PR #200');
  const candidate = { number: 200, body, head: { sha: head, ref: 'codex/colliers-ai-p1', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 201 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('scope: Colliers AI P1 semantic conversation and trusted research, PR #200', 'scope: Unrelated interface redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('reason: User explicitly waived independent visual review, browser visual review and physical-phone manual acceptance for Colliers AI P1 on 2026-11-15; applies only to PR #200', 'reason: Please skip review') }), /specifically authorized/);
});

test('requires one record and rejects a pending or stale result', () => {
  assert.match(check(''), /exactly one/);
  assert.match(check(record('result: pending', 'head: ' + head)), /pending/);
  assert.match(check(record('result: passed', 'head: old', 'scope: 首页', 'reviewer: Alice', 'evidence: https://example.com/review')), /current PR head/);
  assert.match(check(record('result: not-applicable', 'head: ' + head, 'reason: docs only') + '\n' + record('result: passed')), /exactly one/);
});

test('accepts a scoped review tied to the head and HTTPS evidence', () => {
  assert.equal(check(record('result: passed', 'head: ' + head, 'scope: 首页桌面与手机', 'reviewer: Independent reviewer', 'evidence: https://example.com/review')), null);
  assert.match(check(record('result: passed', 'head: ' + head, 'reviewer: Independent reviewer', 'evidence: https://example.com/review')), /affected pages/);
  assert.match(check(record('result: passed', 'head: ' + head, 'scope: 首页', 'reviewer: Independent reviewer', 'evidence: javascript:alert(1)')), /HTTPS/);
});

test('requires an explanation for non-interface changes and rejects ambiguous fields', () => {
  assert.equal(check(record('result: not-applicable', 'head: ' + head, 'reason: Changes only documentation and server calculations.')), null);
  assert.match(check(record('result: not-applicable', 'head: ' + head)), /Explain why/);
  assert.match(check(record('result: not-applicable', 'result: passed', 'head: ' + head, 'reason: docs')), /once each/);
  assert.match(check(record('result: not-applicable', 'head: ' + head, 'reason: docs', 'extra: hidden override')), /once each/);
});

test('accepts only the explicitly authorized PR 190 waiver and discloses it', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Homepage market communication P0, PR #190',
    'reason: User explicitly waived independent visual review and real-device acceptance for PR #190 on 2026-11-14');
  const approved = { number: 190, body, head: { sha: head, ref: 'codex/market-communication-p0-20261113', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 191 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('User explicitly waived independent visual review and real-device acceptance for PR #190 on 2026-11-14', 'skip it') }), /specifically authorized/);
});

test('accepts only the explicitly authorized PR 191 reuse and does not broaden PR 190', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Homepage communication compact composer, PR #191',
    'reason: User explicitly authorized reusing PR #190 visual and real-device acceptance waiver for PR #191 on 2026-11-14');
  const approved = { number: 191, body, head: { sha: head, ref: 'codex/communication-compact-home-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 192 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, number: 190 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
});

test('accepts only the explicitly authorized PR 192 audit waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Audit log Codex exclusion, PR #192',
    'reason: User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #192');
  const approved = { number: 192, body, head: { sha: head, ref: 'codex/audit-exclude-codex', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 193 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
});

test('accepts only the explicitly authorized PR 193 default audit waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Audit log default Codex exclusion, PR #193',
    'reason: User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #193');
  const approved = { number: 193, body, head: { sha: head, ref: 'codex/audit-exclude-codex-default', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 194 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'codex/audit-exclude-codex' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
});

test('accepts only the explicitly authorized PR 194 map district boundary waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Map district boundary dotted lines, PR #194',
    'reason: User explicitly waived independent visual review and mobile testing for PR #194 on 2026-11-14; this record applies only to the district boundary dotted-line change');
  const approved = { number: 194, body, head: { sha: head, ref: 'codex/dotted-district-boundaries-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 195 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('scope: Map district boundary dotted lines, PR #194', 'scope: Unrelated map redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('reason: User explicitly waived independent visual review and mobile testing for PR #194 on 2026-11-14; this record applies only to the district boundary dotted-line change', 'reason: Skip mobile testing') }), /specifically authorized/);
});

test('accepts only the explicitly authorized PR 195 search navigation waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Map search navigation and future-supply visibility P0, PR #195',
    'reason: User explicitly waived independent visual review and real-device acceptance for map search P0 fixes in PR #195 on 2026-11-14');
  const approved = { number: 195, body, head: { sha: head, ref: 'codex/map-search-p0-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 196 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('scope: Map search navigation and future-supply visibility P0, PR #195', 'scope: Unrelated map redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('reason: User explicitly waived independent visual review and real-device acceptance for map search P0 fixes in PR #195 on 2026-11-14', 'reason: Skip mobile testing') }), /specifically authorized/);
});

test('accepts only the explicitly authorized PR 196 search candidate waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Map search candidates and explicit positioning P1, PR #196',
    'reason: User explicitly authorized the same independent visual and real-device waiver as PR #195 for map search second-batch changes in PR #196 on 2026-11-14');
  const approved = { number: 196, body, head: { sha: head, ref: 'codex/map-search-p1-candidates-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 197 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('scope: Map search candidates and explicit positioning P1, PR #196', 'scope: Unrelated map redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('reason: User explicitly authorized the same independent visual and real-device waiver as PR #195 for map search second-batch changes in PR #196 on 2026-11-14', 'reason: Skip mobile testing') }), /specifically authorized/);
});

test('accepts only the explicitly authorized PR 197 viewport and search consistency waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Map third-batch viewport, popup stability and search consistency, PR #197',
    'reason: User explicitly authorized the same independent visual and real-device acceptance waiver as the previous map search batches for PR #197 on 2026-11-14');
  const approved = { number: 197, body, head: { sha: head, ref: 'codex/map-search-p2-viewport-20261114', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 198 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'another-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'someone/office-map-main' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('scope: Map third-batch viewport, popup stability and search consistency, PR #197', 'scope: Unrelated map redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('reason: User explicitly authorized the same independent visual and real-device acceptance waiver as the previous map search batches for PR #197 on 2026-11-14', 'reason: Skip mobile testing') }), /specifically authorized/);
});

test('accepts only the explicitly authorized PR #198 first-release waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Admin-only trusted data query and audit first release, PR #198',
    'reason: User explicitly waived independent visual review and mobile testing for the admin first release on 2026-11-15; applies only to PR #198');
  const approved = { number: 198, body, head: { sha: head, ref: 'codex/admin-query-first-release', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 199 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
});


test('accepts only the explicitly authorized PR #199 homepage AI P0 waiver', () => {
  const body = record('result: waived', 'head: ' + head,
    'scope: Homepage Colliers AI P0 conversation and result presentation, PR #199',
    'reason: User explicitly waived visual and browser review for homepage AI P0 on 2026-11-15; applies only to PR #199');
  const approved = { number: 199, body, head: { sha: head, ref: 'codex/home-ai-p0-20261115', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(approved), null);
  assert.match(checkVisualAcceptance({ ...approved, number: 200 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...approved, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, head: { ...approved.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...approved, body: body.replace('Homepage Colliers AI P0 conversation and result presentation, PR #199', 'Unrelated scope') }), /specifically authorized/);
});
