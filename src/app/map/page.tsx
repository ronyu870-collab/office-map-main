import { BROKER_ID, brokerReturn } from '@/src/lib/broker/links';
import { MapSalesMaterialsBridge } from './MapSalesMaterialsBridge';
import './map-workbench.css';
import './map-native-overlays.css';
import './map-building-popup.css';
import { MapBuildingCompareBridge } from './MapBuildingCompareBridge';
import { MapCompetitorModeGuard } from './MapCompetitorModeGuard';
import { MapLeaseTransactionsBridge } from './MapLeaseTransactionsBridge';
import { MapProposalBridge } from './MapProposalBridge';
import { MapRouteGate } from './MapRouteGate';
import { parseIntelligenceMapHandoff } from './model/intelligenceMapHandoff';

type MapPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUrlSearchParams(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === 'string') {
      params.set(key, value);
    }
  }
  return params;
}

export default async function MapPage({ searchParams }: MapPageProps) {
  const resolvedSearchParams = await searchParams;
  const params = toUrlSearchParams(resolvedSearchParams);
  const initialIntelligenceHandoff = parseIntelligenceMapHandoff(params);
  const future = params.get('future');
  const id = future ?? params.get('building');
  const section = params.get('section');
  const buildingFocus = id && BROKER_ID.test(id) ? {
    id, future: Boolean(future), section: section === 'brochure' || section === 'availability' || section === 'deals' ? section : undefined,
    back: brokerReturn(params.get('back')),
  } as const : null;

  return (
    <>
      <MapBuildingCompareBridge />
      <MapLeaseTransactionsBridge />
      <MapSalesMaterialsBridge />
      {initialIntelligenceHandoff ? <MapProposalBridge enabled /> : null}
      <MapCompetitorModeGuard />
      <MapRouteGate initialIntelligenceHandoff={initialIntelligenceHandoff} buildingFocus={buildingFocus} />
    </>
  );
}
