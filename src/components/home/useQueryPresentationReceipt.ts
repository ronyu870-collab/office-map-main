'use client';
import * as React from 'react';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import type { DeliveryView } from '@/src/lib/intelligence/query/delivery';

/** Reports a committed DOM view in a visible document, not viewport exposure or reading.
 * Unmount, collapse, identity changes and a hidden tab suppress pending reports. */
export function useQueryPresentationReceipt(scope: QueryClientScope | undefined, value: object | null | undefined, view: DeliveryView | null, enabled = true) {
  const descriptor = JSON.stringify(view);
  // A retained result may be hidden and revealed by the workspace. Reopening
  // the same committed view is not another delivery; a changed source/page,
  // result object or identity still has its own receipt, exactly as before.
  const committed = React.useRef<{ scope: QueryClientScope; value: object; descriptor: string; confirmed: boolean; controller: AbortController } | null>(null);
  React.useEffect(() => {
    if (!scope || !value || !view || !enabled) return;
    if (committed.current?.scope === scope && committed.current.value === value && committed.current.descriptor === descriptor
      && (committed.current.confirmed || !committed.current.controller.signal.aborted)) return;
    const controller = new AbortController();
    let first = 0, second = 0, sent = false;
    const schedule = () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      if (document.visibilityState !== 'visible' || sent) return;
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
        if (controller.signal.aborted || document.visibilityState !== 'visible') return;
        sent = true;
        const receipt = { scope, value, descriptor, confirmed: false, controller };
        committed.current = receipt;
        void Promise.resolve(trustedQueryClient.reportDelivery(scope, value, 'client_dom_committed', JSON.parse(descriptor), controller.signal)).then(confirmed => {
          if (committed.current !== receipt) return;
          if (confirmed) receipt.confirmed = true;
          else committed.current = null;
        }, () => { if (committed.current === receipt) committed.current = null; });
      }); });
    };
    schedule(); document.addEventListener('visibilitychange', schedule);
    return () => { controller.abort(); cancelAnimationFrame(first); cancelAnimationFrame(second); document.removeEventListener('visibilitychange', schedule); };
    // descriptor is the stable bounded view; no draft or keystrokes are observed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, value, descriptor, enabled]);
}
