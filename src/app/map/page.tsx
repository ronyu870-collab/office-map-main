import './map-workbench.css';
import './map-native-overlays.css';
import { MapBuildingCompareBridge } from './MapBuildingCompareBridge';
import { MapCompetitorModeGuard } from './MapCompetitorModeGuard';
import { MapRouteGate } from './MapRouteGate';

export default function MapPage() {
  return (
    <>
      <MapBuildingCompareBridge />
      <MapCompetitorModeGuard />
      <MapRouteGate />
    </>
  );
}
