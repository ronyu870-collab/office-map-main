'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

type Props = Omit<ComponentProps<typeof Link>, 'prefetch' | 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'> & {
  mayPrefetch: boolean;
};

function networkAllowsPrefetch() {
  const { connection } = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return navigator.onLine && !connection?.saveData
    && (!connection?.effectiveType || connection.effectiveType === '4g');
}

export function HomeIntentLink({ mayPrefetch, ...props }: Props) {
  const [intent, setIntent] = useState(false);
  const showIntent = () => setIntent(mayPrefetch && networkAllowsPrefetch());

  return (
    <Link
      {...props}
      // Use Next's static shell strategy. An actual click still navigates on every network.
      prefetch={mayPrefetch && intent ? null : false}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') showIntent(); }}
      onPointerLeave={() => setIntent(false)}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) showIntent(); }}
      onBlur={() => setIntent(false)}
    />
  );
}
