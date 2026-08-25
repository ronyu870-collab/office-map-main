import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Home collaboration final QA contract', () => {
  it('keeps Home collaboration secondary and read-only until full communication opens', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(home).toContain('React.startTransition(() => setShowCommunication(true))');
    expect(home).toContain('aria-label="团队动态"');
    expect(communication).toContain("const visibleMessages = fullscreen ? messages : messages.slice(-4)");
    expect(communication).toContain("fullscreen ? '退出' : '查看交流'");
    expect(communication).not.toContain('animate-ping');
    expect(communication).not.toContain('在线');
    expect(communication).not.toContain('bg-[#003e7e]');
  });

  it('keeps the full communication surface bounded to the recent 50 messages', () => {
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(communication).toContain('const MAX_MESSAGES = 50');
    expect(communication).toContain('.limit(MAX_MESSAGES)');
    expect(communication).toContain('.slice(-MAX_MESSAGES)');
    expect(communication).toContain('最近 {MAX_MESSAGES} 条');
    expect(communication).not.toContain('全部历史');
    expect(communication).not.toContain('Load More');
  });

  it('protects rapid sending, preserves failed content, and de-duplicates realtime inserts', () => {
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(communication).toContain('const sendingRef = useRef(false)');
    expect(communication).toContain('if (!msgContent || sendingRef.current) return');
    expect(communication).toContain('sendingRef.current = true');
    expect(communication).toContain('sendingRef.current = false');
    expect(communication).toContain('发送失败，内容已保留，请重试。');
    expect(communication).toContain('prev.some((message) => message.id === incomingMessage.id)');
    expect(communication).toContain('disabled={sending || !inputText.trim()}');
  });

  it('keeps one subscription across fullscreen toggles and removes it on unmount', () => {
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(communication).toContain(".channel('public:messages')");
    expect(communication).toContain('void supabase.removeChannel(channel)');
    expect(communication).toContain('}, [loadMessages, scrollToBottom]);');
    expect(communication).not.toContain('}, [fullscreen, loadMessages, scrollToBottom]);');
  });

  it('keeps history, focus containment, and new-message reading behavior explicit', () => {
    const communication = read('src/components/CommunicationBoard.tsx');

    expect(communication).toContain('window.history.pushState');
    expect(communication).toContain("window.addEventListener('popstate'");
    expect(communication).toContain("event.key === 'Escape'");
    expect(communication).toContain("event.key !== 'Tab'");
    expect(communication).toContain('requestAnimationFrame(() => toggleButtonRef.current?.focus())');
    expect(communication).toContain('isNearBottomRef.current');
    expect(communication).toContain('setHasNewMessages(true)');
    expect(communication).toContain('有新消息');
  });

  it('uses Beijing-aware cross-year timestamps and mobile safe-area viewport contracts', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');
    const layout = read('src/app/layout.tsx');

    expect(communication).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(communication).toContain('isCurrentYear');
    expect(communication).toContain("year: 'numeric' as const");
    expect(communication).toContain('h-[100dvh]');
    expect(communication).toContain('safe-area-inset-top');
    expect(communication).toContain('safe-area-inset-bottom');
    expect(layout).toContain('viewportFit: "cover"');

    expect(notice).toContain("BEIJING_TIME_ZONE = 'Asia/Shanghai'");
    expect(notice).toContain('grid-cols-[5.5rem_minmax(0,1fr)]');
    expect(notice).toContain('whitespace-nowrap');
    expect(notice).not.toContain('overflow-y-auto');
  });

  it('distinguishes loading failures from true empty states and keeps notices page-scrolling', () => {
    const communication = read('src/components/CommunicationBoard.tsx');
    const notice = read('src/components/NoticeBanner.tsx');

    expect(communication).toContain('市场交流暂时无法加载');
    expect(communication).toContain('暂无市场交流');
    expect(communication).toContain('重试');

    expect(notice).toContain('公告暂时无法加载');
    expect(notice).toContain('if (notices.length === 0) return null');
    expect(notice).toContain('visibleNotices = expanded ? notices : notices.slice(0, 3)');
    expect(notice).toContain('收起公告');
    expect(notice).not.toContain('max-h-');
    expect(notice).not.toContain('overflow-y-auto');
  });
});
