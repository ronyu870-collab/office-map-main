import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Home workspace presentation contract', () => {
  it('keeps the Home product language Chinese and removes legacy marketing labels', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');

    for (const label of [
      'MAP WORKBENCH',
      'QUARTERLY UPDATE',
      'LEASE SUBMISSION',
      'RESEARCH LIBRARY',
      'ADMIN CONSOLE',
      'Internal · Beijing',
      'Business workspaces',
      'Team activity',
      'System notice',
      '按业务进入',
      '辅助信息',
      '权限入口',
      '>工作台<',
      '>业务工作区<',
    ]) {
      expect(home).not.toContain(label);
    }

    expect(home).toContain("title: '北京办公楼市场地图'");
    expect(home).toContain("title: '季度数据填报'");
    expect(home).toContain("title: '租赁成交填报'");
    expect(home).toContain("title: '研究资料库'");
    expect(home).toContain("title: '系统管理'");
    expect(home).toContain('>常用工作<');
    expect(home).toContain('>团队动态<');
    expect(home).toContain('aria-label="用户菜单"');
    expect(home).not.toContain('<WorkspaceCard workspace={ADMIN_WORKSPACE}');
  });

  it('preserves Home access, audit and route seams while changing presentation', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');

    for (const contract of [
      'useAppSession',
      'canAccessModule',
      'isModuleRestricted',
      'isDemoMode',
      "'ENTER_MODULE'",
      "'LOGOUT'",
      "href: '/map'",
      "href: '/update'",
      "href: '/lease-submission'",
      "href: '/oss'",
      "href: '/admin'",
      'onAdminActivate',
      'CommunicationBoard',
      'NoticeBanner',
    ]) {
      expect(home).toContain(contract);
    }
  });

  it('keeps Home collaboration read-only while preserving the full communication workflow', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');

    expect(communication).not.toContain('bg-[#003e7e]');
    expect(communication).not.toContain('animate-ping');
    expect(communication).not.toContain('实时更新');
    expect(communication).toContain('messages.slice(-4)');
    expect(communication).toContain("fullscreen ? messages : messages.slice(-4)");
    expect(communication).toContain("fullscreen ? '退出' : '查看全部'");
    expect(communication).toContain('{fullscreen ? (\n        <form');
    expect(communication).not.toContain('messages.slice(-6)');

    expect(notice).not.toContain('animate-marquee');
    expect(notice).not.toContain('text-[10px]');
    expect(notice).not.toContain('slice(0, 3)');
    expect(notice).toContain('notices.map');
  });
});
