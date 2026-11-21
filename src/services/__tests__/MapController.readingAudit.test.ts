import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MapController } from '../MapController';
import { AuditPolicyGate } from '@/src/utils/auditPolicy';

const observed = vi.hoisted(() => ({ events: [] as Array<{ action: string; details: Record<string, unknown> }>, gate: null as AuditPolicyGate | null }));
vi.mock('@/src/utils/audit', () => ({ logAction: (_: unknown, action: string, details: Record<string, unknown>) => {
  if (observed.gate!.shouldRecord(action, details)) observed.events.push({ action, details });
} }));

const building = { id: 'stock-a', name: '甲楼', metrics: [], contact_phone: '13800000000' };
function controller(workspace = true) {
  const value = new MapController() as any;
  Object.assign(value, { map: { remove: vi.fn() }, AMap: {
    Pixel: class {}, InfoWindow: class { on() {} open() {} close() {} },
  }, _allBuildingsCache: [building] });
  if (workspace) value.setWorkspaceDetailHandler(vi.fn());
  return value;
}
beforeEach(() => { observed.events.length = 0; observed.gate = new AuditPolicyGate(); });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('unifies marker, list/search/return and future detail opens without merging different objects', () => {
  const value = controller();
  // Native markers call the shared presentation path; list/search/return use the public opener.
  value.showBuildingPopup(building, null);
  value.openBuildingInfoWindow(building.id);
  value.openFutureSupplyInfoWindow({ ...building, id: 'future-a', building_id: building.id });
  value.openFutureSupplyInfoWindow({ ...building, id: 'future-a', building_id: building.id });
  value.showBuildingPopup({ ...building, id: 'stock-b' }, null);
  expect(observed.events.map(event => [event.action, event.details.building_id, event.details.target_table])).toEqual([
    ['VIEW_BUILDING', 'stock-a', 'buildings'], ['VIEW_BUILDING', 'future-a', 'future_supplies'], ['VIEW_BUILDING', 'stock-b', 'buildings'],
  ]);
  expect(value.workspaceDetailHandler).toHaveBeenCalledTimes(5);
});

it('covers legacy popup rendering and skips invalid or destroyed opens', () => {
  const value = controller(false);
  vi.spyOn(value, 'createBuildingPopupContent').mockReturnValue(document.createElement('div'));
  value.showBuildingPopup({ ...building, location_lng: 116, location_lat: 40 }, null);
  value.openFutureSupplyInfoWindow({ id: 'future-a', name: '未来', location_lng: 116, location_lat: 40 });
  value.openFutureSupplyInfoWindow({ id: 'bad', name: '无坐标' });
  value._destroyed = true;
  value.showBuildingPopup({ ...building, id: 'destroyed' }, null);
  expect(observed.events.map(event => event.details.building_id)).toEqual(['stock-a', 'future-a']);
});

it('records rendered contacts through both presenters, without copying phone or contact contents', () => {
  const value = controller();
  value.runWorkspaceBuildingAction('contact', building);
  expect(document.getElementById('__colliers_contact_modal_overlay')).toBeTruthy();
  (window as any).__colliers_showContactModal(building.name, building.contact_phone, building.id);
  expect(observed.events).toEqual([{ action: 'VIEW_BUILDING_CONTACT', details: {
    module: 'map', target_table: 'buildings', building_id: 'stock-a', building_name: '甲楼', data_type: 'existing',
  } }]);
  expect(JSON.stringify(observed.events)).not.toContain(building.contact_phone);
});

it('does not expose masked demo building identity or contacts in observations', () => {
  const value = controller(); value._isDemo = true;
  value.openBuildingInfoWindow(building.id);
  value.runWorkspaceBuildingAction('contact', building);
  expect(observed.events).toEqual([]);
});
