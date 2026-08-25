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
    expect(home).toContain('FileSearch');
    expect(home).not.toContain('<WorkspaceCard workspace={ADMIN_WORKSPACE}');
  });

  it('preserves Home access, audit and route seams while avoiding duplicate keyboard activation', () => {
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
      '当前账号无访问权限',
    ]) {
      expect(home).toContain(contract);
    }

    expect(home).not.toContain('handleWorkspaceKeyDown');
    expect(home).not.toContain('onKeyDown={(event) => handleWorkspaceKeyDown');
  });

  it('hardens the user menu for pointer, keyboard and touch interaction', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');

    expect(home).toContain("document.addEventListener('pointerdown'");
    expect(home).toContain("event.key !== 'Escape'");
    expect(home).toContain("event.key !== 'ArrowDown'");
    expect(home).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']");
    expect(home).toContain('requestAnimationFrame(() => menuTriggerRef.current?.focus())');
    expect(home).toContain('min-h-10');
    expect(home).toContain('aria-controls="home-user-menu"');
  });

  it('keeps Home collaboration read-only while hardening the full communication workflow', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');

    expect(communication).not.toContain('bg-[#003e7e]');
    expect(communication).not.toContain('animate-ping');
    expect(communication).not.toContain('实时更新');
    expect(communication).toContain('messages.slice(-4)');
    expect(communication).toContain('MAX_MESSAGES = 50');
    expect(communication).toContain("fullscreen ? messages : messages.slice(-4)");
    expect(communication).toContain("fullscreen ? '退出' : '查看交流'");
    expect(communication).toContain('role="dialog"');
    expect(communication).toContain('aria-modal="true"');
    expect(communication).toContain('history.pushState');
    expect(communication).toContain("window.addEventListener('popstate'");
    expect(communication).toContain("event.key === 'Escape'");
    expect(communication).toContain("event.key !== 'Tab'");
    expect(communication).toContain('h-[100dvh]');
    expect(communication).toContain('safe-area-inset-bottom');
    expect(communication).toContain('break-words');
    expect(communication).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(communication).toContain('setLoadError(true)');
    expect(communication).toContain('setSendError');
    expect(communication).toContain('setSending(true)');
    expect(communication).toContain('disabled={sending || !inputText.trim()}');
    expect(communication).toContain('发送失败，内容已保留，请重试。');
    expect(communication).toContain('有新消息');
    expect(communication).not.toContain("fullscreen ? '退出' : '查看全部'");

    expect(notice).not.toContain('animate-marquee');
    expect(notice).not.toContain('text-[10px]');
    expect(notice).toContain('loadError');
    expect(notice).toContain('查看全部 ${notices.length} 条公告');
    expect(notice).toContain('visibleNotices = expanded ? notices : notices.slice(0, 3)');
    expect(notice).toContain('break-words');
    expect(notice).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(notice).not.toContain('max-h-32');
    expect(notice).not.toContain('overflow-y-auto');
  });
});
