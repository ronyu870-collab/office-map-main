type MapStartupStage = 'authorized' | 'controller_ready' | 'sdk_start' | 'sdk_ready'
  | 'tiles_complete' | 'visual_ready' | 'stock_read_start' | 'stock_data_ready'
  | 'stock_render_start' | 'stock_render_returned';

// Set only by the local navigation collector. No logging, persistence or upload.
export function recordMapStartup(stage: MapStartupStage) {
  if (typeof window === 'undefined') return;
  const probe = (window as Window & { __colliersNavigationProbe?: { recordMapStage?: (stage: MapStartupStage) => void } }).__colliersNavigationProbe;
  try { probe?.recordMapStage?.(stage); } catch { /* Measurement must never change map behavior. */ }
}
