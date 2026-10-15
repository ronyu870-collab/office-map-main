<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repository engineering rules

## Required standards and preservation of existing design

Before making changes, read `README.md`, the four standards below, and the relevant module documentation, implementation and tests:

- [Product](docs/standards/product.md): business scope, permissions and data semantics.
- [Design and interaction](docs/standards/design.md): existing appearance, component variants and visual baseline.
- [Engineering and data](docs/standards/engineering.md): implementation, reliability, performance and maintenance.
- [Acceptance and release](docs/standards/acceptance.md): affected flows, before/after evidence and release verification.

Apply provisions marked as inherited (`沿用`) or explicitly confirmed (`已确认`) within their stated scope. Suggested details (`建议`) and unresolved choices (`待定`) remain proposals; storing them in this repository does not approve them or authorize an application-wide redesign, permission change or data operation. Follow the user's latest explicit requirements and existing authorization. Do not turn routine implementation choices into repeated approval requests.

The existing modules contain deliberately refined design decisions. For UI changes:

1. Establish the current behavior and rendered appearance, and identify the details to preserve. Distinguish code declarations from computed styles; do not claim browser verification from source inspection.
2. Classify differences as intentional/appropriate, confirmed defects or unresolved. Different font sizes, spacing or component implementations alone do not prove a defect. Preserve unresolved differences until evidence establishes the needed change.
3. Improve shared components compatibly before migrating pages in small batches. Preserve suitable variants for ordinary forms, dense entry, reading tables and map labels. Check actual consumers before changing a shared default; avoid blind global replacements.
4. Supply comparable before/after evidence for each UI batch and verify the affected pages and flows. Preserve reasonable density, hierarchy, operation positions, business behavior, permissions and data correctness.
5. Keep each batch traceable and recoverable. Correct or revert a regression before extending that change to more pages, without overwriting unrelated work.

Keep standards, their confirmation status and the corresponding implementations consistent. The code audit in the design standard is a dated snapshot, not evidence that listed issues were fixed or that current pages were visually tested.

## Verification

Before considering a meaningful code change complete, run the repository verification pipeline:

```bash
npm run verify
```

During iteration, the faster quality gate is:

```bash
npm run check
```

Do not merge a change with known typecheck, lint, test, or production-build failures unless the failure is explicitly documented as an existing baseline issue and the change does not worsen it.

## Deployment discipline

- Work on one feature/fix branch per coherent change; do not use `main` as an iteration branch.
- Batch local edits and verification before pushing. Avoid marker, stage, checkpoint, copy-only, or one-file-at-a-time pushes that exist only to trigger remote testing.
- Prefer one stable Preview push for a reviewable checkpoint and one final verified push before merge. Push additional commits only when CI or Preview feedback requires a real code change.
- Merge to `main` only after the exact pull-request head passes the repository Verify workflow. A Vercel `READY` deployment is deployment-health evidence, not a substitute for CI.
- Fold changelog and small documentation refinements into the same coherent branch before final verification rather than creating standalone deployment-triggering commits where practical.

## Persistent change record

`CHANGELOG.md` is the durable engineering record for this repository.

For every non-trivial product, code, database, infrastructure, security, performance, or workflow change:

1. Update `CHANGELOG.md` in the same branch or pull request.
2. Record what changed and why, not only the implementation detail.
3. Record user/system impact.
4. Record the verification performed.
5. Record follow-up work when the change intentionally leaves work outstanding.

A Git commit title or pull request description does not replace the changelog entry.

Small typo-only documentation edits and dependency-lockfile-only changes do not require a separate changelog entry unless they materially affect behavior or operations.

## Refactor discipline

- Prefer small, behavior-preserving refactors over broad rewrites.
- Preserve existing broker workflows unless a product change explicitly requires otherwise.
- Treat Supabase schema/RLS changes as security-sensitive changes and verify them separately.
- Do not expose server secrets through `NEXT_PUBLIC_` environment variables or client bundles.
