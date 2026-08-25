import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Home collaboration structural contract', () => {
  it('keeps Home read-only and bounds full communication to the recent 50 messages', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(home).toContain('aria-label="团队动态"');
    expect(communication).toContain('const MAX_MESSAGES = 50');
    expect(communication).toContain('.limit(MAX_MESSAGES)');
    expect(communication).toContain('.slice(-MAX_MESSAGES)');
    expect(communication).toContain("const visibleMessages = fullscreen ? messages : messages.slice(-4)");
    expect(communication).toContain('最近 {MAX_MESSAGES} 条');
    expect(communication).not.toContain('全部历史');
    expect(communication).not.toContain('Load More');
  });

  it('keeps Beijing-aware timestamps and mobile viewport/safe-area contracts', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');
    const layout = read('src/app/layout.tsx');

    expect(communication).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(communication).toContain('isCurrentYear');
    expect(communication).toContain('h-[100dvh]');
    expect(communication).toContain('safe-area-inset-top');
    expect(communication).toContain('safe-area-inset-bottom');
    expect(layout).toContain('viewportFit: "cover"');

    expect(notice).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(notice).toContain('grid-cols-[5.5rem_minmax(0,1fr)]');
    expect(notice).toContain('whitespace-nowrap');
  });

  it('keeps notice expansion page-scrolling and distinguishes empty/failure copy', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');

    expect(communication).toContain('市场交流暂时无法加载');
    expect(communication).toContain('暂无市场交流');
    expect(notice).toContain('公告暂时无法加载');
    expect(notice).toContain('if (notices.length === 0) return null');
    expect(notice).toContain('visibleNotices = expanded ? notices : notices.slice(0, 3)');
    expect(notice).toContain('收起公告');
    expect(notice).not.toContain('max-h-');
    expect(notice).not.toContain('overflow-y-auto');
  });
});
