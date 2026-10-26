## Summary

Describe the problem and the change in plain language.

## Scope

- What is included?
- What is intentionally not included?

## Applicable standards and preservation

- Read [AGENTS](../AGENTS.md) and the [standards index](../docs/standards/README.md). Record applicable rule IDs, responsibility documents and any documented exception; distinguish adopted rules, candidates and implementation status.
- Existing design and behavior to preserve; evidence that the changed difference is a problem.
- Shared components or logic affected, consuming pages/flows, and planned checks. Mark not applicable for documentation-only changes.

## Risk

Describe behavior, data, security, performance, or deployment risk.

## Verification

- [ ] Applicable local verification under [AGENTS](../AGENTS.md) completed. Documentation-only: links, anchors, rule consistency and unchanged business code checked; application tests not applicable.
- [ ] The exact PR head passed the [Verify workflow](workflows/verify.yml); local verification does not substitute for CI.
- [ ] Relevant behavior, permissions and shared callers checked; unverified items are explicit.
- [ ] For runtime behavior changes, [VERIFY-03](../docs/standards/05_工程验证与交付规范.md#verify-03) execution evidence is included: affected operations and indirect dependencies; database operations on real PostgreSQL matching the target major version when applicable; bug regression failing on the old implementation and passing after the fix; required regressions wired into CI and actually run. Mark not applicable with a reason for documentation-only changes. SQL text checks, successful migration creation and unrelated green checks do not satisfy this requirement.
- [ ] Affected mobile actions checked against [MOB-01](../docs/standards/03_模块规范.md#mob-01), with [MOB-05 evidence](../docs/standards/05_工程验证与交付规范.md#mob-05); not applicable when no UI/behavior changed.

## UI evidence and recovery

For UI changes, link comparable before/after evidence and report checks of the affected pages and flows. State what was actually verified and what remains unverified; mark not applicable when there is no UI change.

Record the baseline commit and how this batch can be reverted without overwriting unrelated work.

## Change record

- [ ] `CHANGELOG.md` updated for non-trivial changes, or this change is exempt under `AGENTS.md`

## Follow-up

List known follow-up items, if any.
