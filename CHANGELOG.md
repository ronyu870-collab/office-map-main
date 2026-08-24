# Engineering Changelog

This document is the durable record of meaningful product and engineering changes to the Colliers Data Platform.

It is intentionally more detailed than Git commit titles. Every non-trivial code, database, infrastructure, security, or workflow change should add an entry here in the same pull request.

## Entry format

Each entry should include:

- Date
- Area
- What changed
- Why it changed
- User or system impact
- Verification performed
- Follow-up work, if any

Do not use this file for raw commit-by-commit history. Group related implementation work into one clear entry.

---

## 2026-08-24 — P0 refactor safety foundation

### Area
Engineering workflow / CI / change management

### What changed

- Added `npm run typecheck` using `tsc --noEmit`.
- Added `npm run check` to run type checking, linting, and the test suite in a fixed order.
- Added `npm run verify` to run the complete local verification pipeline, including the production build.
- Added GitHub Actions workflow `.github/workflows/verify.yml`.
- The workflow runs on pull requests targeting `main` and on pushes to `main`.
- CI uses Node.js 20, installs dependencies with `npm ci`, then runs typecheck, lint, tests, and production build.
- Added this `CHANGELOG.md` as the durable engineering change record.
- Updated repository agent/contributor guidance so future meaningful changes must update this changelog and must be verified before completion.

### Why

The project is entering a larger refactor phase. Before changing authentication boundaries, Supabase data access, map loading, and large components, regressions need to be caught systematically rather than through manual browser testing alone.

Git commit titles are too compressed to serve as product memory. A persistent repository document is required so future contributors can understand what changed, why it changed, and how it was verified.

### Impact

- No intended user-facing behavior change.
- Future refactors have a common local and CI quality gate.
- Engineering changes now have a repository-native historical record independent of individual commit messages.

### Verification

- Repository scripts are defined so the same commands can be executed locally and in CI.
- GitHub Actions configuration uses deterministic `npm ci` installation from the committed lockfile.
- Full branch verification is required before this change is merged to `main`.

### Follow-up

- P0: tighten authentication and authorization boundaries.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.
