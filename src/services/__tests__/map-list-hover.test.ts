import { afterEach, expect, it, vi } from 'vitest';
import { MapController } from '../MapController';
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
it('highlights only the hovered future identity and releases removed overlays',()=>{
  document.body.innerHTML='<div data-building-id="same"></div>';
  const added: Array<{setOpacity:ReturnType<typeof vi.fn>;setzIndex:ReturnType<typeof vi.fn>}> = [];
  class Marker { constructor(){added.push(this);} on(){} setOpacity=vi.fn(); setzIndex=vi.fn(); }
  const controller=new MapController();
  Object.assign(controller,{map:{add:vi.fn(),remove:vi.fn(),getContainer:()=>document.body},AMap:{Marker,Pixel:class{}}});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
  controller.renderFutureMarkers([{id:'same',location_lng:116.46,location_lat:39.91}]);
  controller.bounceMarker('same','future');
  expect(added[0].setzIndex).toHaveBeenCalledWith(999999);
  expect(document.querySelector<HTMLElement>('[data-building-id]')!.style.animation).toBe('');
  controller.stopBounceMarker('same','future');expect(added[0].setzIndex).toHaveBeenLastCalledWith(110);
  controller.clearFutureMarkers();added[0].setzIndex.mockClear();
  controller.bounceMarker('same','future');expect(added[0].setzIndex).not.toHaveBeenCalled();
});
