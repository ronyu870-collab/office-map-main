'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { clearImpersonationCache } from '@/src/services/Auth';
import { useAppSession } from '@/src/components/SessionProvider';
import { isAdminRole } from '@/src/utils/adminAccess';

const STORAGE_KEY = '__impersonation_state';

interface ImpersonationStoredState {
  targetUserId: string;
  targetEmail: string;
  targetDisplayName: string;
  targetRole: string;
  adminUserId: string;
  adminEmail: string;
  startedAt: number;
}

interface ImpersonationContextValue {
  isImpersonating: boolean;
  isReadOnly: boolean;
  targetUserId: string | null;
  targetEmail: string | null;
  targetDisplayName: string | null;
  targetRole: string | null;
  isStopping: boolean;
  startImpersonation: (userId: string, operatorUserId: string, signal: AbortSignal) => Promise<void>;
  stopImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  isImpersonating: false,
  isReadOnly: false,
  targetUserId: null,
  targetEmail: null,
  targetDisplayName: null,
  targetRole: null,
  isStopping: false,
  startImpersonation: async () => {},
  stopImpersonation: () => {},
});

export function useImpersonation() {
  return useContext(ImpersonationContext);
}

function getStoredState(): ImpersonationStoredState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationStoredState;
    if (parsed.targetUserId && parsed.targetEmail) return parsed;
    return null;
  } catch {
    return null;
  }
}

function setStoredState(state: ImpersonationStoredState | null) {
  if (typeof window === 'undefined') return;
  try {
    if (state) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function getCredential() {
  const { supabase } = await import('@/src/services/supabaseClient');
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session;
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  // 直接从 sessionStorage 读取初始状态（同步，不阻塞渲染）
  const [state, setState] = useState<ImpersonationStoredState | null>(() => getStoredState());
  const [isStopping, setIsStopping] = useState(false);
  const stopPending = useRef(false);
  const stopImpersonationRef = useRef<() => void>(() => {});
  const { session, status } = useAppSession();

  useEffect(() => {
    if (!state || status === 'loading') return;
    const realUser = session?.session.user;
    if (realUser?.id === state.adminUserId && realUser.email === state.adminEmail &&
      (session?.user.id !== realUser.id || isAdminRole(session.role))) return;
    clearImpersonationCache();
    setState(null);
  }, [session, state, status]);

  // 后台验证模拟状态有效性（不阻塞子组件渲染）
  useEffect(() => {
    const stored = getStoredState();
    if (!stored) return; // 无模拟状态，无需验证

    let active = true;
    const clearIfCurrent = () => {
      if (!active) return;
      const current = getStoredState();
      if (current && current.startedAt === stored.startedAt && current.targetUserId === stored.targetUserId) {
        clearImpersonationCache();
      }
      setState(previous => previous?.startedAt === stored.startedAt && previous.targetUserId === stored.targetUserId ? null : previous);
    };
    // Keep the existing fresh Auth verification on reload. Only its original
    // stored transition can be cleared by a response from that verification.
    void import('@/src/services/supabaseClient').then(async ({ supabase }) => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user || user.id !== stored.adminUserId || user.email !== stored.adminEmail) clearIfCurrent();
    }).catch(clearIfCurrent);
    return () => { active = false; };
  }, []);

  const startImpersonation = useCallback(async (userId: string, operatorUserId: string, signal: AbortSignal) => {
    const credential = await getCredential();
    if (!credential?.access_token || credential.user.id !== operatorUserId) throw new Error('登录状态已变化，请重新进入管理后台');
    const accessToken = credential.access_token;
    signal.throwIfAborted();

    // The existing server route independently verifies this token, role and target.
    const res = await fetch(`/api/admin/impersonate?user_id=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === 'string' ? data.error : '获取用户信息失败');
    }

    const profile = await res.json();
    if (profile.user_id !== userId || !profile.email) throw new Error('返回的模拟用户信息不完整');

    async function assertCurrentCredential() {
      const current = await getCredential();
      signal.throwIfAborted();
      if (current?.user.id !== operatorUserId || current.access_token !== accessToken) {
        throw new Error('登录状态已变化，请重新进入管理后台');
      }
    }

    await assertCurrentCredential();
    const audit = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: 'impersonate_start',
        target_user_id: profile.user_id,
        target_email: profile.email,
      }),
    });
    if (!audit.ok) throw new Error('无法记录模拟操作，请重试');
    await assertCurrentCredential();

    const stored: ImpersonationStoredState = {
      targetUserId: profile.user_id,
      targetEmail: profile.email,
      targetDisplayName: profile.displayName,
      targetRole: profile.role,
      adminUserId: credential.user.id,
      adminEmail: credential.user.email ?? '',
      startedAt: Date.now(),
    };
    clearImpersonationCache();
    setStoredState(stored);
    setState(stored);
    window.location.href = `/?impersonate=${encodeURIComponent(userId)}`;
  }, []);

  const stopImpersonation = useCallback(async () => {
    if (stopPending.current) return;
    stopPending.current = true;
    setIsStopping(true);
    const currentState = getStoredState();
    try {
      const credential = currentState ? await getCredential() : null;
      if (currentState && credential?.user.id === currentState.adminUserId && credential.user.email === currentState.adminEmail) {
        await fetch('/api/admin/impersonate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credential.access_token}`,
          },
          body: JSON.stringify({
            action: 'impersonate_end',
            target_user_id: currentState.targetUserId,
            target_email: currentState.targetEmail,
          }),
        });
      }
    } catch {
      // A network failure cannot trap the operator in simulated mode.
    } finally {
      // Even an offline or expired session must be able to leave read-only mode.
      setStoredState(null);
      setState(null);
      clearImpersonationCache();
      window.location.href = '/admin';
    }
  }, []);

  // Keep ref updated
  stopImpersonationRef.current = stopImpersonation;

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const currentState = getStoredState();
        if (currentState) {
          e.preventDefault();
          stopImpersonationRef.current();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const value: ImpersonationContextValue = {
    isImpersonating: !!state,
    isReadOnly: !!state,
    targetUserId: state?.targetUserId ?? null,
    targetEmail: state?.targetEmail ?? null,
    targetDisplayName: state?.targetDisplayName ?? null,
    targetRole: state?.targetRole ?? null,
    isStopping,
    startImpersonation,
    stopImpersonation,
  };

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}
