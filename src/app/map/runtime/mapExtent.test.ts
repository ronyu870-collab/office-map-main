import { expect, it } from 'vitest';
import { coordinateIssue, fitMapExtent } from './mapExtent';
import { visibleMapRect } from './mapFocusViewport';

it('deducts only real overlap, not adjacent desktop columns', () => {
  const canvas = new DOMRect(280, 60, 800, 700);
  expect(visibleMapRect(canvas, { left: new DOMRect(0,60,280,700), right: new DOMRect(1080,60,400,700) }))
    .toEqual(visibleMapRect(canvas));
  const covered = visibleMapRect(canvas, { bottom: new DOMRect(280,550,800,210) });
  expect(covered.bottom).toBe(534);
});
it('diagnoses invalid coordinates and includes legal distant projects', () => {
  expect(coordinateIssue({id:'missing'})).toBe('missing');
  expect(coordinateIssue({id:'swapped',location_lng:40,location_lat:116})).toBe('out-of-range');
  expect(coordinateIssue({id:'zero',location_lng:0,location_lat:0})).toBe('zero-origin');
  const far = {id:'far',location_lng:121.4,location_lat:31.2};
  const camera = fitMapExtent([{id:'beijing',location_lng:116.4,location_lat:39.9}, far],new DOMRect(0,0,800,600));
  expect(camera?.located).toBe(2); expect(camera!.zoom).toBeLessThan(7);
  expect(fitMapExtent([],new DOMRect(0,0,800,600))).toBeNull();
});
