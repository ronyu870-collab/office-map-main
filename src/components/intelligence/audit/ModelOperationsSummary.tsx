'use client';
import { summarizeModelOperations } from '@/src/lib/intelligence/agent/modelOperationsView';
import styles from './AiAuditWorkspace.module.css';

export function ModelOperationsSummary({ documents, label }: { documents: unknown[]; label: string }) {
  const summary = summarizeModelOperations(documents);
  return <section aria-label="模型成本与故障统计" className={styles.detail}>
    <h2>模型成本与故障统计</h2><p className={styles.muted}>{label}。仅统计新协议的实际尝试；旧记录缺失不能视为零调用。</p>
    <p>{summary.calls} 次尝试，{summary.failures} 次失败，{summary.fallbackCalls} 次回退路径调用。费用估算／未知用量预留合计 ${summary.estimatedUsd.toFixed(6)} USD；实际账单尚未核对。</p>
    {summary.unknownUsage > 0 && <p>{summary.unknownUsage} 次未取得完整供应商用量，按保守预留计入预算；token 总数保持未知。</p>}
    {summary.groups.map(g => <p key={g.provider}>{g.provider}：{g.calls} 次，失败 {g.failures} 次；输入 {g.inputTokens ?? '未知'} / 输出 {g.outputTokens ?? '未知'} token；累计 {Math.round(g.durationMs)} ms；估算 ${g.estimatedUsd.toFixed(6)} USD。</p>)}
    {!!summary.errors.length && <p>错误类别：{summary.errors.map(e => `${e.code}（${e.count}）`).join('、')}。</p>}
  </section>;
}
