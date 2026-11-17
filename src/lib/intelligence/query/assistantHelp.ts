import { z } from 'zod';
import type { SemanticContext, SemanticResolution } from './semanticPlanner';

export const assistantHelpSchema = z.strictObject({ code: z.literal('conditions_required'), reason: z.literal('assistant_help'),
  message: z.string().min(1).max(1000), options: z.array(z.never()).max(0) });

/** Entire-message matches only: a greeting followed by a business request is
 * never swallowed by help. No model, business read, client identity or new plan. */
export function resolveAssistantHelp(question: string, context?: SemanticContext): SemanticResolution | null {
  if (question.length > 120) return null;
  const text = question.normalize('NFKC').trim().toLowerCase().replace(/[\s，。！？、,.!?：:；;]+/gu, '');
  let message: string;
  if (/^(?:你好|您好|嗨|哈喽|早上好|上午好|中午好|下午好|晚上好|早安|晚安|hello|hi|hey)(?:colliers(?:ai)?|高力(?:国际)?(?:ai)?|助手)?$/u.test(text)) {
    message = '你好，我是 Colliers AI，高力国际北京办公楼市场的智能研究助手。你可以让我查找楼宇资料、查询获权市场指标，或比较季度变化。今天想了解什么？';
  } else if (/^(?:你是谁|您是谁|你叫什么(?:名字)?|介绍一下你自己|自我介绍(?:一下)?|whoareyou|whatisyourname)$/u.test(text)) {
    message = '我是 Colliers AI，高力国际北京办公楼市场数据平台的智能研究助手。我基于你当前有权访问的平台数据回答问题，并提供数据期间、统计口径和来源；未收录或未获授权的信息会明确说明，不会编造。';
  } else if (/^(?:你能做什么|你可以做什么|你会什么|你有什么功能|我可以问什么|怎么使用你|帮助|使用帮助|help|whatcanyoudo)$/u.test(text)) {
    message = '我可以在你当前获权的范围内查找楼宇资料，分析净有效租金、空置率和季度总面积，比较地区及季度变化，并查看结果来源。你可以先说出楼宇或子市场，再告诉我想看的指标。报价、租赁成交等尚未开放的查询会明确提示；我不会修改业务数据，也不会把缺失信息当作零。';
  } else if (/^(?:谢谢(?:你|您)?|多谢|感谢|谢谢帮助|辛苦了|thanks|thankyou)$/u.test(text)) {
    message = '不客气。你可以基于刚才的问题继续追问，也可以开始一个新问题。';
  } else return null;
  return { kind: 'clarification', clarification: { code: 'conditions_required', reason: 'assistant_help', message, options: [] },
    // Keep even a pending business clarification intact across small talk.
    context: context ?? { version: 'colliers-semantic-context/1', comparisonSubmarkets: [] } };
}
