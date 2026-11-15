'use client';
import * as React from 'react';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import type { DeliveryView } from '@/src/lib/intelligence/query/delivery';

/** Reports a committed DOM view in a visible document, not viewport exposure or reading.
 * Unmount, collapse, identity changes and a hidden tab suppress pending reports. */
export function useQueryPresentationReceipt(scope: QueryClientScope | undefined, value: object | null | undefined, view: DeliveryView | null) {
  const descriptor = JSON.stringify(view);
  React.useEffect(() => {
    if (!scope || !value || !view) return;
    const controller = new AbortController();
    let first = 0, second = 0, sent = false;
    const schedule = () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      if (document.visibilityState !== 'visible' || sent) return;
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
        if (controller.signal.aborted || document.visibilityState !== 'visible') return;
        sent = true;
        void trustedQueryClient.reportDelivery(scope, value, 'client_dom_committed', JSON.parse(descriptor), controller.signal);
      }); });
    };
    schedule(); document.addEventListener('visibilitychange', schedule);
    return () => { controller.abort(); cancelAnimationFrame(first); cancelAnimationFrame(second); document.removeEventListener('visibilitychange', schedule); };
    // descriptor is the stable bounded view; no draft or keystrokes are observed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, value, descriptor]);
}
