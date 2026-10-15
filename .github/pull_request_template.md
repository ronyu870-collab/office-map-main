## Summary

Describe the problem and the change in plain language.

## Scope

- What is included?
- What is intentionally not included?

## Applicable standards and preservation

- Relevant provisions in [product](../docs/standards/product.md), [design](../docs/standards/design.md), [engineering](../docs/standards/engineering.md) and [acceptance](../docs/standards/acceptance.md); distinguish confirmed rules from proposals.
- Existing design and behavior to preserve; evidence that the changed difference is a problem.
- Shared components or logic affected, consuming pages/flows, and planned checks. Mark not applicable for documentation-only changes.

## Risk

Describe behavior, data, security, performance, or deployment risk.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Relevant manual flow checked when behavior changed

## UI evidence and recovery

For UI changes, link comparable before/after evidence and report checks of the affected pages and flows. State what was actually verified and what remains unverified; mark not applicable when there is no UI change.

Record the baseline commit and how this batch can be reverted without overwriting unrelated work.

## Change record

- [ ] `CHANGELOG.md` updated for non-trivial changes, or this change is exempt under `AGENTS.md`

## Follow-up

List known follow-up items, if any.
