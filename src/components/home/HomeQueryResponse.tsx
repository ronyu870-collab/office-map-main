'use client';

import * as React from 'react';
import { responseNarrative } from '@/src/lib/intelligence/query/responsePresentation';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { HomeQueryResult } from './HomeQueryResult';
import { responseBlockRenderers } from './HomeQueryResponseBlocks';

type Props = { message?: string; result?: QueryResultView; executionStatus?: 'completed' | 'partial' | 'limited';
  requestId?: string; scope: QueryClientScope; delivery?: object; internalExport: boolean;
  presentation: 'compact' | 'expanded'; onExpand: () => void; collapsed?: boolean };
/** Shared entry point for live and restored messages. Narrative is optional;
 * formal results always use the versioned adapter and verified result renderer. */
export const HomeQueryResponse = React.memo(function HomeQueryResponse({ message, result, executionStatus, collapsed = false, ...props }: Props) {
  const text = React.useMemo(() => responseNarrative(message, result, executionStatus), [message, result, executionStatus]);
  return <>
    {text && <responseBlockRenderers.text text={text} navigation />}
    {result && <div hidden={collapsed}><HomeQueryResult key={result.resultId} result={result} {...props} visible={!collapsed} /></div>}
  </>;
});
