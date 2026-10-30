import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const source=readFileSync('src/services/MapController.ts','utf8');
describe('地图楼宇资料入口',()=>{
 it('offers a scoped material button after contact details',()=>{
  const start=source.indexOf('data-map-action="building-sales-control"');
  expect(start).toBeGreaterThan(source.indexOf('联系方式'));
  const entry=source.slice(start,source.indexOf('</button>',start));
  expect(entry).toContain('data-building-id=');expect(entry).toContain('data-building-name=');
  expect(entry).toContain('项目资料与佣金');expect(entry).not.toContain('aria-disabled="true"');
 });
 it('delegates interactions to the React bridge rather than a global inline handler',()=>{expect(source).not.toContain('__colliers_buildingSalesControl');});
});
