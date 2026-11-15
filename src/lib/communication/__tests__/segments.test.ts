import { describe, expect, it } from 'vitest';
import { editorSegments, normalizeMarketSegments, segmentText } from '../segments';

describe('market rich text and mentions', () => {
  it('accepts only small whitelisted content and prevents HTML or forged field storage', () => {
    expect(normalizeMarketSegments([{ text: 'hello', bold: true, color: 'red' }])).toEqual([
      { text: 'hello', bold: true, color: 'red' },
    ]);
    for (const input of [
      null, [],
      [{ text: ' ' }],
      [{ text: '<script>', html: '<script>' }],
      [{ text: 'bad', color: 'orange' }],
      [{ text: '@所有人', everyone: false }],
      [{ text: '@无效', mentionUserId: 'not-uuid' }],
      [{ text: 'x'.repeat(2001) }],
      Array.from({ length: 101 }, () => ({ text: 'x' })),
    ]) expect(normalizeMarketSegments(input) ?? []).toHaveLength(0);
  });

  it('extracts command-produced bold and strict color palette without interpreting scripts', () => {
    const root = document.createElement('div');
    root.innerHTML = '<strong>加粗</strong><span style="color: rgb(201, 54, 43)">红色</span><font color="#16855b">绿色</font><span style="color: orange">默认色</span>';
    const segments = editorSegments(root);
    expect(segmentText(segments)).toBe('加粗红色绿色默认色');
    expect(segments[0]).toMatchObject({ bold: true, text: '加粗' });
    expect(segments[1]).toMatchObject({ color: 'red', text: '红色' });
    expect(segments[2]).toMatchObject({ color: 'green', text: '绿色' });
    expect(segments[3].color).toBeUndefined();
  });

  it('keeps mentioned person identity separate from displayed name', () => {
    const root = document.createElement('div');
    const span = document.createElement('span');
    span.dataset.mentionUserId = '22222222-2222-4222-8222-222222222222';
    span.contentEditable = 'false';
    span.textContent = '@测试同事';
    root.append(span, document.createTextNode(' 已收到'));
    const segments = editorSegments(root);
    expect(segments[0].mentionUserId).toBe('22222222-2222-4222-8222-222222222222');
    expect(segments[1].text).toBe(' 已收到');
  });
});
