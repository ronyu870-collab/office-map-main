'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SessionManager } from '@/src/services/SessionManager';
import { SessionWarningBanner } from './SessionWarningBanner';
import { supabase } from '@/src/services/supabaseClient';
import {
  clearSessionCache,
  getSessionFast,
  type AuthSessionResult,
} from '@/src/services/Auth';
import { getTrustedDeviceRemainingMs, isTrustedDevice } from '@/src/services/trustedDevice';

export type AppSessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AppSessionContextValue = {
  session: AuthSessionResult | null;
  status: AppSessionStatus;
  refreshSession: () => Promise<AuthSessionResult | null>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function useStandaloneSession(enabled: boolean): AppSessionContextValue {
  const [session, setSession] = useState<AuthSessionResult | null>(null);
  const [status, setStatus] = useState<AppSessionStatus>('loading');

  const refreshSession = useCallback(async () => {
    if (!enabled) return null;
    setStatus('loading');
    try {
      const nextSession = await getSessionFast();
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
      return nextSession;
    } catch {
      setSession(null);
      setStatus('unauthenticated');
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refreshSession();
  }, [enabled, refreshSession]);

  return useMemo(
    () => ({ session, status, refreshSession }),
    [session, status, refreshSession],
  );
}

/**
 * Read the application session resolved by the root SessionProvider.
 *
 * The standalone branch exists for isolated rendering in tests/component tooling.
 * In the real app the root provider is always present, so it performs no auth read
 * and therefore does not recreate the historical page-level session gate.
 */
export function useAppSession(): AppSessionContextValue {
  const context = useContext(AppSessionContext);
  const standalone = useStandaloneSession(context === null);
  return context ?? standalone;
}

/**
 * Root session owner.
 *
 * Responsibilities:
 * 1. Resolve the authenticated application session once and expose it to all routes.
 * 2. Preserve session timeout/trusted-device behavior.
 * 3. React to Supabase auth changes without forcing each page to re-query auth.
 * 4. Keep password-change redirects and session warning behavior centralized.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(120);
  const [session, setSession] = useState<AuthSessionResult | null>(null);
  const [status, setStatus] = useState<AppSessionStatus>('loading');
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const inFlightSessionRef = useRef<Promise<AuthSessionResult | null> | null>(null);
  const sessionGenerationRef = useRef(0);
  const pathname = usePathname();
  // This route contains only the public research article. Session expiry still
  // clears credentials; readers simply remain on the article as visitors.
  const readingPublicReport = pathname === '/occupier-insights';
  const router = useRouter();

  const resolveSession = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      clearSessionCache();
      sessionGenerationRef.current += 1;
      inFlightSessionRef.current = null;
    }
    if (inFlightSessionRef.current) return inFlightSessionRef.current;
    const generation = sessionGenerationRef.current;

    // Background token/profile refreshes should not replace an already usable
    // authenticated workspace with a loading skeleton.
    setStatus((current) => (current === 'authenticated' ? current : 'loading'));

    const request = (async () => {
      try {
        const nextSession = await getSessionFast();
        if (generation !== sessionGenerationRef.current) return null;
        setSession(nextSession);
        setStatus(nextSession ? 'authenticated' : 'unauthenticated');
        if (!nextSession) setShowWarning(false);
        return nextSession;
      } catch (error) {
        if (generation !== sessionGenerationRef.current) return null;
        console.error('解析应用会话失败:', error);
        setSession(null);
        setStatus('unauthenticated');
        setShowWarning(false);
        return null;
      }
    })();

    inFlightSessionRef.current = request;
    try {
      return await request;
    } finally {
      if (inFlightSessionRef.current === request) inFlightSessionRef.current = null;
    }
  }, []);

  const refreshSession = useCallback(
    () => resolveSession(true),
    [resolveSession],
  );

  useEffect(() => {
    void resolveSession();
  }, [resolveSession]);

  useEffect(() => {
    if (
      status === 'authenticated' &&
      session?.user.app_metadata?.must_change_password &&
      pathname !== '/settings'
    ) {
      router.replace('/settings?required=1');
    }
  }, [pathname, router, session, status]);

  useEffect(() => {
    sessionManagerRef.current?.stop();
    sessionManagerRef.current = null;

    if (pathname === '/login' || status !== 'authenticated' || !session?.session) {
      return;
    }

    let trustedExpiryTimer: ReturnType<typeof setTimeout> | null = null;

    const expireTrustedSession = async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        setSession(null);
        setStatus('unauthenticated');
        setShowWarning(false);
        if (!readingPublicReport) router.push('/login');
      }
    };

    if (isTrustedDevice()) {
      const remaining = getTrustedDeviceRemainingMs();
      if (remaining !== null) {
        trustedExpiryTimer = setTimeout(() => {
          void expireTrustedSession();
        }, remaining);
      }

      return () => {
        if (trustedExpiryTimer) clearTimeout(trustedExpiryTimer);
      };
    }

    const manager = new SessionManager({
      timeout: 30 * 60 * 1000,
      warningTime: 2 * 60 * 1000,
      throttleInterval: 2000,
      onLogout: async () => {
        try {
          await supabase.auth.signOut();
        } catch (error) {
          console.error('自动退出失败:', error);
        }

        setSession(null);
        setStatus('unauthenticated');
        setShowWarning(false);
        if (!readingPublicReport) {
          alert('登录已过期，请重新登录');
          router.push('/login');
        }
      },
      onWarning: (seconds) => {
        setRemainingSeconds(seconds);
        setShowWarning(true);
      },
    });

    manager.start();
    sessionManagerRef.current = manager;

    return () => {
      manager.stop();
      if (sessionManagerRef.current === manager) {
        sessionManagerRef.current = null;
      }
      if (trustedExpiryTimer) clearTimeout(trustedExpiryTimer);
    };
  }, [pathname, readingPublicReport, router, session, status]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        sessionGenerationRef.current += 1;
        inFlightSessionRef.current = null;
        clearSessionCache();
        setSession(null);
        setStatus('unauthenticated');
        setShowWarning(false);
        if (pathname !== '/login' && !readingPublicReport) router.push('/login');
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        clearSessionCache();
        sessionGenerationRef.current += 1;
        inFlightSessionRef.current = null;
        queueMicrotask(() => {
          void resolveSession();
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, readingPublicReport, resolveSession, router]);

  const handleContinue = () => {
    setShowWarning(false);
    sessionManagerRef.current?.reset();
  };

  const value = useMemo<AppSessionContextValue>(
    () => ({ session, status, refreshSession }),
    [session, status, refreshSession],
  );

  return (
    <AppSessionContext.Provider value={value}>
      <SessionWarningBanner
        visible={showWarning && !readingPublicReport}
        remainingSeconds={remainingSeconds}
        onContinue={handleContinue}
      />
      {children}
    </AppSessionContext.Provider>
  );
}
