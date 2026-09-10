import './map-workbench.css';
import './map-native-overlays.css';
import { MapBuildingCompareBridge } from './MapBuildingCompareBridge';
import { MapRouteGate } from './MapRouteGate';

export default function MapPage() {
  return (
    <>
      <MapBuildingCompareBridge />
      <MapRouteGate />
    </>
  );
}
