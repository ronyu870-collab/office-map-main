# Colliers Data 2.0 performance baseline

This document defines the measurement contract for Data 2.0 and records the 2026-08-25 Performance Hardening pass. It deliberately separates measured CPU work, structural waterfalls and browser/network latency. Numbers are never invented when an authenticated production-like browser target is unavailable.

## User-perceived targets

| Interaction | Target |
| --- | ---: |
| Ordinary click visual feedback | < 100 ms |
| Route change: next workspace shell visible | < 200 ms |
| Authenticated route | No full-page white screen |
| Map filter: visible result update | < 250 ms |
| Text input / slider interaction | No blocking long task caused by downstream map work |
| INP | < 200 ms |
| CLS | As close to 0 as practical |

These are the historical product targets. New or changed loading paths follow the [VERIFY-06 delivery gate](standards/05_工程验证与交付规范.md#verify-06) and the applicable [scenario budgets](../scripts/performance/budgets.json).

## Performance Hardening — 2026-08-25

### Measurement environment and limits

The repository did not expose an authenticated office-map Vercel deployment through the connected deployment account, so Chrome Performance/React Profiler/network timings for the real AMap + Supabase runtime could not be captured reliably in this pass. Those rows are explicitly marked `unable to measure` rather than inferred from code.

Measurements that were reproducible in GitHub Actions used Node 22 + Vitest on Ubuntu with synthetic datasets of 100, 300 and 500 buildings and 20 quarterly metric rows per building. Timing output was diagnostic only and is not a CI threshold. The temporary timing harness was removed before merge.

### Baseline findings

`MapDataStore` is not a current hotspot. On the 500-building synthetic dataset, mean store filter CPU time was approximately:

| Operation | Baseline mean |
| --- | ---: |
| District | 0.051 ms |
| Submarket | 0.049 ms |
| LEED | 0.052 ms |
| Two numeric predicates | 0.150 ms |
| `replaceBuildings` index rebuild | 0.225 ms |

The synthetic 500-building `MapController.renderMarkers` path constructed 1,005 marker objects (full building markers + dot markers + submarket markers) and took about 4.42 ms with fake AMap objects. This proves the allocation count, but not the cost of real AMap overlays. The controller was therefore not rewritten or virtualized without browser evidence.

### Confirmed bottlenecks and changes

1. **Duplicate first marker render.** `MapController.initMap()` independently fetched/rendered markers, while `MapClient` then loaded the same cached data, applied role visibility and performed the managed first render. Network request caching prevented a duplicate buildings request, but the complete marker construction path ran twice. `MapClient` is now the single owner of first data/render orchestration; the controller no longer auto-renders during `initMap()`.
2. **Trend waterfall.** The Trend path previously waited for Supabase history before starting the dynamic ECharts runtime import. The import now starts immediately after explicit Trend intent and runs in parallel with the history query. Existing building-switch and panel-close race guards remain in place. ECharts remains excluded from Map startup because the import is still inside the Trend click path.
3. **Admin-only dependency in the normal Map client graph.** `BuildingMetricsEditModal` was statically imported by `MapClient` even though only admins opening the editor need it. It is now a client-only dynamic import.

### Before / after

| Scenario | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| Map entry | Real browser wall-clock: unable to measure; first marker construction path executed **2×** | Real browser wall-clock: unable to measure; first marker construction path executes **1×** | Removed one full duplicate marker build/render after AMap initialization |
| District filter | ~0.051 ms store CPU at 500 buildings | Same indexed path; no optimization applied | Already far below the 250 ms product budget at the store layer |
| Submarket filter | ~0.049 ms store CPU at 500 buildings | Same indexed path; no optimization applied | Already far below budget |
| LEED filter | ~0.052 ms store CPU at 500 buildings | Same indexed path; no optimization applied | Already far below budget |
| Numeric filter | ~0.150 ms store CPU at 500 buildings | Same indexed path; no optimization applied | Already far below budget |
| Marker → Detail / InfoWindow | unable to measure with real AMap | unable to measure with real AMap | No speculative InfoWindow/controller rewrite |
| First Trend open | Real wall-clock unavailable; dependency order was **history query → ECharts import → render** | Real wall-clock unavailable; dependency order is **history query ∥ ECharts import → render** | Removes serial network/chunk waterfall after user intent |
| Second Trend open | unable to measure | unable to measure | Browser module cache should avoid another chunk transfer, but no unverified ms claim is recorded |

### Bundle audit contract

Map startup must not statically import ECharts, XLSX, JSZip, OSS SDK, Markdown editor, or admin/data-entry-only UI. The existing Trend regression test verifies that ECharts lives in `trendChartRuntime` rather than `MapController`; the Performance Hardening regression test additionally verifies that `MapClient` stays behind the route shell and that the admin metrics editor stays behind a secondary dynamic import.

Production build output and emitted chunks are inspected during this work. If a package name cannot be recovered from minified chunk text, source/import-graph regression is treated as the durable assertion; no bundle byte attribution is fabricated.

### Loading sequence

The intended Map sequence remains:

`route shell → MapClient/core controls → AMap runtime → building data → first markers → secondary features`

`MapRouteGate` already provides a stable shell while `MapClient` loads, so no additional core-component splitting was introduced. Secondary surfaces such as the floating list, admin edit modal, map export and Trend runtime remain lazy.

### Explicit non-optimizations

- No new `MapDataStore` cache/index layer: measured filter CPU is already negligible at 500 buildings.
- No blanket `useMemo` / `useCallback` pass: no React profiler evidence justified it.
- No marker virtualization or `MapController` rewrite: synthetic allocation count is known, real AMap overlay cost is not.
- No list virtualization: existing 50-row slice loading + `IntersectionObserver` remains the simpler implementation until real scroll profiling shows a bottleneck.
- No Supabase schema/RLS/index change: no measured query evidence justified a database migration.
- No service worker or global cache layer.

## Browser/runtime metrics for future production profiling

For a production-like authenticated target, capture cold and warm runs separately and record:

- navigation start → route shell
- MapClient mount → MapController import → AMap ready
- building data loaded → first markers rendered → usable interaction
- district/submarket/LEED/numeric change → filtering → marker update → UI settled
- marker click → InfoWindow visible
- Trend click → runtime import/data available/chart first render, first and second open
- LCP, INP, CLS and long tasks (> 50 ms)
- transferred JavaScript and JavaScript execution time
- React commit/render count for MapWorkbenchView, SidebarFilter, FloatingBuildingList, Building Detail and chips
- Supabase request count, duplicate requests and waterfalls

`PerformanceReporter` publishes Web Vitals and long-task observations as the browser event `colliers:performance`. In development it also writes them to the console. It intentionally performs no network upload.

## Measurement discipline

1. Warm and cold navigation must be recorded separately.
2. Do not compare local development with production deployment.
3. Use exploratory runs only for diagnosis. Delivery samples, P50/P90 and failure counts follow VERIFY-06.
4. Keep UI responsiveness and network completion as separate timestamps.
5. Shared CI checks behavior and resource contracts; collect quantitative acceptance timings under controlled conditions under VERIFY-06.
6. Any performance refactor that changes business output is a product change, not an optimization shortcut.

## 2026-11-02 measurement tooling preparation

`scripts/performance/README.md` describes controlled Chrome sampling and its execution commands. The collector observes the actual click and rendered frames, keeps shell/content/fresh-read timestamps separate, and records failures and missing measurements. Readiness selectors must be calibrated per business scenario; a loading skeleton is not usable content. The tools do not change application authentication, loading or cache behavior and do not upload telemetry.

The summary groups version, deployment, environment, data origin, device, browser, network, proxy state, role, scenario and cache state separately. Sample quantiles never conceal failure or missing-value counts. Bundle inventory is a client-reference manifest inspection, not a browser waterfall or a package CPU measurement.

The Verify workflow now runs the synthetic readiness calibration in a real browser, summary consistency assertions, and anonymous fresh-context redirects/resource-boundary checks against the actual production build. These cover the measurement mechanism and three anonymous routes only; they do not prove authenticated performance, identity switching, third-party map behavior, or real-phone acceptance. There are no wall-clock performance thresholds in CI.

At that stage, authenticated baseline coverage and absolute cold/map/freshness budgets were still pending. The first production OSS sample is diagnostic only, not a stable percentile, an A/B comparison, or a system-wide improvement claim.
