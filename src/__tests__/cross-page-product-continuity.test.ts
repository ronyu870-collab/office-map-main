import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Cross-page product continuity', () => {
  it('keeps Home as the canonical Chinese product naming contract', () => {
    const home = source('src/components/home/HomeWorkspace.tsx');
    for (const label of ['北京办公楼市场地图', '季度数据填报', '租赁成交填报', '研究资料库', '系统管理', '设置']) {
      expect(home).toContain(label);
    }
  });

  it('keeps the Map GIS shell branded and aligned to the Home product name', () => {
    const gate = source('src/app/map/MapRouteGate.tsx');
    const view = source('src/app/map/components/MapWorkbenchView.tsx');
    expect(gate).toContain('h-[58px]');
    expect(gate).toContain('北京办公楼市场地图');
    expect(view).toContain('北京办公楼市场地图');
    expect(view).not.toContain('MAP 2.0');
    expect(view).not.toContain('MAP WORKBENCH');
    expect(view).toContain('href="/"');
  });

  it('uses the canonical product and workflow language in Quarterly Update', () => {
    const page = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');
    expect(page).toContain('季度数据填报');
    for (const oldLabel of ['QUARTERLY UPDATE', 'Cloud draft enabled', 'Save draft', 'Submit current group', 'Retry submit']) {
      expect(page).not.toContain(oldLabel);
    }
    expect(page).toContain('href="/"');
  });

  it('uses the canonical product and workflow language in Lease Submission', () => {
    const page = source('src/app/lease-submission/page.tsx');
    expect(page).toContain('租赁成交填报');
    for (const oldLabel of ['LEASE SUBMISSION', 'Data Entry Workspace', 'Weekly target', 'My submissions', 'New transaction', 'Transfer record']) {
      expect(page).not.toContain(oldLabel);
    }
    expect(page).toContain('href="/"');
  });

  it('presents Research as a library rather than an OSS console', () => {
    const page = source('src/app/oss/page.tsx');
    const manager = source('src/components/OSSManager.tsx');
    expect(page).toContain('研究资料库');
    expect(page).toContain('搜索、定位、打开和维护内部研究资料');
    expect(manager).toContain('研究资料库');
    expect(manager).not.toContain('>Research Library</button>');
    expect(manager).not.toContain('>Upload status</span>');
    expect(manager).toContain('canManage ?');
    expect(page).toContain('href="/"');
  });

  it('aligns Settings and Admin identities with the Home user menu', () => {
    const settings = source('src/app/settings/page.tsx');
    const adminLayout = source('src/app/admin/layout.tsx');
    const adminSidebar = source('src/components/admin/AdminSidebar.tsx');
    expect(settings).toContain('>设置</span>');
    expect(adminLayout).toContain('>系统管理</span>');
    expect(adminLayout).not.toContain('>Administration</span>');
    expect(adminSidebar).not.toContain("label: 'Data Management'");
    expect(adminSidebar).not.toContain('>Administration</span>');
    expect(settings).toContain('href="/"');
    expect(adminLayout).toContain('href="/"');
  });
});
