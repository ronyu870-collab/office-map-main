'use client';

import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';

/** Presentation guard. The expiry API and its RPC authorize each request independently. */
export function useLeaseExpiryAccess() {
  const { session, status } = useAppSession();
  const { isImpersonating } = useImpersonation();
  const permitted = status === 'authenticated' && session?.role === 'admin' && !isImpersonating;
  return { permitted, session, status };
}
