'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SessionManager } from '@/src/services/SessionManager';
import { SessionWarningBanner } from './SessionWarningBanner';
import { supabase } from '@/src/services/supabaseClient';
import { clearSessionCache, getSessionFast } from '@/src/services/Auth';
import { getTrustedDeviceRemainingMs, isTrustedDevice } from '@/src/services/trustedDevice';

/**
 * 会话管理提供者组件
 * 
 * 负责：
 * 1. 初始化 SessionManager
 * 2. 处理自动退出回调
 * 3. 显示倒计时提醒横幅
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(120);
  const [sessionManager, setSessionManager] = useState<SessionManager | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // 如果在登录页，不启动会话管理器
    if (pathname === '/login') {
      return;
    }

    // 检查用户是否已登录（优先用 sessionStorage 缓存，避免每次 Supabase 往返）
    let manager: SessionManager | null = null;
    let trustedExpiryTimer: ReturnType<typeof setTimeout> | null = null;

    const expireTrustedSession = async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        router.push('/login');
      }
    };

    const checkAuth = async () => {
      const cachedSession = await getSessionFast();

      if (!cachedSession?.session) {
        // 未登录，不启动会话管理器
        return;
      }
      if (cachedSession.user.app_metadata?.must_change_password && pathname !== '/settings') {
        router.replace('/settings?required=1');
        return;
      }
      if (isTrustedDevice()) {
        const remaining = getTrustedDeviceRemainingMs();
        if (remaining !== null) {
          trustedExpiryTimer = setTimeout(() => { void expireTrustedSession(); }, remaining);
        }
        return;
      }

      // 创建并启动会话管理器
      manager = new SessionManager({
        timeout: 30 * 60 * 1000, // 30 分钟
        warningTime: 2 * 60 * 1000, // 2 分钟
        throttleInterval: 2000, // 2 秒
        onLogout: async () => {
          // 自动退出回调
          try {
            await supabase.auth.signOut();
          } catch (err) {
            console.error('自动退出失败:', err);
          }

          alert('登录已过期，请重新登录');
          router.push('/login');
        },
        onWarning: (seconds) => {
          // 显示倒计时提醒回调
          setRemainingSeconds(seconds);
          setShowWarning(true);
        },
      });

      manager.start();
      setSessionManager(manager);
    };

    checkAuth();

    // 监听 Supabase auth 状态变化，检测 session 过期
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Supabase 的真实会话已变化，下一次读取必须重新取得角色和用户资料。
        clearSessionCache();
      }
      if (event === 'SIGNED_OUT') {
        clearSessionCache();
        // session 过期或 refresh token 失败，自动跳转登录页
        router.push('/login');
      }
    });

    // 清理函数
    return () => {
      subscription.unsubscribe();
      manager?.stop();
      if (trustedExpiryTimer) clearTimeout(trustedExpiryTimer);
    };
  }, [pathname, router]);

  const handleContinue = () => {
    // 点击"继续使用"按钮
    setShowWarning(false);
    if (sessionManager) {
      sessionManager.reset();
    }
  };

  return (
    <>
      <SessionWarningBanner
        visible={showWarning}
        remainingSeconds={remainingSeconds}
        onContinue={handleContinue}
      />
      {children}
    </>
  );
}
