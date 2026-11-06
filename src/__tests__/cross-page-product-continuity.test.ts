import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Cross-page product continuity', () => {
  it('keeps Home as the canonical Chinese product naming contract', () => {
    const home = source('src/components/home/HomeWorkspace.tsx');
    for (const label of ['北京办公楼市场地图', '季度数据填报', '租赁成交填报', '研究资料库', '系统管理', '修改密码']) {
      expect(home).toContain(label);
    }
  });

  it('keeps the Map GIS shell branded and aligned to the Home product name', () => {
    const gate = source('src/app/map/MapRouteGate.tsx');
    const loadingShell = source('src/app/map/components/MapLoadingShell.tsx');
    const appHeader = source('src/components/ui/AppHeader.tsx');
    const view = source('src/app/map/components/MapWorkbenchView.tsx');
    expect(gate).toContain('<MapLoadingShell />');
    expect(appHeader).toContain('var(--cd-header-height)');
    expect(loadingShell).toContain('北京办公楼市场地图');
    expect(view).toContain('北京办公楼市场地图');
    expect(view).not.toContain('COLLIERS DATA');
    expect(view).not.toContain('MAP 2.0');
    expect(view).not.toContain('MAP WORKBENCH');
    expect(view).toContain('homeHref="/"');
  });

  it('uses the canonical product and workflow language in Quarterly Update', () => {
    const page = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');
    expect(page).toContain('季度数据填报');
    for (const oldLabel of ['QUARTERLY UPDATE', 'Cloud draft enabled', 'Save draft', 'Submit current group', 'Retry submit']) {
      expect(page).not.toContain(oldLabel);
    }
    expect(page).toContain('homeHref="/"');
  });

  it('uses the canonical product and workflow language in Lease Submission', () => {
    const page = source('src/app/lease-submission/page.tsx');
    expect(page).toContain('租赁成交填报');
    for (const oldLabel of ['LEASE SUBMISSION', 'Data Entry Workspace', 'Weekly target', 'My submissions', 'New transaction', 'Transfer record']) {
      expect(page).not.toContain(oldLabel);
    }
    expect(page).toContain('homeHref="/"');
  });

  it('presents Research as a concise library rather than an OSS console', () => {
    const page = source('src/app/oss/page.tsx');
    const manager = source('src/components/OSSManager.tsx');
    expect(page).toContain('研究资料库');
    expect(page).not.toContain('搜索、定位、打开和维护内部研究资料');
    expect(manager).toContain('全部资料');
    expect(manager).not.toContain('>Research Library</button>');
    expect(manager).not.toContain('>Upload status</span>');
    expect(manager).toContain('canManage ?');
    expect(page).toContain('homeHref="/"');
  });

  it('aligns Settings and Admin identities with the Home user menu', () => {
    const settings = source('src/app/settings/page.tsx');
    const adminLayout = source('src/app/admin/layout.tsx');
    const adminSidebar = source('src/components/admin/AdminSidebar.tsx');
    expect(settings).toContain('title="修改密码"');
    expect(adminLayout).toContain('title="系统管理"');
    expect(adminLayout).not.toContain('>Administration</span>');
    expect(adminSidebar).not.toContain("label: 'Data Management'");
    expect(adminSidebar).not.toContain('>Administration</span>');
    expect(settings).toContain("homeHref={passwordChangeRequired ? undefined : '/'}");
    expect(adminLayout).toContain('homeHref="/"');
  });

  it('keeps Admin navigation concise and non-repetitive', () => {
    const page = source('src/app/admin/page.tsx');
    const layout = source('src/app/admin/layout.tsx');
    const sidebar = source('src/components/admin/AdminSidebar.tsx');

    expect(layout).not.toContain('数据管理后台');
    expect(page).not.toContain('meta.group');
    expect(page).not.toContain('activeMeta');
    expect(sidebar).toContain("label: '用户'");
    expect(sidebar).toContain("label: '用户管理'");
    expect(sidebar).toContain("label: '开发'");
    expect(sidebar.match(/label: '开发'/g)).toHaveLength(1);
    expect(sidebar).not.toContain("label: '开发与维护'");
    expect(sidebar).not.toContain("label: '用户与权限'");
  });

  it('uses one visible role vocabulary across Home and User Manager', () => {
    const roles = source('src/types/auth.ts');
    const home = source('src/components/home/HomeWorkspace.tsx');
    const users = source('src/components/admin/UserManager.tsx');
    const combined = `${roles}\n${home}\n${users}`;

    expect(roles).toContain("viewer: '查看用户'");
    expect(roles).toContain("user: '查看用户'");
    expect(roles).toContain("editor: '编辑用户'");
    expect(roles).toContain("admin: '管理员'");
    expect(home).toContain('getUserRoleLabel(role)');
    expect(users).toContain('getUserRoleLabel(row.role)');
    expect(combined).not.toContain('普通用户');
    expect(combined).not.toContain('编辑者');
  });
});
