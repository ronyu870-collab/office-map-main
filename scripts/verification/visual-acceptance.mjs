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
    ];
    const approved = pr?.base?.ref === 'main'
      && pr?.head?.repo?.full_name === 'ronyu870-collab/office-map-main'
      && authorizedWaivers.some(waiver => pr?.number === waiver.number
        && pr?.head?.ref === waiver.branch
        && record.get('scope') === waiver.scope
        && record.get('reason') === waiver.reason);
    return approved ? null : 'Visual waiver applies only to specifically authorized PRs #190 and #191 and must disclose the exact reason.';
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
