import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../supabaseClient', () => ({ supabase: {} }));
vi.mock('../Auth', () => ({ getSessionFast: vi.fn() }));
import { MapController } from '../MapController';

function fixture() {
  const controller = new MapController();
  const markers: unknown[] = [];
  const nativePopup = vi.fn();
  Object.assign(controller, {
    AMap: { Marker: class { constructor(public options: unknown) { markers.push(options); } }, InfoWindow: nativePopup },
    map: { add: vi.fn(), remove: vi.fn() },
    _allBuildingsCache: [
      { id: 'a', name: '甲楼', location_lng: 116.4, location_lat: 39.9, metrics: [] },
      { id: 'b', name: '乙楼', location_lng: 116.5, location_lat: 39.9, metrics: [] },
      { id: 'missing', name: '无坐标楼', location_lng: null, location_lat: null, metrics: [] },
    ],
  });
  const detail = vi.fn();
  controller.setWorkspaceDetailHandler(detail);
  return { controller, detail, markers, nativePopup };
}
afterEach(() => vi.restoreAllMocks());
describe('real MapController workspace adapter', () => {
  it('publishes each selection immediately, replaces its marker and never constructs a native popup', () => {
    const { controller, detail, markers, nativePopup } = fixture();
    controller.openBuildingInfoWindow('a');
    controller.openBuildingInfoWindow('b');
    expect(detail.mock.calls.map(([value]) => value.building.id)).toEqual(['a', 'b']);
    expect(markers).toHaveLength(2);
    expect((controller as any).map.remove).toHaveBeenCalledTimes(1);
    expect(nativePopup).not.toHaveBeenCalled();
    controller.closeWorkspaceBuilding();
    expect((controller as any).map.remove).toHaveBeenCalledTimes(2);
  });
  it('opens authorized stock and future records without coordinates and preserves material identity', () => {
    const { controller, detail, markers, nativePopup } = fixture();
    controller.openBuildingInfoWindow('missing');
    expect(detail.mock.lastCall?.[0].building.id).toBe('missing');
    controller.openFutureSupplyInfoWindow({ id: 'future', building_id: 'master', name: '未来楼', location_lng: null });
    expect(detail.mock.lastCall?.[0].building).toMatchObject({ id: 'future', building_id: 'master', _dataType: 'future' });
    expect(detail.mock.lastCall?.[0].metric).toBeNull();
    expect(markers).toHaveLength(0);
    expect(nativePopup).not.toHaveBeenCalled();
    controller.openBuildingInfoWindow('unauthorized');
    expect(detail).toHaveBeenCalledTimes(2);
  });
  it('retains edit allow and deny boundaries, including demo mode', () => {
    const { controller, detail } = fixture();
    const edit = vi.fn();
    const building = (controller as any)._allBuildingsCache[0];
    Object.assign(controller, { _onEditBuildingMetrics: edit });
    controller.runWorkspaceBuildingAction('edit', building);
    expect(edit).not.toHaveBeenCalled();
    Object.assign(controller, { _isAdmin: true });
    controller.openBuildingInfoWindow('a');
    expect(detail.mock.lastCall?.[0].canEdit).toBe(true);
    controller.runWorkspaceBuildingAction('edit', building);
    expect(edit).toHaveBeenCalledWith('a', '甲楼');
    Object.assign(controller, { _isDemo: true });
    controller.openBuildingInfoWindow('a');
    expect(detail.mock.lastCall?.[0]).toMatchObject({ canEdit: false, isDemo: true });
    controller.runWorkspaceBuildingAction('edit', building);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
