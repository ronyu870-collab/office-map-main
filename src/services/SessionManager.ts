import { throttle } from '@/src/utils/throttle';

export interface SessionManagerConfig {
  /** 自动退出超时时间（毫秒），默认 30 分钟 */
  timeout?: number;
  /** 倒计时提醒提前时间（毫秒），默认 2 分钟 */
  warningTime?: number;
  /** 节流间隔（毫秒），默认 2000ms */
  throttleInterval?: number;
  /** 退出回调 */
  onLogout?: () => void;
  /** 显示倒计时提醒回调 */
  onWarning?: (remainingSeconds: number) => void;
}

const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 分钟
const DEFAULT_WARNING_TIME = 2 * 60 * 1000; // 2 分钟
const DEFAULT_THROTTLE_INTERVAL = 2000; // 2 秒

export class SessionManager {
  private config: Required<SessionManagerConfig>;
  private timer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private throttledReset: () => void;
  private eventListeners: Array<{ event: string; handler: EventListener }> = [];
  private isWarningShown = false;

  constructor(config?: SessionManagerConfig) {
    this.config = {
      timeout: config?.timeout ?? DEFAULT_TIMEOUT,
      warningTime: config?.warningTime ?? DEFAULT_WARNING_TIME,
      throttleInterval: config?.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL,
      onLogout: config?.onLogout ?? (() => {}),
      onWarning: config?.onWarning ?? (() => {}),
    };

    // 创建节流后的重置函数
    this.throttledReset = throttle(
      () => this.resetTimer(),
      this.config.throttleInterval
    );
  }

  /** 启动会话管理器 */
  start(): void {
    // 注册全局事件监听器
    const events = ['mousemove', 'keydown', 'scroll', 'click'];
    
    events.forEach((event) => {
      const handler = this.throttledReset.bind(this);
      this.eventListeners.push({ event, handler });
      window.addEventListener(event, handler, { passive: true });
    });

    // 启动定时器
    this.resetTimer();
  }

  /** 停止会话管理器，清理所有监听器和定时器 */
  stop(): void {
    // 清除所有事件监听器
    this.eventListeners.forEach(({ event, handler }) => {
      window.removeEventListener(event, handler);
    });
    this.eventListeners = [];

    // 清除定时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }

    this.isWarningShown = false;
  }

  /** 手动重置定时器（用于"继续使用"按钮） */
  reset(): void {
    this.isWarningShown = false;
    this.resetTimer();
  }

  /** 触发自动退出 */
  private logout(): void {
    this.stop();
    this.config.onLogout();
  }

  /** 显示倒计时提醒 */
  private showWarning(): void {
    if (this.isWarningShown) return;
    
    this.isWarningShown = true;
    const remainingSeconds = Math.floor(this.config.warningTime / 1000);
    this.config.onWarning(remainingSeconds);
  }

  /** 重置定时器（内部方法） */
  private resetTimer(): void {
    // 如果正在显示警告，关闭它
    if (this.isWarningShown) {
      this.isWarningShown = false;
    }

    // 清除现有定时器
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
    }

    // 设置倒计时提醒定时器（28分钟后）
    const warningDelay = this.config.timeout - this.config.warningTime;
    this.warningTimer = setTimeout(() => {
      this.showWarning();
    }, warningDelay);

    // 设置自动退出定时器（30分钟后）
    this.timer = setTimeout(() => {
      this.logout();
    }, this.config.timeout);
  }
}
