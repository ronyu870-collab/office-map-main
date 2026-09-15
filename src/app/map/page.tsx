import './map-workbench.css';
import './map-native-overlays.css';
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
  const initialIntelligenceHandoff = parseIntelligenceMapHandoff(toUrlSearchParams(resolvedSearchParams));

  return (
    <>
      <MapBuildingCompareBridge />
      <MapLeaseTransactionsBridge />
      {initialIntelligenceHandoff ? <MapProposalBridge enabled /> : null}
      <MapCompetitorModeGuard />
      <MapRouteGate initialIntelligenceHandoff={initialIntelligenceHandoff} />
    </>
  );
}
