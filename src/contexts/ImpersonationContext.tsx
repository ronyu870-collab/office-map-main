'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { clearImpersonationCache } from '@/src/services/Auth';

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
  startImpersonation: (userId: string) => Promise<void>;
  stopImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  isImpersonating: false,
  isReadOnly: false,
  targetUserId: null,
  targetEmail: null,
  targetDisplayName: null,
  targetRole: null,
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

async function getAccessToken(): Promise<string | null> {
  try {
    const { supabase } = await import('@/src/services/supabaseClient');
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  // 直接从 sessionStorage 读取初始状态（同步，不阻塞渲染）
  const [state, setState] = useState<ImpersonationStoredState | null>(() => getStoredState());
  const stopImpersonationRef = useRef<() => void>(() => {});

  // 后台验证模拟状态有效性（不阻塞子组件渲染）
  useEffect(() => {
    const stored = getStoredState();
    if (!stored) return; // 无模拟状态，无需验证

    // 异步验证当前登录用户是否是发起模拟的 admin
    import('@/src/services/supabaseClient').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user || user.email !== stored.adminEmail) {
          // admin 已切换，清除残留的模拟状态
          setStoredState(null);
          setState(null);
        }
        // 如果验证通过，state 已在初始化时设置，无需额外操作
      });
    });
  }, []);

  const startImpersonation = useCallback(async (userId: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      alert('无法获取认证信息，请重新登录');
      return;
    }

    // Fetch target user profile
    const res = await fetch(`/api/admin/impersonate?user_id=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '获取用户信息失败');
      return;
    }

    const profile = await res.json();

    // Get current admin info
    const { supabase } = await import('@/src/services/supabaseClient');
    const { data: { user: adminUser } } = await supabase.auth.getUser();

    const stored: ImpersonationStoredState = {
      targetUserId: profile.user_id,
      targetEmail: profile.email,
      targetDisplayName: profile.displayName,
      targetRole: profile.role,
      adminUserId: adminUser?.id || '',
      adminEmail: adminUser?.email || '',
      startedAt: Date.now(),
    };

    setStoredState(stored);
    setState(stored);

    // Log audit
    await fetch('/api/admin/impersonate', {
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
    }).catch(() => {}); // non-blocking

    // Navigate to homepage with impersonate param
    window.location.href = `/?impersonate=${encodeURIComponent(userId)}`;
  }, []);

  const stopImpersonation = useCallback(async () => {
    const currentState = getStoredState();
    if (currentState) {
      const accessToken = await getAccessToken();
      if (accessToken) {
        // Log audit
        await fetch('/api/admin/impersonate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: 'impersonate_end',
            target_user_id: currentState.targetUserId,
            target_email: currentState.targetEmail,
          }),
        }).catch(() => {});
      }
    }

    setStoredState(null);
    setState(null);
    clearImpersonationCache();

    // Navigate to admin page
    window.location.href = '/admin';
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
    startImpersonation,
    stopImpersonation,
  };

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}
