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
