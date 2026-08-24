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

## 2026-08-24 — P0 Verify baseline recovery

### Area
TypeScript / lint / tests / production build / CI baseline

### What changed

- Repaired the historical TypeScript baseline without disabling strict type checking:
  - removed stale test imports for the deleted `/bi` route;
  - aligned Zod 4 error configuration and React Hook Form resolver typing;
  - typed OSS authorization headers as a valid string header record;
  - updated AG Grid configuration to current API/type contracts;
  - corrected audit-log callback typing, nullable building-area handling, lease-service field drift, and the test environment's `NODE_ENV` mutation.
- Aligned stale tests with current product contracts instead of preserving deleted behavior:
  - keyboard access-control coverage now targets the real `lease-submission` restriction rather than `/bi`;
  - MapController destruction tests now assert removal of the global comparison bridge after `destroy()`;
  - page-scroll preservation tests reset Auth state between cases and deterministically mock the current Update page dependencies;
  - lease-transaction tests now exercise the current fuzzy duplicate-detection/query path and include the current `.limit()` query stage.
- Kept lint as a blocking repository-wide gate. Broad pre-existing React Compiler / React hooks / `no-explicit-any` migration debt is reported as warnings rather than converted into hundreds of risky product refactors inside this baseline PR.
- Corrected the ESLint flat-config rule scope so the `react` plugin is available where `react/no-unescaped-entities` is overridden.
- Removed all temporary one-time codemod/workflow machinery after it had served its migration purpose. The permanent Verify workflow is back to `contents: read` and runs only `npm ci`, typecheck, lint, tests, and production build.

### Why

The Verify workflow existed but was not a usable merge gate because historical TypeScript drift stopped the pipeline before lint, tests, and production build could execute. Once typecheck was repaired, stale tests and an ESLint flat-config scoping issue surfaced additional baseline failures.

The goal of this work was to make the existing quality gate truthful again: current code should be checked against current contracts, real failures should still block merging, and historical migration debt should not be hidden by skipping checks or by weakening the workflow itself.

### Impact

- No intended business/product behavior change.
- Pull requests can now reach and execute all four blocking gates: TypeScript, lint, tests, and production build.
- Historical test suites now validate routes, authorization rules, query chains, and lifecycle behavior that actually exist in the current application.
- Lint still runs across the repository and remains merge-blocking for non-baselined errors; legacy warning debt remains visible for gradual cleanup.

### Verification

- On the clean branch with temporary tooling removed, Verify run #30 (`32698149384`) completed successfully through all four sequential gates: Typecheck, Lint, Test, and Production build.
- The test stage passed after the previously observed 26 failures across page-scroll preservation, keyboard navigation, lease-transaction service, and MapController lifecycle tests were corrected.
- Production build executed for the first time after the repaired upstream gates and completed successfully; it was not skipped.
- Both Vercel preview projects (`office-map-main` and `colliersdata`) were Ready on the pre-changelog head. The changelog-only final head must still receive its own complete Verify and Vercel checks before merge.
- `npm ci` currently reports 24 dependency vulnerabilities (7 low, 2 moderate, 14 high, 1 critical). These are not silently treated as resolved by this baseline recovery.

### Follow-up

- Gradually reduce the remaining lint warning baseline, especially React Compiler/hooks and `no-explicit-any` debt, through scoped behavior-preserving refactors.
- Triage the 24 dependency vulnerabilities separately; avoid blanket `npm audit fix --force` updates without regression review.
- Consider updating GitHub Actions major versions after validating compatibility with the current runner/runtime.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.

---

## 2026-08-24 — P0 authentication and authorization boundary tightening

### Area
Authentication / authorization / Supabase RLS / sensitive API access

### What changed

- Unified the application role contract to exactly `viewer`, `editor`, and `admin`, matching the database role constraint. Removed the stale `executive` role from the canonical TypeScript role model and admin impersonation UI.
- Replaced the stale restricted-module entry `deals` / `/deals` with the real `lease-submission` / `/lease-submission` module. The lease-submission workspace now explicitly allows `editor` and `admin`; `viewer` is denied.
- Changed module authorization helpers to fail closed for missing or unknown roles instead of treating unrecognized identities as generally accessible.
- Added a route-level guard for `/lease-submission` so direct URL navigation cannot bypass the homepage module restriction.
- Added a pre-mount authentication gate for `/map`. The heavy map client, AMap runtime, and map data requests are not mounted until a valid session has been resolved.
- Added Supabase migration `20260824043500_tighten_auth_boundaries.sql` to move viewer data scoping into Postgres RLS:
  - `viewer` can read stock buildings only when grade is exactly A or P.
  - `editor` and `admin` retain access to all stock building grades.
  - `building_metrics`, `building_current_data`, and `building_display_overrides` inherit their parent building's visibility.
  - `viewer` can no longer read `lease_transactions`; `editor` and `admin` retain read access so the existing cross-broker duplicate-detection workflow continues to work.
- Hardened `/api/lease-submission/team-submissions`: because the endpoint uses the Supabase secret/service role and bypasses RLS, it now verifies that the authenticated caller is actually an `admin` before any team-wide transaction or Auth user data is queried.
- Updated the broker API to select the canonical `editor` role directly instead of filtering around the obsolete `executive` role.
- Updated authorization tests to cover the real lease-submission module, editor/admin access, viewer denial, and fail-closed handling of unknown roles.
- Corrected the Verify workflow runtime from Node.js 20 to Node.js 22 after CI showed that the installed Supabase JavaScript packages declare Node.js `>=22.0.0`.

### Why

The previous implementation mixed UI navigation rules with real authorization. A viewer's map request downloaded all building rows into the browser and then filtered A/P buildings client-side, which meant the hidden rows were still available to browser code and could reappear through alternate UI paths such as comparison mode. Database policies also allowed every authenticated user to select all buildings, metrics, and transactions directly through the Supabase Data API.

The project also had role and route drift: TypeScript still described an `executive` role that the database does not allow, while the restricted-module configuration referenced `/deals` even though the live workflow is `/lease-submission`.

Finally, the team-submissions API used a service-role client after checking only that a valid user token existed. Because service-role clients bypass RLS, that was an authorization gap for team-wide sensitive data.

### Impact

- Once the new migration is applied to the office-map Supabase environment, viewer accounts will no longer receive non-A/P stock-building rows from the database at all; browser-side filtering is no longer the security boundary.
- Viewer accounts cannot enter the lease-submission workspace or query the lease transaction table.
- Existing broker/editor workflows remain available, including cross-broker duplicate detection.
- Admin users retain full map visibility and team monitoring access.
- Unauthenticated users no longer cause the map runtime to initialize before session validation.
- Invalid, missing, or legacy role values fail closed instead of implicitly gaining normal module access.

### Verification

- Added/updated unit tests for canonical role and module authorization behavior.
- Verify run #3 reached `npm run typecheck` and failed on a pre-existing TypeScript baseline. Every reported error is in files untouched by this PR: obsolete BI test imports, existing Zod 4 / React Hook Form typing, OSS request header typing, AG Grid API typing, an audit-log implicit `any`, a map modal nullable value, lease-service inferred columns, and a test mutating read-only `NODE_ENV`.
- No TypeScript error from Verify run #3 points to any authorization file changed by this PR.
- Because typecheck stops the sequential workflow, lint, tests, and production build were not executed in run #3. The repository therefore does not yet have a fully green Verify baseline; this is recorded rather than hidden by weakening the workflow.
- CI also reported that the installed Supabase JS packages require Node.js `>=22.0.0`; `.github/workflows/verify.yml` is now aligned to Node.js 22 for subsequent runs.
- The RLS migration has been reviewed against the existing schema and policy names in the repository.
- The connected Supabase project available in this session was identified as a different Personal OS database, so this migration was intentionally **not** executed against that project. Applying and validating the migration against the correct office-map Supabase environment remains a required deployment step.

### Follow-up

- Apply `20260824043500_tighten_auth_boundaries.sql` to the correct office-map Supabase project and verify viewer/editor/admin queries with real test accounts before production release.
- Repair the repository's pre-existing TypeScript baseline so the Verify workflow can reach lint, tests, and production build without weakening quality gates.
- Remove the now-redundant viewer grade filtering and `allBuildingsUnfiltered` copy inside `MapClient` after the RLS migration is deployed; at that point the client can treat its Supabase result as already authorization-scoped.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.

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
- CI installs dependencies with `npm ci`, then runs typecheck, lint, tests, and production build. The runtime was initially Node.js 20 and was corrected to Node.js 22 during the following P0 auth-hardening change after dependency engine requirements were observed in CI.
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
- The first auth-hardening PR exposed a pre-existing TypeScript baseline, proving the gate is operational but not yet green; the baseline is tracked explicitly for repair rather than bypassed.

### Follow-up

- P0: tighten authentication and authorization boundaries.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.
