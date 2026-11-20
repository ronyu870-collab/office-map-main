import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkVisualAcceptance } from './visual-acceptance.mjs';

const head = 'a'.repeat(40);
const record = (...lines) => ['```visual-acceptance', ...lines, '```'].join('\n');
const check = body => checkVisualAcceptance({ body, head: { sha: head } });

test('Submarket client-ready PR #231 one-time manual review exception is exact and does not waive Verify', () => {
  const scope = 'Submarket client-ready brief P0/P1: compact four-tab map modal, approved research release gate and 16-area copy candidates, PR #231';
  const reason = 'User requested immediate main merge of PR #231 on 2026-11-20 after being informed that manual visual acceptance and Vercel preview were unavailable; this one-time release decision does not treat manual review as passed and does not waive code, permission, data or CI checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 231, body, head: { sha: head, ref: 'codex/submarket-client-brief-p0-p1-20261120',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 229 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'dev' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated work') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip all checks') }), /specifically authorized/);
});

test('PR #230 Stacking Plan visual-only waiver is exact and does not affect Verify', () => {
  const scope = 'Xiaoyun Road 33 A/B administrator Stacking Plan overview, navigation, PNG/SVG and Excel exports, PR #230';
  const reason = 'User explicitly waived independent visual acceptance and requested PR #230 merge to main on 2026-11-20; independent visual review was not performed and this waiver does not bypass Verify, permissions, audit or export checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 230, body, head: { sha: head,
    ref: 'codex/stacking-plan-executive-demo-20261120',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 229 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated scope') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Skip all checks') }), /specifically authorized/);
});

test('Basic English localization PR #228 user waiver remains single-PR and limited to manual review', () => {
  const scope = 'Homepage Chinese/English language switch for navigation, login, password settings and 244-term glossary, PR #228';
  const reason = 'User explicitly granted a one-time waiver of independent visual and physical-device manual acceptance for PR #228 on 2026-11-20; review was not performed and all engineering, authorization, database and CI checks remain mandatory';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = {
    number: 228,
    body,
    head: {
      sha: head,
      ref: 'codex/basic-en-language-glossary-20261120',
      repo: { full_name: 'ronyu870-collab/office-map-main' },
    },
    base: { ref: 'main' },
  };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 227 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated page') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'waive all CI checks') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace('result: waived', 'result: pending') }), /Visual acceptance is pending/);
});

test('Colliers AI 5.0 P0 PR #229 manual review waiver is exact, scoped and current-head only', () => {
  const scope = 'Colliers AI 5.0 P0 quarterly formal metric and unreviewed submission source isolation, PR #229';
  const reason = 'User explicitly waived manual browser, screenshot and independent visual review for Colliers AI 5.0 P0 on 2026-11-20; this PR-specific waiver does not waive typecheck, CI, permission, PG17 or production migration controls';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 229, body, head: { sha: head, ref: 'codex/ai5-p0-quarterly-data',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 228 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'release' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'other data') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Skip verification') }), /specifically authorized/);
});

test('Colliers AI 38-item PR #227 manual review waiver is exact, scoped and current-head only', () => {
  const scope = 'Colliers AI 38-item experience improvements: Markdown, history timeline, composer, research reading and responsive sidebars, PR #227';
  const reason = 'User explicitly requested all 38 improvements in one batch and waived browser and visual review on 2026-11-20; this waiver applies only to PR #227 and does not waive engineering, permission, audit or build checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 227, body, head: { sha: head, ref: 'codex/ai-experience-complete-20261120',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 226 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-feature' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Unrelated work') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Waive all CI') }), /specifically authorized/);
});

test('Colliers AI 4.0 P1 result tools PR #223 waiver is precisely bounded', () => {
  const scope = 'Colliers AI 4.0 P1 source evidence deterministic charts authorized map and research tools, PR #223';
  const reason = 'User explicitly waived independent visual review, manual browser walkthrough, screenshots and physical-phone testing for Colliers AI 4.0 on 2026-11-19; only PR #223 is covered and CI, permission, security and build checks remain mandatory';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 223, body, head: { sha: head, ref: 'codex/colliers-ai-4-p1-evidence-artifacts-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 221 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'waive all checks') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated') }), /specifically authorized/);
});

test('Colliers AI 4.0 native SSE user waiver is limited to exact PR #221 and protected scope', () => {
  const scope = 'Colliers AI 4.0 native DeepSeek SSE, tool progress and signed terminal reply, PR #221';
  const reason = 'User explicitly waived manual browser review, standalone visual review, screenshot comparison and physical phone testing for Colliers AI 4.0 staged work on 2026-11-19; waiver is limited to PR #221 and does not waive engineering, security or CI checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 221, body, head: { sha: head,
    ref: 'codex/colliers-ai-4-p2-native-stream-20261119', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 218 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'development' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Something unrelated') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip all CI') }), /specifically authorized/);
});

test('Colliers AI 4.0 P3 server costs waiver requires PR #218 exact scope', () => {
  const scope = 'Colliers AI 4.0 P3 server-side token budget, cost planning and encrypted accounting, PR #218';
  const reason = 'User explicitly waived manual browser, standalone visual, screenshot and physical-device review for staged Colliers AI 4.0 on 2026-11-19; this waiver applies solely to PR #218, not Verify, security, integration or production model checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 218, body, head: { sha: head, ref: 'codex/colliers-ai-4-p3-audit-cost-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 217 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip all checks') }), /specifically authorized/);
});

test('Stacking Plan P0/P1 PR #219 direct-merge waiver only exempts original photo and manual visual review', () => {
  const scope = 'Stacking Plan P0 source integrity and P1 building facade redesign, Admin A/B pilot, PR #219';
  const reason = 'User explicitly waived original stacking board photo archiving and independent visual acceptance and requested direct main merge of PR #219 on 2026-11-19; this one-time waiver does not waive Verify, permissions, audit or source-unverified status';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 219, body, head: { sha: head,
    ref: 'codex/stacking-plan-p0-p1-quality-facade-20261119', repo: { full_name: 'ronyu870-collab/office-map-main' } },
    base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 213 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-feature' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated feature') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'waive all tests') }), /specifically authorized/);
});


test('Map PNG comparison PR #225 manual-review waiver is exact and scoped', () => {
  const scope = 'Map floating project-list selection and A/B high-resolution PNG comparison export, PR #225';
  const reason = 'User explicitly waived manual browser and independent visual acceptance for PR #225 on 2026-11-19 and authorized main merge after code checks; engineering and security checks remain mandatory';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 225, body, head: { sha: head,
    ref: 'codex/map-list-comparison-png-20261119', repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 224 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'dev' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated work') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip all CI') }), /specifically authorized/);
});

test('Submarket PR #226 one-time manual acceptance waiver requires exact PR identity and head', () => {
  const scope = 'Submarket full-screen modal regression fixes: building return race, valid-quarter trend digest and pointer backdrop, PR #226';
  const reason = 'User explicitly requested PR #226 main merge with continued independent visual and real-device acceptance waiver on 2026-11-20; only manual review for this PR is waived and existing engineering, authorization and data protections remain unchanged';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 226, body, head: { sha: head, ref: 'codex/fix-submarket-modal-regressions-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 224 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Anything') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Skip all engineering checks') }), /specifically authorized/);
});

test('Submarket PR #224 user-authorized manual visual waiver is exact-scope and current-head only', () => {
  const scope = 'Colliers map submarket centered research modal, responsive layout and trend presentation, PR #224';
  const reason = 'User explicitly waived independent visual acceptance and requested direct main merge for PR #224 on 2026-11-19; manual visual review was not performed and all engineering, security and data checks remain mandatory';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 224, body, head: { sha: head,
    ref: 'codex/submarket-modal-visual-upgrade-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 212 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Any future PR') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'All engineering checks are waived') }), /specifically authorized/);
});

test('AI 4.0 stage P0/P1 manual review waiver is uniquely scoped to PR #217', () => {
  const scope = 'Colliers AI 4.0 P0/P1 backend model support and read-only tool registry, PR #217';
  const reason = 'User explicitly waived manual browser review, independent visual review, screenshot comparison and physical-phone testing for staged Colliers AI 4.0 on 2026-11-19; applies only to PR #217 and does not waive Verify or security checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 217, body, head: { sha: head,
    ref: 'codex/colliers-ai-4-p0-p1-release-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 211 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip all checks') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'unrelated work') }), /specifically authorized/);
});

test('Submarket PR #212 one-time manual acceptance waiver is limited to exact identity, scope, reason and head', () => {
  const scope = 'Map submarket three-stat bubbles, expandable business brief, quarterly trends and editorial maintenance, PR #212';
  const reason = 'User explicitly authorized a one-time waiver of independent visual acceptance and physical-device manual acceptance for PR #212 on 2026-11-19; those reviews were not performed and engineering, authorization and data checks remain mandatory';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 212, body, head: { sha: head, ref: 'codex/map-submarket-market-brief-20261118',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 213 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other module') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Skip every required CI check') }), /specifically authorized/);
});

test('Stacking Plan PR #213 waiver requires exact repository, branch, scope, reason and current head', () => {
  const scope = 'Xiaoyun Road 33 A/B Admin Stacking Plan and map entry, PR #213';
  const reason = 'User explicitly waived standalone independent visual acceptance review and requested direct main merge of Stacking Plan PR #213 on 2026-11-19; this one-time waiver records unperformed review and does not waive engineering, authorization or data checks';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 213, body, head: { sha: head, ref: 'codex/stacking-plan-xiaoyun33-pilot',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 211 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'other' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repo' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other module') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Waive all CI') }), /specifically authorized/);
});

test('Colliers AI 4.0 P2 history waiver requires exact PR, head, branch, and scope', () => {
  const scope = 'Colliers AI 4.0 P2 encrypted agent context and authenticated history indexing, PR #216';
  const reason = 'User explicitly waived manual browser review, independent visual review, screenshots and physical-device acceptance for staged Colliers AI 4.0 on 2026-11-19; this PR-specific waiver does not replace CI or permission validation';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 216, body, head: { sha: head, ref: 'codex/colliers-ai-4-p2-owned-history-20261119',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 215 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'test' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'skip CI') }), /specifically authorized/);
});

test('Colliers AI 4.0 core waiver is restricted to PR #211 and current exact head', () => {
  const scope = 'Colliers AI 4.0 DeepSeek-native Agent core and minimal homepage response display, PR #211';
  const reason = 'User requested expedited staged Colliers AI 4.0 delivery and allowed nonessential complex visual review to be skipped on 2026-11-18; waiver is restricted to PR #211 and does not assert visual or real-device acceptance';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 211, body, head: { sha: head, ref: 'codex/colliers-ai-4-agent-core',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  assert.match(checkVisualAcceptance({ ...candidate, number: 210 }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'unrelated-branch' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Unrelated redesign') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Skip all CI checks') }), /specifically authorized/);
});

test('Colliers AI 3.0 P2 waiver is limited to PR #210, conversation and research polish and the current exact head', () => {
  const scope = 'Colliers AI 3.0 P2 conversation and research visual polish, PR #210';
  const reason = 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P2 on 2026-11-18; applies only to PR #210';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 210, body, head: { sha: head, ref: 'codex/colliers-ai-3-p2-visual-polish',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  for (const number of [209, 211]) assert.match(checkVisualAcceptance({ ...candidate, number }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/colliers-ai-3-p1-focus-transition' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(head, head.slice(0, 7)), head: { ...candidate.head, sha: head.slice(0, 7) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other interface changes') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Please skip engineering CI') }), /specifically authorized/);
  const nextHead = 'c'.repeat(40);
  assert.equal(checkVisualAcceptance({ ...candidate, body: body.replace(head, nextHead), head: { ...candidate.head, sha: nextHead } }), null);
});

test('Colliers AI 3.0 P1 waiver is limited to PR #209, focus workspace scope and the current exact head', () => {
  const scope = 'Colliers AI 3.0 P1 focus transition and single-instance workspace, PR #209';
  const reason = 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P1 on 2026-11-18; applies only to PR #209';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 209, body, head: { sha: head, ref: 'codex/colliers-ai-3-p1-focus-transition',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  for (const number of [208, 210]) assert.match(checkVisualAcceptance({ ...candidate, number }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/colliers-ai-3-p0-compact-home' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(head, head.slice(0, 7)), head: { ...candidate.head, sha: head.slice(0, 7) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other interface changes') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Please skip engineering CI') }), /specifically authorized/);
  const nextHead = 'c'.repeat(40);
  assert.equal(checkVisualAcceptance({ ...candidate, body: body.replace(head, nextHead), head: { ...candidate.head, sha: nextHead } }), null);
});

test('Colliers AI 3.0 P0 waiver is limited to PR #208, compact homepage scope and the current exact head', () => {
  const scope = 'Colliers AI 3.0 P0 compact homepage and composer, PR #208';
  const reason = 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P0 on 2026-11-18; applies only to PR #208';
  const body = record('result: waived', 'head: ' + head, 'scope: ' + scope, 'reason: ' + reason);
  const candidate = { number: 208, body, head: { sha: head, ref: 'codex/colliers-ai-3-p0-compact-home',
    repo: { full_name: 'ronyu870-collab/office-map-main' } }, base: { ref: 'main' } };
  assert.equal(checkVisualAcceptance(candidate), null);
  for (const number of [207, 209]) assert.match(checkVisualAcceptance({ ...candidate, number }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, ref: 'codex/colliers-ai-3-p1' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, sha: 'b'.repeat(40) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(head, head.slice(0, 7)), head: { ...candidate.head, sha: head.slice(0, 7) } }), /current PR head/);
  assert.match(checkVisualAcceptance({ ...candidate, head: { ...candidate.head, repo: { full_name: 'other/repository' } } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, base: { ref: 'develop' } }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(scope, 'Other interface changes') }), /specifically authorized/);
  assert.match(checkVisualAcceptance({ ...candidate, body: body.replace(reason, 'Please skip engineering CI') }), /specifically authorized/);
  const nextHead = 'c'.repeat(40);
  assert.equal(checkVisualAcceptance({ ...candidate, body: body.replace(head, nextHead), head: { ...candidate.head, sha: nextHead } }), null);
});

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
