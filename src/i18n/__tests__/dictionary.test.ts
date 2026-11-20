import { describe, expect, it } from 'vitest';
import glossary from '../professional-glossary.json';
import { findProfessionalEnglish } from '../terminology';
import { translateUiText } from '../messages';

describe('basic bilingual terminology', () => {
  it('preserves Chinese by default and falls back safely for untranslated copy', () => {
    expect(translateUiText('租赁成交填报', 'zh-CN')).toBe('租赁成交填报');
    expect(translateUiText('租赁成交填报', 'en-US')).toBe('Lease Transaction Entry');
    expect(translateUiText('不可预期的中文原文', 'en-US')).toBe('不可预期的中文原文');
  });

  it('ships a curated, non-ambiguous domain-keyed glossary', () => {
    expect(glossary.length).toBeGreaterThanOrEqual(180);
    const keys = glossary.map(item => `${item.domain}:${item.zh_cn}`);
    expect(new Set(keys).size).toBe(glossary.length);
    for (const term of glossary) {
      expect(term.zh_cn.trim()).not.toBe('');
      expect(term.en_us.trim()).not.toBe('');
    }
    expect(findProfessionalEnglish('净有效租金', 'leasing')).toBe('Net Effective Rent');
    expect(findProfessionalEnglish('租赁堆叠图', 'stacking_plan')).toBe('Stacking Plan');
  });
});
