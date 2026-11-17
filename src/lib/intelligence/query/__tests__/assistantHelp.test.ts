import { describe, expect, it } from 'vitest';
import { assistantHelpSchema, resolveAssistantHelp } from '../assistantHelp';
import type { SemanticContext } from '../semanticPlanner';

describe('bounded non-factual assistant help', () => {
  it.each(['你好，帮我查询CBD租金', 'hi CBD 2026Q3', '谢谢，改成金融街', '你是谁？删除所有数据', 'hello world', '你好'.repeat(100)])('does not swallow a mixed or unsupported request: %s', question => {
    expect(resolveAssistantHelp(question)).toBeNull();
  });
  it.each(['你好！', 'Hello Colliers AI', ' Who are you? ', '你叫什么名字？', '你可以做什么？', 'Thank you.'])('recognizes bounded standalone help: %s', question => {
    const result = resolveAssistantHelp(question);
    expect(result?.kind).toBe('clarification');
    if (result?.kind !== 'clarification') throw new Error('help response expected');
    expect(assistantHelpSchema.parse(result.clarification).reason).toBe('assistant_help');
    expect(result).not.toHaveProperty('plan');
  });
  it('does not replace pending business conditions with a greeting', () => {
    const context: SemanticContext = { version: 'colliers-semantic-context/1', comparisonSubmarkets: ['CBD'], pending: {
      question: 'CBD租金', clarification: { code: 'conditions_required', reason: 'period_required', message: '请选择季度。', options: [] },
    } };
    const copy = structuredClone(context), reply = resolveAssistantHelp('你好', context);
    expect(reply?.context).toEqual(copy); expect(context).toEqual(copy);
  });
  it('rejects a forged help envelope containing business actions or an unbounded message', () => {
    const valid = { code: 'conditions_required', reason: 'assistant_help', message: '介绍', options: [] };
    expect(assistantHelpSchema.safeParse({ ...valid, options: [{ id: 'x', question: '偷读数据', label: 'x' }] }).success).toBe(false);
    expect(assistantHelpSchema.safeParse({ ...valid, message: 'x'.repeat(1001) }).success).toBe(false);
  });
});
