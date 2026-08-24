from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "CHANGELOG.md"
TITLE = "## 2026-08-24 — Map architecture split and lazy trend-chart runtime"

ENTRY = '''## 2026-08-24 — Map architecture split and lazy trend-chart runtime

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

'''

text = TARGET.read_text(encoding="utf-8")
if TITLE not in text:
    marker = "---\n\n"
    if marker not in text:
        raise RuntimeError("Engineering changelog insertion marker not found")
    text = text.replace(marker, marker + ENTRY, 1)
    TARGET.write_text(text, encoding="utf-8")
