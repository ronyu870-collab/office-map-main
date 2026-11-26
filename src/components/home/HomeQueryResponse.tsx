'use client';

import * as React from 'react';
import { responseNarrative } from '@/src/lib/intelligence/query/responsePresentation';
import type { AnswerSelection } from '@/src/lib/intelligence/query/answerSelection';
import { Button } from '@/src/components/ui/Button';
import styles from './HomeQueryResultExperience.module.css';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { HomeQueryResult } from './HomeQueryResult';
import { responseBlockRenderers } from './HomeQueryResponseBlocks';

type Props = { message?: string; result?: QueryResultView; executionStatus?: 'completed' | 'partial' | 'limited';
  requestId?: string; scope: QueryClientScope; delivery?: object; internalExport: boolean;
  presentation: 'compact' | 'expanded'; onExpand: () => void; collapsed?: boolean; onReveal?: () => void; answerSelection?: AnswerSelection; responseActions?: React.ReactNode; question?: string };
/** Shared entry point for live and restored messages. Narrative is optional;
 * formal results always use the versioned adapter and verified result renderer. */
export const HomeQueryResponse = React.memo(function HomeQueryResponse({ message, result, executionStatus, collapsed = false, answerSelection, onReveal, ...props }: Props) {
  const text = React.useMemo(() => responseNarrative(message, result, executionStatus), [message, result, executionStatus]);
  const primary = answerSelection?.results.find(item => item.result.resultId === answerSelection.primaryResultId);
  const main = primary?.result ?? result;
  const companions = answerSelection?.results.filter(item => item.result.resultId !== answerSelection.primaryResultId) ?? [];
  return <>
    {answerSelection?.notice && <p className={styles.answerNotice} role="status">{answerSelection.notice}</p>}
    {text && text !== answerSelection?.notice && <responseBlockRenderers.text text={text} navigation />}
    {main && <>
      {collapsed && <Button variant="ghost" onClick={onReveal ?? props.onExpand}>展开本次结果</Button>}
      <div hidden={collapsed}>
        {primary?.role === 'alternative' && <p className={styles.resultRole}>替代信息 · 成交汇总</p>}
        <HomeQueryResult key={main.resultId} result={main} {...props} answerTask={answerSelection?.task} visible={!collapsed} />
        {companions.map(item => <CompanionResult key={item.result.resultId} item={item} {...props} collapsed={collapsed} />)}
      </div>
    </>}
  </>;
});

function CompanionResult({ item, collapsed, ...props }: Omit<Props, 'message' | 'result' | 'answerSelection'> & { item: AnswerSelection['results'][number] }) {
  const [open, setOpen] = React.useState(false);
  if (item.role === 'supporting') return <details className={styles.details} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>查看辅助依据</summary><div hidden={!open}><HomeQueryResult result={item.result} {...props} responseActions={undefined} visible={!collapsed && open} /></div>
  </details>;
  return <section className={styles.comparisonResult} aria-label="共同参与比较的结果"><HomeQueryResult result={item.result} {...props} responseActions={undefined} visible={!collapsed} /></section>;
}
