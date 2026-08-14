'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getSessionFast } from '@/src/services/Auth';
import { AuditService } from '@/src/services/auditService';

/**
 * 页面访问追踪组件
 * 自动记录用户的页面访问（完整记录，异步批量上传）
 */
export function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // 跳过静态资源和 API 路由
    if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) {
      return;
    }

    // 异步获取用户信息并记录
    const trackPageView = async () => {
      try {
        const session = await getSessionFast();
        if (session?.user?.id) {
          AuditService.setCurrentUser(session.user.id, session.user.email);
          AuditService.pageView(pathname);
        }
      } catch {
        // 静默失败
      }
    };

    trackPageView();
  }, [pathname]);

  return null;
}
