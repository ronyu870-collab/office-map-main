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

## 2026-08-25 — Map final experience QA and interaction hardening

### Area
Map 2.0 / final experience QA / responsive overlays / markers / InfoWindow / accessibility

### What changed

- Added a single presentation-level dismissal contract for Filter, Future Supply, and Project List: existing mutual exclusion is retained, while Escape or returning directly to the map canvas closes any open large workspace.
- Fixed the Future Supply workspace height contract so its content scrolls inside the available panel height on short desktop and mobile viewports rather than being clipped below its header.
- Tightened the command/KPI/filter/supply surfaces toward the Colliers Data 2.0 border-led 4–8px radius language with less blur and shadow.
- Reworked full building, dot, future-supply, submarket, and competitor marker chrome through route-scoped presentation rules: lower shadow, less hover scaling, squarer GIS symbols, and a smaller aggregate footprint while preserving all data-driven colors and render-mode semantics.
- Made building/future InfoWindow content and the competitor toolbar viewport-aware without changing Building Detail, Trend, contact, compare, filtering, or AMap lifecycle behavior.
- Replaced the list-to-marker bounce with a short subtle emphasis and removed noisy Map/filter development diagnostics while retaining warnings/errors.
- Added behavior-level regression coverage for Escape and direct map-canvas dismissal rather than locking implementation-specific CSS strings.

### Why

Final QA of the Map 2.0 presentation found release-quality interaction and responsive risks: large workspaces could remain open after users returned to the map, the Future Supply body could exceed the panel height, marker chrome still read like a consumer map, InfoWindow widths assumed desktop space, and the competitor toolbar had a fixed 520px minimum width.

### Impact

- Map remains the dominant work surface across desktop, narrow desktop, and mobile layouts.
- Dense marker areas retain more base-map context and hover feedback is less distracting.
- Filter, Future Supply, Project List, InfoWindow, and competitor workflows coordinate more predictably without changing data or authorization semantics.
- Keyboard users gain a consistent Escape path for all large map workspaces.

### Verification

- The permanent repository Verify workflow must pass Typecheck, Lint, Test, and Production Build on the exact PR head before merge.
- Browser-level inspection was attempted against the existing Vercel preview; authenticated visual QA is not claimed where the execution environment cannot access the repository's Vercel team/session.

### Follow-up

- Do not reopen MapDataStore, useMapRuntime, MapRouteGate, auth/session, Supabase/RLS, or AMap lifecycle for further visual tuning unless a separate reproducible behavioral bug is found.

---

## 2026-08-25 — Map 2.0 project inventory and presentation density

### Area
Map 2.0 / project inventory / building detail / InfoWindow / filters / marker presentation

### What changed

- Reworked the floating project list into a dense market-inventory panel with compact rows as the default view and a retained detail-card mode.
- Restyled building detail cards around net effective rent, vacancy, data quarter, and compact property attributes instead of large floating cards.
- Added map-route-scoped presentation overrides for AMap InfoWindow chrome, building-marker shadow/saturation, and embedded SidebarFilter density.
- Kept the existing marker data-driven colors, list slicing and IntersectionObserver loading, search/filter callbacks, building hover/click behavior, InfoWindow action handlers, and trend/competitor/contact flows unchanged.

### Why

The first Map 2.0 slice established the full-canvas workbench but several nested surfaces still used the previous large-card, high-radius visual language. This pass aligns the high-frequency inventory/detail surfaces with the professional, dense, institutional GIS-workbench direction without reopening map behavior or data semantics.

### Impact

- More projects and metrics fit in the visible map workspace with less visual obstruction.
- Building comparison is faster because rent, vacancy, area, data quarter, submarket, and grade are exposed in a consistent tabular hierarchy.
- InfoWindow, filter, and marker presentation now visually align with the Map 2.0 shell while their existing runtime contracts remain intact.
- No authentication, Supabase/RLS, MapDataStore filtering, useMapRuntime lifecycle, or MapController behavioral changes are included.

### Verification

- The pre-slice interaction-fix head `0592c2033905922f7aef747602e8016e7184df0d` passed Typecheck, Lint, Test, and Production build in Verify #94.
- The final second-slice head must pass the same four gates before this draft PR is considered ready for further visual work.

### Follow-up

- Perform browser-level visual inspection when an accessible preview is available, with emphasis on 360–430px widths, InfoWindow clipping, filter-scroll density, and marker readability at each zoom tier.
- Continue visual refinement through presentation seams; do not use this slice to change filtering semantics or AMap lifecycle ownership.

---

## 2026-08-24 — Map architecture split and lazy trend-chart runtime

### Area
Map workbench / authentication boundary / client runtime / filtering architecture / frontend bundle performance

### What changed

- Converted `/map` into a small route shell with `MapRouteGate`, reusing the root `SessionProvider` rather than resolving a second route-level session before mounting the map workspace.
- Preserved the P0 authorization boundary: `MapClient`, AMap, and map data work do not mount until the shared application session is authenticated.
- Extracted shared Map domain logic from the monolithic `MapClient` into `mapDomain`, including filter defaults, render modes, statistics, district LEED aggregation, active-filter chips, and the current five-bucket future-supply calendar.
- Replaced the historical supply-calendar test that duplicated a stale six-bucket implementation with tests against the production domain model.
- Added `MapDataStore` with reusable building-id, district, submarket, grade, LEED, and project-type indexes. Production filtering now uses the store while preserving source ordering, viewer/editor/admin visibility, compare-group semantics, numeric filters, keyword search, and delegated subway-distance checks.
- Extracted the imperative AMap lifecycle into `useMapRuntime`, isolating controller creation, initialization, admin-mode synchronization, readiness, error handling, and destruction from the Map workspace component.
- Removed all top-level ECharts runtime imports and registration from `MapController`. Building Detail → Trend now loads `trendChartRuntime` with a dynamic `import()` only after the user opens the Trend panel and usable history exists.
- Reduced the lazy trend runtime to the chart features actually used by this flow: `LineChart`, `GridComponent`, `TooltipComponent`, and `CanvasRenderer`; the previous unused `BarChart` and `LegendComponent` registrations are no longer loaded for this feature.
- Added race guards around the lazy chart load so closing the panel or switching buildings before the chunk/render frame completes cannot draw a stale chart.
- Added architecture regression coverage that fails if runtime `echarts/*` imports are moved back into `MapController` or if the dynamic trend-runtime boundary is removed.
- Removed all one-time codemod/workflow tooling after each large-file migration; the permanent CI surface remains the repository Verify workflow.

### Why

`MapClient` had accumulated route authentication, session resolution, data loading, filtering, statistics, future-supply derivation, imperative AMap lifecycle, event bridges, and UI state in one client component. `MapController` also statically registered ECharts even though trend charts are an optional detail interaction. That architecture made the Map workspace harder to change safely and forced chart code into the normal map dependency path before a user requested it.

This split establishes stable boundaries before the Map 2.0 visual migration: route/session gating, pure domain derivation, indexed data selection, imperative map runtime, and optional chart runtime can now evolve independently without mixing visual redesign with behavioral rewrites.

### Impact

- Normal Map entry no longer has a static runtime dependency on ECharts through `MapController`; the chart runtime becomes an on-demand chunk for Trend usage.
- Map authentication reuses the application-level session owner while retaining the existing fail-closed mount boundary.
- Repeated filter interactions can use prebuilt indexes instead of embedding the entire selection engine inside the React effect, while existing result semantics and ordering remain unchanged.
- AMap controller lifecycle code is isolated from workspace rendering, reducing the risk that role/session UI changes recreate or leak the map instance.
- No Map 2.0 visual redesign, Supabase schema change, RLS change, or intentional broker workflow change is included in this architecture PR.

### Verification

- Added/updated focused coverage for the route session gate, shared supply-calendar model, indexed Map data store, AMap runtime lifecycle, and lazy ECharts bundle boundary.
- Implementation head `c331a013cee8cb147c1bf0e8e9d4f980f0b53412` passed the repository Verify workflow in order: Typecheck, Lint, Test, and Production build.
- Final acceptance still requires the exact post-changelog/cleanup PR head to pass the same four gates before merge.

### Follow-up

- Use these architecture boundaries as the base for the Map 2.0 visual/workbench migration rather than combining another behavioral rewrite with the UI redesign.
- Measure representative Map entry and first- Trend-open timings after deployment to quantify the practical effect of the lazy chart split in addition to the source-level bundle-boundary regression test.
- Continue reducing `MapController` responsibilities only where a stable behavioral seam exists; do not turn this PR into a broad rewrite of every legacy map interaction.

---

## 2026-08-24 — Home 2.0 workspace and shared session context

### Area
Home workspace / authentication session lifecycle / navigation information architecture

### What changed

- Converted the root `SessionProvider` from timeout-only infrastructure into the single application-session owner. It now exposes `useAppSession()` with shared `session`, `status`, and `refreshSession` state while retaining trusted-device expiry, 30-minute inactivity handling, password-change redirects, and Supabase auth-state synchronization.
- Removed the Home page's independent `getSessionFast()` request and client-side auth gate. The route is now a small server shell that mounts `HomeWorkspace`, which consumes the already-resolved root session.
- Added a regression test proving that two workspace consumers under one root provider still trigger only one `getSessionFast()` resolution.
- Rebuilt Home as the first real Colliers Data 2.0 consumer of the design system:
  - Map Workbench is the dominant primary entry;
  - Quarterly Update, Lease Submission, Research Library, and Administration are explicit business workspaces;
  - Administration remains visible only to the same admin/demo audience as before;
  - lease-submission role restrictions, fail-closed authorization, audit metadata, keyboard activation, impersonation-compatible session resolution, and the existing development-module gate are preserved.
- Moved Communication Board and Notice into a visually secondary Team Activity rail so collaboration information no longer competes with the core market/data workspaces.
- Preserved the fixed workbench layout contract (`h-screen` / page overflow hidden) and kept scrolling inside workspace regions, including the Communication Board, to avoid reintroducing the historical page-scroll regression.
- Refined `WorkspaceShell` so fixed workbench consumers can use a true flex-column shell with a min-height-zero content region and internal overflow management.

### Why

The previous Home page resolved authentication independently even though the root layout already mounted `SessionProvider`. That left route rendering dependent on an additional client effect and duplicated the session ownership model. At the same time, Home still behaved like a feature-card portal rather than an institutional commercial-real-estate data workspace.

This migration makes session ownership explicit at the application shell and gives the product a clearer hierarchy: market intelligence first, business data workflows second, team communication third.

### Impact

- Authenticated route transitions can reuse root session state instead of asking Home to resolve the same session again.
- Home presents a more stable, dense, institutional workspace without changing broker authorization rules or data contracts.
- Viewers remain blocked from Lease Submission; editors/admins retain access; special admin/demo visibility behavior is preserved.
- The existing Communication Board and Notice components remain operational but are no longer part of the critical visual path.
- No Supabase schema, RLS policy, API contract, or Map runtime behavior changes in this PR.

### Verification

- Added `SessionProvider.shared-session.test.tsx` to lock the one-provider/one-auth-resolution contract across multiple consumers.
- Existing repository preservation tests continue to define the required fixed Home layout, keyboard interaction, Communication Board availability, and responsive behavior.
- Final acceptance requires the exact PR head to pass Typecheck, Lint, Test, and Production build through the repository Verify workflow.

### Follow-up

- PR 3: begin the behavior-preserving Map architecture split before changing the Map visual workspace.
- Migrate additional authenticated routes to `useAppSession()` only when their existing route-specific guards can be removed without weakening authorization.
- Capture Home before/after timings using the Phase 0 performance-baseline scenarios after the merged version is available in a representative deployment.

---

## 2026-08-24 — Colliers Data 2.0 UI foundation and performance baseline

### Area
Design system / workspace layout / frontend performance observability

### What changed

- Established the first Colliers Data 2.0 design-token layer under `src/styles/tokens.css`, covering workspace/surface colors, text hierarchy, brand and semantic colors, spacing, typography scale, radii, shadows, z-index, and motion durations.
- Updated global typography to the intended institutional system stack (`Arial`, `PingFang SC`, `Microsoft YaHei`, system sans-serif) while preserving the existing Colliers brand color contract.
- Added reusable UI primitives for Button, Input, Badge, Panel, PageHeader, Toolbar, and Loading/Empty/Error states.
- Added a reusable `WorkspaceShell` that supports the different navigation, GIS, data-entry, and administration workspace layouts without forcing every page into one card template.
- Added `PerformanceReporter` using Next.js Web Vitals reporting plus browser long-task observation. Measurements are published as a local `colliers:performance` browser event and are logged in development; no telemetry is transmitted externally.
- Added `docs/performance-baseline.md` defining repeatable Home, Map, Quarterly Update, Lease Submission, and Admin measurement scenarios plus user-perceived latency targets.
- No existing business page has been migrated to the new primitives in this foundation change; the refactor remains behavior-preserving by design.

### Why

The current product has accumulated page-specific colors, radii, headers, loading patterns, and large client-side workspaces. Beginning the 2.0 redesign by directly restyling Home or Map would create another layer of one-off UI decisions and would make performance claims subjective.

This change therefore establishes two prerequisites first: a shared visual language appropriate for a dense commercial-real-estate intelligence workbench, and a common measurement contract that subsequent Home, Map, data-entry, and Admin refactors can use for before/after comparisons.

### Impact

- Existing workflows and permissions are intentionally unchanged.
- Subsequent pages can adopt consistent visual primitives without duplicating style decisions.
- Future performance work can distinguish immediate visual feedback, route-shell responsiveness, browser long tasks, and network/data completion instead of treating them as one vague loading-time metric.
- The new foundation does not introduce an analytics backend or send performance data outside the browser.

### Verification

- The branch is intended to pass the repository `npm run verify` quality gate before merge.
- Pull-request CI will be used as the authoritative TypeScript, lint, test, and production-build verification because this connected GitHub editing environment does not execute the repository locally.
- The first consumer migrations are intentionally deferred so verification can isolate foundation/API correctness from page-level behavioral changes.

### Follow-up

- PR 2: migrate the authenticated system shell and Home workspace to the new foundation and remove duplicate session-gating behavior where safe.
- PR 3: split Map state/runtime responsibilities while preserving current Map UI before the Map 2.0 visual migration.
- Add richer primitives such as Select, SearchInput, Drawer, Popover, FilterChip, and table-specific controls when a real workspace migration requires them rather than building unused abstractions up front.
- Capture concrete production-like before/after measurements for each migrated workspace using the baseline scenarios.

---

## 2026-08-24 — P0 dependency security baseline

### Area
Dependency security / spreadsheet ingestion / supply-chain risk

### What changed

- Replaced the npm-registry `xlsx@0.18.5` package with SheetJS' official `0.20.3` distribution, removing the known Prototype Pollution and ReDoS advisories that affected the old parser on the real admin spreadsheet-upload path.
- Hardened XLSX ingestion independently of the package upgrade:
  - only `.xlsx` uploads are accepted;
  - upload size is capped at 25 MiB;
  - worksheet processing is capped at 10,000 data rows and 500,000 cells;
  - parsing is restricted to the data features this workflow actually needs instead of enabling formula, HTML, style, or VBA extraction;
  - pure tests cover file-type, file-size, row, and cell budgets.
- Removed `puppeteer-core` from production dependencies after repository-wide usage review found no imports or runtime calls. This also removed the unused `@puppeteer/browsers -> extract-zip` high-severity advisory chain instead of taking an unnecessary Puppeteer major upgrade.
- Kept `ali-oss@6.23.x` rather than downgrading the SDK. Scoped its legacy HTTP stack with an `ali-oss -> urllib@2.41.0` override and regenerated the lockfile with Node.js 22.
- Applied only the non-breaking updates available through `npm audit fix`; `npm audit fix --force` was intentionally not used.
- Removed all temporary dependency-audit and dependency-fix GitHub Actions after the lockfile and advisory graph were captured. The permanent CI surface remains the standard read-only Verify workflow.

### Why

The previous dependency baseline reported 24 vulnerabilities (7 low, 2 moderate, 14 high, 1 critical). Several were not merely scanner noise: the old SheetJS parser handled administrator-selected workbooks directly, while an unused Puppeteer dependency carried a high-risk archive-extraction chain. The critical finding came from the legacy `vm2` sandbox inside an old optional PAC/proxy dependency path rather than from application code.

The goal was to eliminate reachable or unnecessary high-impact risk without converting the security cleanup into an uncontrolled major-version migration. In particular, forcing every transitive dependency to the newest incompatible version only to reach an artificial audit count of zero would create larger regression risk than the remaining non-critical advisories justify.

### Impact

- The admin Excel workflow keeps the same user-facing import/export contract while using a patched SheetJS release and explicit resource budgets.
- Malformed or oversized workbooks are rejected before unrestricted worksheet processing.
- The unused Puppeteer runtime and its browser-download/extraction dependency graph are no longer shipped.
- The previous critical `vm2` advisory is no longer present in the final audit baseline.
- The dependency tree is smaller and its residual security debt is explicit rather than hidden.

### Verification

- Node.js 22 / npm 10 regenerated `package-lock.json` from the committed dependency declarations.
- The original audit baseline was 24 vulnerabilities: 7 low, 2 moderate, 14 high, 1 critical.
- After the targeted changes and non-force audit fixes, `npm audit` reports **11 residual vulnerabilities: 4 low, 1 moderate, 6 high, 0 critical**.
- The residual report is transitive and is concentrated in the legacy optional proxy/network path around `ali-oss` / `urllib` (`proxy-agent`, `pac-proxy-agent`, `pac-resolver`, `ip`, `@tootallnate/once`) plus current transitive `ip-address` and `qs` advisories. No `vm2`, `xlsx`, `puppeteer-core`, or `extract-zip` advisory remains in the final captured report.
- Final merge acceptance still requires the exact post-changelog head to pass Typecheck, Lint, Test, and Production build and to receive both Vercel preview checks; those checks are intentionally outside this historical audit snapshot rather than being faked into the record before they run.

### Follow-up

- Revisit the remaining Ali OSS optional proxy-chain advisories when Alibaba publishes a stable SDK/dependency graph that removes the old proxy stack, or when there is a tested compatible override that does not alter OSS request behavior.
- Continue consuming non-breaking fixes for `ip-address` and `qs` as their parent dependency ranges allow them to resolve cleanly.
- Do not use `npm audit fix --force` as a substitute for dependency-path review.

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
