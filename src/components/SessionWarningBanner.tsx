'use client';

import { useEffect, useState } from 'react';

interface SessionWarningBannerProps {
  /** 剩余秒数 */
  remainingSeconds: number;
  /** 点击"继续使用"按钮的回调 */
  onContinue: () => void;
  /** 是否显示横幅 */
  visible: boolean;
}

/**
 * 会话倒计时提醒横幅组件
 * 
 * 显示在页面顶部，提醒用户即将自动退出
 */
export function SessionWarningBanner({
  remainingSeconds,
  onContinue,
  visible,
}: SessionWarningBannerProps) {
  const [countdown, setCountdown] = useState(remainingSeconds);

  useEffect(() => {
    if (!visible) return;

    setCountdown(remainingSeconds);

    // 每秒更新倒计时
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, remainingSeconds]);

  if (!visible) return null;

  // 格式化时间：分:秒
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-white px-4 py-3 shadow-lg"
      role="alert"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium">
            您已 {Math.floor((remainingSeconds === 120 ? 28 : 30 - countdown / 60))} 分钟未操作，
            {timeStr} 后将自动退出
          </span>
        </div>
        <button
          onClick={onContinue}
          className="bg-white text-yellow-600 px-4 py-1.5 rounded font-medium hover:bg-yellow-50 transition-colors"
        >
          继续使用
        </button>
      </div>
    </div>
  );
}
