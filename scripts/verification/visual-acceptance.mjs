import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const fields = new Set(['result', 'head', 'scope', 'reviewer', 'evidence', 'reason']);

export function checkVisualAcceptance(pr) {
  const body = pr?.body ?? '';
  const blocks = [...body.matchAll(/^\x60{3}visual-acceptance[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*\r?$/gm)];
  if (blocks.length !== 1) {
    return 'Add exactly one visual-acceptance record from the PR template.';
  }

  const record = new Map();
  for (const line of blocks[0][1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^([a-z]+):[ \t]*(.*)$/.exec(line);
    if (!field || !fields.has(field[1]) || record.has(field[1])) {
      return 'Use the fields from the PR template once each, on separate lines.';
    }
    record.set(field[1], field[2].trim());
  }

  const result = record.get('result');
  // Preserve the existing pending/invalid-result response before checking
  // the SHA, so the original validation contract remains unchanged.
  if (result !== 'passed' && result !== 'not-applicable' && result !== 'waived') {
    return 'Visual acceptance is pending. Record passed or explain why the change is not applicable.';
  }
  if (!/^[0-9a-f]{40}$/.test(pr?.head?.sha ?? '') || record.get('head') !== pr.head.sha) {
    return 'Record the full SHA of the current PR head and confirm the conclusion for that revision.';
  }

  // PR-specific, explicitly user-authorized acceptance waivers. A waiver
  // never claims that independent visual review or physical-device testing passed.
  // Allow only this repository, main target, exact head SHA and declared scope.
  if (result === 'waived') {
    const authorizedWaivers = [
      {
        number: 230,
        branch: 'codex/stacking-plan-executive-demo-20261120',
        scope: 'Xiaoyun Road 33 A/B administrator Stacking Plan overview, navigation, PNG/SVG and Excel exports, PR #230',
        reason: 'User explicitly waived independent visual acceptance and requested PR #230 merge to main on 2026-11-20; independent visual review was not performed and this waiver does not bypass Verify, permissions, audit or export checks',
      },
      {
        number: 228,
        branch: 'codex/basic-en-language-glossary-20261120',
        scope: 'Homepage Chinese/English language switch for navigation, login, password settings and 244-term glossary, PR #228',
        reason: 'User explicitly granted a one-time waiver of independent visual and physical-device manual acceptance for PR #228 on 2026-11-20; review was not performed and all engineering, authorization, database and CI checks remain mandatory',
      },
      {
        number: 229,
        branch: 'codex/ai5-p0-quarterly-data',
        scope: 'Colliers AI 5.0 P0 quarterly formal metric and unreviewed submission source isolation, PR #229',
        reason: 'User explicitly waived manual browser, screenshot and independent visual review for Colliers AI 5.0 P0 on 2026-11-20; this PR-specific waiver does not waive typecheck, CI, permission, PG17 or production migration controls',
      },
      {
        number: 227,
        branch: 'codex/ai-experience-complete-20261120',
        scope: 'Colliers AI 38-item experience improvements: Markdown, history timeline, composer, research reading and responsive sidebars, PR #227',
        reason: 'User explicitly requested all 38 improvements in one batch and waived browser and visual review on 2026-11-20; this waiver applies only to PR #227 and does not waive engineering, permission, audit or build checks',
      },
      {
        number: 226,
        branch: 'codex/fix-submarket-modal-regressions-20261119',
        scope: 'Submarket full-screen modal regression fixes: building return race, valid-quarter trend digest and pointer backdrop, PR #226',
        reason: 'User explicitly requested PR #226 main merge with continued independent visual and real-device acceptance waiver on 2026-11-20; only manual review for this PR is waived and existing engineering, authorization and data protections remain unchanged',
      },
      {
        number: 225,
        branch: 'codex/map-list-comparison-png-20261119',
        scope: 'Map floating project-list selection and A/B high-resolution PNG comparison export, PR #225',
        reason: 'User explicitly waived manual browser and independent visual acceptance for PR #225 on 2026-11-19 and authorized main merge after code checks; engineering and security checks remain mandatory',
      },
      {
        number: 223,
        branch: 'codex/colliers-ai-4-p1-evidence-artifacts-20261119',
        scope: 'Colliers AI 4.0 P1 source evidence deterministic charts authorized map and research tools, PR #223',
        reason: 'User explicitly waived independent visual review, manual browser walkthrough, screenshots and physical-phone testing for Colliers AI 4.0 on 2026-11-19; only PR #223 is covered and CI, permission, security and build checks remain mandatory',
      },
      {
        number: 221,
        branch: 'codex/colliers-ai-4-p2-native-stream-20261119',
        scope: 'Colliers AI 4.0 native DeepSeek SSE, tool progress and signed terminal reply, PR #221',
        reason: 'User explicitly waived manual browser review, standalone visual review, screenshot comparison and physical phone testing for Colliers AI 4.0 staged work on 2026-11-19; waiver is limited to PR #221 and does not waive engineering, security or CI checks',
      },
      {
        number: 218,
        branch: 'codex/colliers-ai-4-p3-audit-cost-20261119',
        scope: 'Colliers AI 4.0 P3 server-side token budget, cost planning and encrypted accounting, PR #218',
        reason: 'User explicitly waived manual browser, standalone visual, screenshot and physical-device review for staged Colliers AI 4.0 on 2026-11-19; this waiver applies solely to PR #218, not Verify, security, integration or production model checks',
      },
      {
        number: 219,
        branch: 'codex/stacking-plan-p0-p1-quality-facade-20261119',
        scope: 'Stacking Plan P0 source integrity and P1 building facade redesign, Admin A/B pilot, PR #219',
        reason: 'User explicitly waived original stacking board photo archiving and independent visual acceptance and requested direct main merge of PR #219 on 2026-11-19; this one-time waiver does not waive Verify, permissions, audit or source-unverified status',
      },

      {
        number: 224,
        branch: 'codex/submarket-modal-visual-upgrade-20261119',
        scope: 'Colliers map submarket centered research modal, responsive layout and trend presentation, PR #224',
        reason: 'User explicitly waived independent visual acceptance and requested direct main merge for PR #224 on 2026-11-19; manual visual review was not performed and all engineering, security and data checks remain mandatory',
      },
      {
        number: 216,
        branch: 'codex/colliers-ai-4-p2-owned-history-20261119',
        scope: 'Colliers AI 4.0 P2 encrypted agent context and authenticated history indexing, PR #216',
        reason: 'User explicitly waived manual browser review, independent visual review, screenshots and physical-device acceptance for staged Colliers AI 4.0 on 2026-11-19; this PR-specific waiver does not replace CI or permission validation',
      },
      {
        number: 217,
        branch: 'codex/colliers-ai-4-p0-p1-release-20261119',
        scope: 'Colliers AI 4.0 P0/P1 backend model support and read-only tool registry, PR #217',
        reason: 'User explicitly waived manual browser review, independent visual review, screenshot comparison and physical-phone testing for staged Colliers AI 4.0 on 2026-11-19; applies only to PR #217 and does not waive Verify or security checks',
      },
      {
        number: 212,
        branch: 'codex/map-submarket-market-brief-20261118',
        scope: 'Map submarket three-stat bubbles, expandable business brief, quarterly trends and editorial maintenance, PR #212',
        reason: 'User explicitly authorized a one-time waiver of independent visual acceptance and physical-device manual acceptance for PR #212 on 2026-11-19; those reviews were not performed and engineering, authorization and data checks remain mandatory',
      },
      {
        number: 213,
        branch: 'codex/stacking-plan-xiaoyun33-pilot',
        scope: 'Xiaoyun Road 33 A/B Admin Stacking Plan and map entry, PR #213',
        reason: 'User explicitly waived standalone independent visual acceptance review and requested direct main merge of Stacking Plan PR #213 on 2026-11-19; this one-time waiver records unperformed review and does not waive engineering, authorization or data checks',
      },
      {
        number: 211,
        branch: 'codex/colliers-ai-4-agent-core',
        scope: 'Colliers AI 4.0 DeepSeek-native Agent core and minimal homepage response display, PR #211',
        reason: 'User requested expedited staged Colliers AI 4.0 delivery and allowed nonessential complex visual review to be skipped on 2026-11-18; waiver is restricted to PR #211 and does not assert visual or real-device acceptance',
      },
      {
        number: 210,
        branch: 'codex/colliers-ai-3-p2-visual-polish',
        scope: 'Colliers AI 3.0 P2 conversation and research visual polish, PR #210',
        reason: 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P2 on 2026-11-18; applies only to PR #210',
      },
      {
        number: 209,
        branch: 'codex/colliers-ai-3-p1-focus-transition',
        scope: 'Colliers AI 3.0 P1 focus transition and single-instance workspace, PR #209',
        reason: 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P1 on 2026-11-18; applies only to PR #209',
      },
      {
        number: 208,
        branch: 'codex/colliers-ai-3-p0-compact-home',
        scope: 'Colliers AI 3.0 P0 compact homepage and composer, PR #208',
        reason: 'User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P0 on 2026-11-18; applies only to PR #208',
      },
      {
        number: 206,
        branch: 'codex/colliers-ai-experience-p1-20261117',
        scope: 'Colliers AI conversational experience 2.0 P1 continuous workspace, PR #206',
        reason: 'User explicitly waived independent visual review, manual browser visual review and physical-phone manual acceptance for conversational experience P1 on 2026-11-17; applies only to PR #206',
      },
      {
        number: 205,
        branch: 'codex/colliers-experience-p0-20261117',
        scope: 'Colliers AI conversational experience 2.0 P0, PR #205',
        reason: 'User explicitly waived independent visual review and browser review for conversational experience P0 on 2026-11-17; applies only to PR #205',
      },
      {
        number: 204,
        branch: 'codex/fix-ai-clarification-protocol-20261117',
        scope: 'Colliers AI clarification response protocol and failure guidance, PR #204',
        reason: 'User explicitly waived independent visual review and mobile browser testing for Colliers AI clarification bug fix on 2026-11-17; applies only to PR #204',
      },
      {
        number: 203,
        branch: 'codex/colliers-ai-p2-20261116',
        scope: 'Colliers AI P2 building, map, outputs and own work history, PR #203',
        reason: 'User explicitly waived independent visual review, manual browser visual review and physical-phone manual acceptance for Colliers AI P2 on 2026-11-15; applies only to PR #203',
      },
      {
        number: 190,
        branch: 'codex/market-communication-p0-20261113',
        scope: 'Homepage market communication P0, PR #190',
        reason: 'User explicitly waived independent visual review and real-device acceptance for PR #190 on 2026-11-14',
      },
      {
        number: 191,
        branch: 'codex/communication-compact-home-20261114',
        scope: 'Homepage communication compact composer, PR #191',
        reason: 'User explicitly authorized reusing PR #190 visual and real-device acceptance waiver for PR #191 on 2026-11-14',
      },
      {
        number: 192,
        branch: 'codex/audit-exclude-codex',
        scope: 'Audit log Codex exclusion, PR #192',
        reason: 'User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #192',
      },
      {
        number: 193,
        branch: 'codex/audit-exclude-codex-default',
        scope: 'Audit log default Codex exclusion, PR #193',
        reason: 'User explicitly waived independent visual review and mobile testing for this conversation on 2026-11-14; this record applies only to PR #193',
      },
      {
        number: 194,
        branch: 'codex/dotted-district-boundaries-20261114',
        scope: 'Map district boundary dotted lines, PR #194',
        reason: 'User explicitly waived independent visual review and mobile testing for PR #194 on 2026-11-14; this record applies only to the district boundary dotted-line change',
      },
      {
        number: 195,
        branch: 'codex/map-search-p0-20261114',
        scope: 'Map search navigation and future-supply visibility P0, PR #195',
        reason: 'User explicitly waived independent visual review and real-device acceptance for map search P0 fixes in PR #195 on 2026-11-14',
      },
      {
        number: 196,
        branch: 'codex/map-search-p1-candidates-20261114',
        scope: 'Map search candidates and explicit positioning P1, PR #196',
        reason: 'User explicitly authorized the same independent visual and real-device waiver as PR #195 for map search second-batch changes in PR #196 on 2026-11-14',
      },
      {
        number: 197,
        branch: 'codex/map-search-p2-viewport-20261114',
        scope: 'Map third-batch viewport, popup stability and search consistency, PR #197',
        reason: 'User explicitly authorized the same independent visual and real-device acceptance waiver as the previous map search batches for PR #197 on 2026-11-14',
      },
      {
        number: 198,
        branch: 'codex/admin-query-first-release',
        scope: 'Admin-only trusted data query and audit first release, PR #198',
        reason: 'User explicitly waived independent visual review and mobile testing for the admin first release on 2026-11-15; applies only to PR #198',
      },
      {
        number: 199,
        branch: 'codex/home-ai-p0-20261115',
        scope: 'Homepage Colliers AI P0 conversation and result presentation, PR #199',
        reason: 'User explicitly waived visual and browser review for homepage AI P0 on 2026-11-15; applies only to PR #199',
      },
      {
        number: 200,
        branch: 'codex/colliers-ai-p1',
        scope: 'Colliers AI P1 semantic conversation and trusted research, PR #200',
        reason: 'User explicitly waived independent visual review, browser visual review and physical-phone manual acceptance for Colliers AI P1 on 2026-11-15; applies only to PR #200',
      },
      {
        number: 201,
        branch: 'codex/colliers-ai-p1-followup',
        scope: 'Colliers AI P1 follow-up multi-metric analysis and verification, PR #201',
        reason: 'User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested unresolved work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #201',
      },
      {
        number: 202,
        branch: 'codex/colliers-ai-p1-cross-trends',
        scope: 'Colliers AI P1 cross-dimensional quarterly trends, PR #202',
        reason: 'User continued the same authorized Colliers AI P1 task on 2026-11-15 and requested remaining work be completed and merged; the original P1 independent visual, browser visual and physical-phone manual review waiver is retained only for PR #202',
      },
    ];
    const approved = pr?.base?.ref === 'main'
      && pr?.head?.repo?.full_name === 'ronyu870-collab/office-map-main'
      && authorizedWaivers.some(waiver => pr?.number === waiver.number
        && pr?.head?.ref === waiver.branch
        && record.get('scope') === waiver.scope
        && record.get('reason') === waiver.reason);
    return approved ? null : 'Visual waiver applies only to specifically authorized PRs and must disclose the exact reason.';
  }
  if (result === 'not-applicable') {
    return record.get('reason') ? null : 'Explain why no user-visible interface or state is affected.';
  }

  if (!record.get('scope') || !record.get('reviewer')) {
    return 'Name the affected pages and the person who reviewed the rendered result.';
  }
  const link = record.get('evidence');
  try {
    const url = new URL(link);
    if (url.protocol === 'https:' && !url.username && !url.password && /^https:\/\/[^\s]+$/.test(link)) return null;
  } catch {
    // Missing or malformed evidence.
  }
  return 'Link to the visual review record (HTTPS) with desktop and mobile comparisons.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const error = checkVisualAcceptance(event.pull_request);
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else {
    if (event.pull_request?.body?.includes('result: waived')) {
      console.log('A precisely scoped, user-authorized single-PR acceptance waiver is documented. Visual/real-device acceptance was NOT performed or passed.');
    } else {
      console.log('Visual acceptance record is complete for this revision. A reviewer must verify its scope and evidence.');
    }
  }
}
