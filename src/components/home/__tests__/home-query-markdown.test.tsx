import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeQueryMarkdown } from '../HomeQueryMarkdown';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('shared AI Markdown answers', () => {
  it('renders bold, emphasis, lists, quotes, GFM tables and code as semantic content', () => {
    const text = '# 研究结论\n\n**净有效租金**与*空置率*\n\n- 第一项\n- 第二项\n\n> 保留统计口径。\n\n| 指标 | 数值 |\n| --- | ---: |\n| 租金 | 170 |\n\n`**原样代码**`\n\n```text\n**不要加粗**\n```';
    const { container } = render(<HomeQueryMarkdown text={text} />);
    expect(screen.getByText('净有效租金').tagName).toBe('STRONG');
    expect(screen.getByText('空置率').tagName).toBe('EM');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('blockquote')).toHaveTextContent('保留统计口径');
    expect(screen.getByRole('table')).toHaveTextContent('170');
    expect(screen.getByText('**原样代码**').tagName).toBe('CODE');
    expect(screen.getByText('**不要加粗**').closest('pre')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '研究结论' })).toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('preserves escaped asterisks rather than applying a blanket string replacement', () => {
    const { container } = render(<HomeQueryMarkdown text={'\\*\\*原始符号\\*\\* 与 **需要强调**'} />);
    expect(container).toHaveTextContent('**原始符号** 与 需要强调');
    expect(container.querySelectorAll('strong')).toHaveLength(1);
  });

  it('never executes raw HTML, unsafe links or model-supplied remote images', () => {
    const { container } = render(<HomeQueryMarkdown text={'<script>alert(1)</script>\n\n<img src="https://example.com/private-query" onerror="alert(1)">\n\n[危险](javascript:alert%281%29) [来源](https://example.com/report) ![图片说明](https://example.com/tracker.png)'} />);
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(screen.queryByRole('link', { name: '危险' })).toBeNull();
    const link = screen.getByRole('link', { name: '来源' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByText('图片说明')).toBeInTheDocument();
  });

  it('accepts incomplete streaming Markdown, batches updates and flushes the exact completion immediately', () => {
    vi.useFakeTimers();
    const { rerender } = render(<HomeQueryMarkdown text="**正在" streaming aria-label="生成中的回答" />);
    for (const text of ['**正在分', '**正在分析', '**正在分析**']) rerender(<HomeQueryMarkdown text={text} streaming aria-label="生成中的回答" />);
    expect(screen.queryByText('正在分析')).toBeNull();
    act(() => vi.advanceTimersByTime(80));
    expect(screen.getByText('正在分析').tagName).toBe('STRONG');
    rerender(<HomeQueryMarkdown text={'**完成**\n\n最终内容。'} aria-label="回答" />);
    expect(screen.getByText('完成').tagName).toBe('STRONG');
    expect(screen.getByText('最终内容。')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText('正在分析')).toBeNull();
  });

  it('provides optional long-answer navigation with distinct targets for repeated headings', () => {
    const long = ['## 同名标题', '研究正文。'.repeat(160), '## 同名标题', '研究正文。'.repeat(160), '```text', '## 代码中的假标题', '```', '## 样本说明', '研究正文。'.repeat(160)].join('\n\n');
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const { container } = render(<HomeQueryMarkdown text={long} />);
    fireEvent.click(screen.getByText('回答目录'));
    const sections = screen.getAllByRole('button', { name: '同名标题' });
    expect(sections).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '代码中的假标题' })).toBeNull();
    fireEvent.click(sections[1]);
    expect(screen.getAllByRole('heading', { name: '同名标题' })[1]).toHaveFocus();
    const ids = [...container.querySelectorAll('h3')].map(heading => heading.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(scroll).toHaveBeenCalled();
  });
});
