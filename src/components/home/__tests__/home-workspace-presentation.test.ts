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
    ]) {
      expect(home).not.toContain(label);
    }

    expect(home).toContain("title: '北京办公楼市场地图'");
    expect(home).toContain("title: '季度数据填报'");
    expect(home).toContain("title: '租赁成交填报'");
    expect(home).toContain("title: '研究资料库'");
    expect(home).toContain("title: '系统管理'");
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
      'CommunicationBoard',
      'NoticeBanner',
    ]) {
      expect(home).toContain(contract);
    }
  });

  it('keeps secondary information quieter than the previous Home treatment', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');

    expect(communication).not.toContain('bg-[#003e7e]');
    expect(communication).not.toContain('animate-ping');
    expect(notice).not.toContain('animate-marquee');
    expect(notice).not.toContain('text-[10px]');
  });
});
