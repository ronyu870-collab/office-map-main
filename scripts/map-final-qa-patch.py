from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing expected text for {label}")
    return text.replace(old, new, 1)


# Presentation shell: overlay coordination + supply scroll + denser visual language.
p = Path("src/app/map/components/MapWorkbenchView.tsx")
text = p.read_text()
anchor = "  const hasActiveFilters = activeFilterChips.length > 0 || Boolean(keyword);\n"
insert = """  const hasActiveFilters = activeFilterChips.length > 0 || Boolean(keyword);\n\n  const closeOpenWorkspaces = React.useCallback(() => {\n    if (isFilterPanelOpen) onFilterPanelOpenChange(false);\n    if (isSupplyOpen) onSupplyOpenChange(false);\n    if (isListVisible) onCloseList();\n  }, [isFilterPanelOpen, isSupplyOpen, isListVisible, onFilterPanelOpenChange, onSupplyOpenChange, onCloseList]);\n\n  React.useEffect(() => {\n    const handleKeyDown = (event: KeyboardEvent) => {\n      if (event.key !== 'Escape') return;\n      closeOpenWorkspaces();\n    };\n    window.addEventListener('keydown', handleKeyDown);\n    return () => window.removeEventListener('keydown', handleKeyDown);\n  }, [closeOpenWorkspaces]);\n"""
text = replace_once(text, anchor, insert, "workspace close coordination")
text = replace_once(
    text,
    '        <div id="map-container" className="absolute inset-0 bg-[#f3f6f8]" />',
    '        <div id="map-container" className="absolute inset-0 bg-[#f3f6f8]" onPointerDownCapture={closeOpenWorkspaces} />',
    "map pointer coordination",
)
text = replace_once(
    text,
    '    <div className="absolute bottom-4 left-3 right-3 top-[72px] z-[380] overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-[72px] sm:w-[430px]">',
    '    <div className="absolute bottom-3 left-3 right-3 top-[64px] z-[380] flex flex-col overflow-hidden rounded-[8px] border border-[#d9e0e8] bg-white shadow-[0_4px_14px_rgba(23,32,51,0.10)] sm:bottom-4 sm:left-auto sm:right-4 sm:top-[64px] sm:w-[430px]">',
    "supply responsive shell",
)
text = replace_once(
    text,
    '      <div className="grid max-h-full grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">',
    '      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-2">',
    "supply scroll body",
)
text = replace_once(
    text,
    '    <div className="absolute bottom-4 left-4 right-4 z-[260] flex max-w-max items-stretch overflow-x-auto rounded-2xl border border-white/70 bg-white/90 shadow-xl shadow-slate-900/10 backdrop-blur-md sm:right-auto">',
    '    <div className="absolute bottom-3 left-3 right-3 z-[260] flex max-w-[calc(100vw-24px)] items-stretch overflow-x-auto rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-max">',
    "metric strip bounds",
)
text = text.replace('min-w-[128px] px-4 py-2.5', 'min-w-[112px] px-3 py-2 sm:min-w-[128px] sm:px-4 sm:py-2.5')
text = text.replace('rounded-2xl border border-white/80 bg-white/96 shadow-2xl shadow-slate-900/15 backdrop-blur-xl', 'rounded-[8px] border border-[#d9e0e8] bg-white shadow-[0_4px_14px_rgba(23,32,51,0.10)]')
text = text.replace('rounded-xl border border-slate-200/90 bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur-xl', 'rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)]')
text = text.replace('rounded-xl border border-white/80 bg-white/92 shadow-lg shadow-slate-900/10 backdrop-blur-md', 'rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)]')
p.write_text(text)


# Marker/InfoWindow presentation only; no filtering, data, auth or AMap lifecycle semantics.
p = Path("src/services/MapController.ts")
text = p.read_text()
text = replace_once(
    text,
    'background: rgba(255,255,255,0.97); backdrop-filter: blur(12px);\n        border: 1px solid #e2e8f0; border-radius: 10px;\n        box-shadow: 0 4px 24px rgba(0,0,0,0.12);\n        font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif;\n        min-width: 520px;',
    'background:#ffffff;\n        border:1px solid #d9e0e8; border-radius:6px;\n        box-shadow:0 3px 12px rgba(23,32,51,0.10);\n        font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif;\n        width:min(520px, calc(100vw - 24px)); max-width:520px; min-width:0; box-sizing:border-box;',
    "competitor responsive shell",
)
text = replace_once(
    text,
    '<div style="display:flex; align-items:center; gap:8px; padding:8px 16px;">',
    '<div style="display:flex; align-items:center; gap:6px; padding:8px 10px; flex-wrap:wrap; row-gap:6px;">',
    "competitor responsive toolbar",
)
text = replace_once(
    text,
    '<div style="width: 360px; font-family: ui-sans-serif, system-ui, -apple-system; background: #ffffff; padding: 4px;">',
    '<div style="width:min(360px, calc(100vw - 72px)); max-width:360px; min-width:260px; box-sizing:border-box; font-family:ui-sans-serif,system-ui,-apple-system; background:#ffffff; padding:4px;">',
    "building info width",
)
text = replace_once(
    text,
    '<div style="width: 300px; font-family: ui-sans-serif, system-ui, -apple-system; background: #ffffff; padding: 4px;">',
    '<div style="width:min(300px, calc(100vw - 72px)); max-width:300px; min-width:240px; box-sizing:border-box; font-family:ui-sans-serif,system-ui,-apple-system; background:#ffffff; padding:4px;">',
    "future info width",
)
text = replace_once(
    text,
    'style.textContent = `@keyframes markerBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-10px)}50%{transform:translateY(0)}70%{transform:translateY(-5px)}}`;',
    'style.textContent = `@keyframes markerBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}`;',
    "marker emphasis motion",
)
text = replace_once(text, 'el.style.animation = "markerBounce 0.6s ease-in-out";', 'el.style.animation = "markerBounce 0.22s ease-out";', "marker emphasis duration")
p.write_text(text)


# Route-scoped CSS tightens AMap marker and panel chrome while retaining data colors.
p = Path("src/app/map/map-workbench.css")
css = p.read_text()
css = css.replace('box-shadow: 0 12px 30px rgba(23, 32, 51, 0.14) !important;', 'box-shadow: 0 4px 14px rgba(23, 32, 51, 0.12) !important;')
css += r'''

/* Final Map QA: precise, low-chrome GIS presentation across desktop and mobile. */
body:has(#map-container) .amap-info-outer,
body:has(#map-container) .amap-info-content {
  max-width: calc(100vw - 24px) !important;
  box-sizing: border-box !important;
}

body:has(#map-container) #map-container [data-building-id][style*="width:26px"] {
  width: 24px !important;
  height: 24px !important;
  border-radius: 4px !important;
  border-width: 1px !important;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.24) !important;
  transition: transform 120ms ease, background-color 150ms ease !important;
}

body:has(#map-container) #map-container [data-building-id][style*="width:26px"]:hover {
  transform: translateY(-1px) scale(1.04) !important;
}

body:has(#map-container) #map-container [data-building-id][style*="width: 10px"] {
  border-radius: 3px !important;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.22) !important;
}

body:has(#map-container) #map-container [data-building-id][style*="width: 10px"]:hover {
  transform: scale(1.35) !important;
}

body:has(#map-container) #map-container .amap-marker > div[style*="width:26px;height:26px"]:not([data-building-id]) {
  width: 24px !important;
  height: 24px !important;
  border-radius: 4px !important;
  border-width: 1px !important;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.22) !important;
}

body:has(#map-container) #map-container .amap-marker > div[style*="width: 82px; height: 82px"] {
  width: 76px !important;
  height: 54px !important;
  border-radius: 6px !important;
  border-width: 1px !important;
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.16) !important;
  backdrop-filter: none !important;
}

body:has(#map-container) #map-container .amap-marker > div[style*="width: 82px; height: 82px"] * {
  text-shadow: none !important;
}

body:has(#map-container) #map-container [data-building-id][style*="flex-direction:column"] > div[style*="width:26px"] {
  width: 24px !important;
  height: 24px !important;
  border-radius: 4px !important;
  border-width: 1px !important;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.22) !important;
}

body:has(#map-container) #map-container > div:has(.comp-dist-btns) {
  max-width: calc(100vw - 24px) !important;
}

body:has(#map-container) #map-container > div:has(.comp-dist-btns) > div {
  min-width: 0 !important;
  max-width: 100% !important;
}

body:has(#map-container) main [class*="backdrop-blur"] {
  backdrop-filter: none !important;
}

body:has(#map-container) main [class*="rounded-2xl"] {
  border-radius: 8px !important;
}

@media (max-width: 640px) {
  body:has(#map-container) .amap-info-content {
    padding: 8px 9px !important;
  }
}
'''
p.write_text(css)


# Remove noisy development diagnostics from the touched Map presentation paths.
p = Path("src/components/SidebarFilter.tsx")
text = p.read_text()
text = re.sub(
    r"\n\s*console\.log\('\[SidebarFilter\] emit state', \{.*?\n\s*\}\);",
    "",
    text,
    flags=re.S,
)
text = text.replace(" animate-in slide-in-from-top-1 fade-in duration-200", "")
p.write_text(text)

p = Path("src/app/map/MapClient.tsx")
text = p.read_text()
text = re.sub(r"\n\s*console\.log\(`\[MapClient\] 角色=\$\{role\}, 总建筑=\$\{buildings\.length\}, 可见=\$\{visible\.length\}`\);", "", text)
text = re.sub(
    r"\n\s*// 调试日志：过滤结果统计\n\s*const filteredGradeCount: Record<string, number> = \{\};\n\s*for \(const b of filtered\) \{ const g = b\.grade \|\| '\?'; filteredGradeCount\[g\] = \(filteredGradeCount\[g\] \|\| 0\) \+ 1; \}\n\s*console\.log\(`\[MapClient\] 过滤结果: \$\{filtered\.length\}/\$\{allBuildings\.length\}, 等级分布:`, filteredGradeCount\);",
    "",
    text,
)
text = re.sub(r"\n\s*console\.log\('\[MapClient\] Map navigated to building and opened info window:', building\.name\);", "", text)
p.write_text(text)


# Behavior-level regressions for overlay coordination; do not lock CSS strings.
p = Path("src/app/map/__tests__/MapWorkbenchView.test.tsx")
text = p.read_text()
insert = r'''

  it('dismisses any open map workspace on Escape', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
  });

  it('dismisses open workspaces when the user returns to the map canvas', () => {
    const callbacks = renderWorkbench({
      isFilterPanelOpen: true,
      isSupplyOpen: true,
      isListVisible: true,
      canOpenList: true,
    });

    const mapCanvas = document.getElementById('map-container');
    expect(mapCanvas).not.toBeNull();
    fireEvent.pointerDown(mapCanvas!);

    expect(callbacks.onFilterPanelOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onSupplyOpenChange).toHaveBeenCalledWith(false);
    expect(callbacks.onCloseList).toHaveBeenCalledTimes(1);
  });
'''
idx = text.rfind("\n});")
if idx < 0:
    raise SystemExit("MapWorkbenchView test suite closing brace not found")
text = text[:idx] + insert + text[idx:]
p.write_text(text)


# Durable record, inserted ahead of the previous Map 2.0 entry.
p = Path("CHANGELOG.md")
text = p.read_text()
marker = "\n---\n\n## 2026-08-25 — Map 2.0 project inventory and presentation density"
entry = """
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
"""
if marker not in text:
    raise SystemExit("CHANGELOG insertion marker missing")
text = text.replace(marker, "\n" + entry + "\n---\n\n## 2026-08-25 — Map 2.0 project inventory and presentation density", 1)
p.write_text(text)
