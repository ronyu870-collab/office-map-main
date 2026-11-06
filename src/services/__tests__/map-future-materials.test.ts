import { describe, expect, it, vi } from 'vitest';
vi.mock('../supabaseClient', () => ({supabase:{}}));
vi.mock('../Auth', () => ({getSessionFast:vi.fn()}));
import {MapController} from '../MapController';
describe('future supply material association',()=>{
 it('uses the linked building id and escapes its name',()=>{
  const controller=Object.create(MapController.prototype);
  controller._isDemo=false;
  const host=document.createElement('div');
  host.innerHTML=controller.buildFutureSupplyInfoWindow({id:'future-row',building_id:'building-master',name:'未来"楼<甲>'});
  const button=host.querySelector<HTMLButtonElement>('[data-map-action="building-sales-control"]');
  expect(button?.dataset.buildingId).toBe('building-master');
  expect(button?.dataset.buildingName).toBe('未来"楼<甲>');
  expect(button?.textContent).toContain('项目资料与佣金');
 });
 it('does not substitute an unlinked future supply row id for a building id',()=>{
  const controller=Object.create(MapController.prototype);
  controller._isDemo=false;
  const host=document.createElement('div');
  host.innerHTML=controller.buildFutureSupplyInfoWindow({id:'future-row',name:'未关联项目'});
  expect(host.querySelector('[data-map-action="building-sales-control"]')).toBeNull();
 });
});
