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
- [ ] For search, text filters and searchable selectors affected by this change, link [VERIFY-04](../docs/standards/05_工程验证与交付规范.md#verify-04) browser and CI evidence: type the first character, let the UI update, and keep typing without refocusing. Verify focus, caret or selection, and the final results. Otherwise mark not applicable.

- [ ] For affected loading paths, link [VERIFY-06](../docs/standards/05_工程验证与交付规范.md#verify-06) evidence: budget, environment, before/after P50 and P90, failures, optimization rounds, and pass/fail. Mark not applicable with a reason for unrelated changes.

## Visual acceptance

Apply [VERIFY-05](../docs/standards/05_工程验证与交付规范.md#verify-05) to any user-visible change, including a single label, a shared component or a role-specific state. A reviewer checks the rendered page in context for hierarchy, grouping, alignment and consistency. Link an accessible review record (HTTPS) with desktop and mobile comparisons, the baseline, roles, states, viewports and findings.

Fill in the block below for the current PR head. Use `passed` only after visual review. Use `not-applicable` only when there is no user-visible impact, and explain why under `reason`. After a push, confirm the conclusion for the new head. CI checks the record, not the rendered design.

```visual-acceptance
result: pending
head:
scope:
reviewer:
evidence:
reason:
```

## Recovery

Record the baseline commit and how this batch can be reverted without overwriting unrelated work.

## Change record

- [ ] `CHANGELOG.md` updated for non-trivial changes, or this change is exempt under `AGENTS.md`

## Follow-up

List known follow-up items, if any.
