'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchRepresentativeBrochures } from '@/src/services/map/marketAssetResearchClient';
import { marketBrochureFields, projectBrochureParameters, type BrochureAsset } from '../model/marketBrochureComparison';

const format = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

/** Read the existing role-filtered selected-building endpoint only on request.
 * Keep one real edition and render the public parameter allowlist. */
export function BuildingBrochureFacts({ buildingId, active, opened, onToggle }: {
  buildingId: string; active: boolean; opened: boolean; onToggle: () => void;
}) {
  const id = React.useId();
  const [retry, setRetry] = React.useState(0);
  const [result, setResult] = React.useState<{ key: string; asset: BrochureAsset | null; error: boolean } | null>(null);
  const key = JSON.stringify([buildingId, retry]);
  React.useEffect(() => {
    if (!opened || !active) return;
    const controller = new AbortController();
    void fetchRepresentativeBrochures([buildingId], controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ key, asset: projectBrochureParameters(rows, [buildingId])[0] ?? null, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, asset: null, error: true });
    });
    return () => controller.abort();
  }, [buildingId, key, opened, active]);
  const resolved = active && result?.key === key ? result : null;
  const asset = resolved?.asset;
  const fields = marketBrochureFields.filter(field => asset?.values[field.key] !== undefined);
  return <section className="workspace-detail-group workspace-brochure-facts" aria-label="楼书参数">
    <button type="button" className="workspace-brochure-toggle" aria-expanded={opened} aria-controls={id} onClick={() => { setResult(null); onToggle(); }}>
      <span>楼书参数</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {opened && <div id={id}>
      {!resolved ? <p role="status" className="workspace-note">正在读取楼书…</p>
        : resolved.error ? <p role="status" className="workspace-note">楼书暂不可用。<button type="button" className="workspace-business-action" onClick={() => setRetry(value => value + 1)}>重试</button></p>
          : !fields.length && !asset?.completionDate ? <p className="workspace-note">暂无可用楼书参数</p>
            : <>
              {asset?.recordedOn && <p className="workspace-period">楼书资料 · {asset.recordedOn}</p>}
              <dl className="workspace-building-facts">
                {fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{format.format(asset!.values[field.key]!)} <span>{field.unit}</span></dd></div>)}
                {asset?.completionDate && <div><dt>楼书竣工日期</dt><dd>{asset.completionDate}</dd></div>}
              </dl>
            </>}
    </div>}
  </section>;
}
