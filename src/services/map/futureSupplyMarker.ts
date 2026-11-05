import {
  futureSupplyDisplayLabel,
  safeParseSupplyYear,
  type RenderMode,
} from '@/src/app/map/model/mapDomain';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';

type FutureSupplyMarkerData = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  type?: unknown;
  launch_year?: unknown;
  launch_quarter?: unknown;
};

type MarkerPalette = {
  bgColor: string;
  textColor: string;
  text: string;
};

// This is display precision only; year and pending classification stay in the
// existing domain helpers. Q1–Q4 / H1–H2 are the stored launch-quarter contract.
function expectedTimeLabel(supply: FutureSupplyMarkerData): string {
  if (isPendingFutureSupply(supply)) return '待核实';
  const year = safeParseSupplyYear(supply);
  if (year === null || !Number.isInteger(year)) return '时间待定';
  const quarter = typeof supply.launch_quarter === 'string'
    && /^(Q[1-4]|H[12])$/.test(supply.launch_quarter)
    ? supply.launch_quarter
    : null;
  return quarter ? `预计 ${year} ${quarter}` : `预计 ${year}年`;
}

/** Small SDK content adapter: all supplied text enters the DOM as text. */
export function createFutureSupplyMarker(
  supply: FutureSupplyMarkerData,
  renderMode: RenderMode,
  palette: MarkerPalette,
): HTMLButtonElement {
  const pending = isPendingFutureSupply(supply);
  const timeLabel = expectedTimeLabel(supply);
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'map-future-marker';
  marker.dataset.futureSupplyId = String(supply.id ?? '');
  marker.dataset.pending = String(pending);
  marker.dataset.renderMode = renderMode;
  marker.setAttribute('aria-label', [
    `查看${String(supply.name || '未命名项目')}`,
    futureSupplyDisplayLabel(supply),
    ...(pending ? [] : [timeLabel]),
  ].join('，'));

  const core = document.createElement('span');
  core.className = 'map-future-marker__core';
  core.setAttribute('aria-hidden', 'true');
  // Future projects have no operating rent/vacancy metric. Keep their future
  // identity instead of replacing them with the ordinary missing-data dash.
  core.textContent = pending ? '?' : renderMode === 'leed' ? palette.text : 'F';
  if (renderMode === 'leed' && !pending && palette.text !== 'N') {
    marker.style.setProperty('--map-future-background', palette.bgColor);
    // The darker certification tone keeps the future dash legible on the
    // light map; the original pale border color alone loses that distinction.
    marker.style.setProperty('--map-future-border', palette.textColor);
    marker.style.setProperty('--map-future-ink', palette.textColor);
  }

  const label = document.createElement('span');
  label.className = 'map-future-marker__time';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = timeLabel;
  marker.append(core, label);
  return marker;
}
