import { numericFields } from '../query/registry';
import { resolveSemanticQuestion } from '../query/semanticPlanner';
import { resolveAssistantHelp } from '../query/assistantHelp';
import type { QueryPlan } from '../query/plan';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const terms = [...new Set([
  ...Object.entries(numericFields).flatMap(([key, field]) => [field.label.replace(/[（(].*$/, ''),
    key, key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), field.column.replaceAll('_', ' ')]),
  '租金', '空置率', '空置面积', '楼层数', '车位数', 'rent', 'vacancy rate',
])].sort((a, b) => b.length - a.length);
const topic = '(?:' + terms.map(term => /^[a-z ]+$/i.test(term)
  ? '\\b' + escape(term).replaceAll(' ', '[\\s_-]+') + '\\b' : escape(term)).join('|') + ')';
// Intent signals are independent of the wording of an entire sentence. A
// concept, methodology or writing request may freely mention business fields;
// it becomes a fact task only when it also asks for actual data or refers to
// concrete periods/results. These are a bounded supplement to normal planning.
const discussionIntent = /概念|定义|含义|意思|什么是|是什么|思路|大纲|方法|框架|步骤|讨论|写作|撰写|起草|如何避免|怎么避免|解释|说明|讲解|如何计算|怎么计算|(?:写)(?:一|封|份|篇|邮件|报告)|\b(?:define|meaning|explain|discuss|draft|write|method|methodology|outline)\b|\bwhat\s+does\b.+\bmean\b|\bwhat\s+is\b|\bhow\b.+\bcalculate\b/iu;
const actualFactRequest = /多少|几栋|几座|哪(?:些|栋|座|个|笔)|数值|具体(?:值|数字)|查(?:询|出)|列出|排名|最高|最低|\b(?:how\s+much|show\s+me|list|query|rank)\b|\bwhat\s+is\s+(?:the\s+)?(?:average|mean|median|total)\b/iu;
const concreteDataReference = /(?:19\d{2}|20\d{2}|21\d{2}|2200)\s*(?:年|Q[1-4])|本季度|上(?:一|个)?季度|最新(?:有数据)?|当前|现在|实时|截至|刚才|上述结果|这(?:张图|份数据)|\b(?:current|latest|now|previous\s+result|Q[1-4]\s+\d{4})\b/iu;
const fieldMention = new RegExp(topic, 'iu');

/** A bounded evidence guard, not a natural-language planner. Registered metric
 * names (including their English keys) never authorize free-text data answers.
 * Concept, method and writing intents remain conversational unless they also
 * ask for actual facts or refer to concrete data. Existing semantic
 * plans also retain their evidence obligation, including verified followups.
 * Unrecognized expressions still rely on model/tool planning and are not claimed
 * to be covered by this guard. No location or period is invented here. */
export function requiresDataFactEvidence(question: string, contextPlan?: QueryPlan): boolean {
  if (resolveAssistantHelp(question)) return false;
  const text = question.normalize('NFKC').trim().replace(/[。！？?.!]+$/u, '').trim();
  if (discussionIntent.test(text) && !actualFactRequest.test(text) && !concreteDataReference.test(text)) return false;
  if (fieldMention.test(text)
    || /(?:CBD|金融街|望京).*?(?:所有楼|哪些楼|楼宇|写字楼|最高|最低|排名|前[二三四五六七八九十0-9]+)/i.test(text)) return true;
  const resolution = resolveSemanticQuestion({ question, now: new Date(), availablePeriods: [],
    ...(contextPlan ? { context: { version: 'colliers-semantic-context/1', lastPlan: contextPlan,
      comparisonSubmarkets: [] } } : {}) });
  return resolution.kind === 'plan';
}
