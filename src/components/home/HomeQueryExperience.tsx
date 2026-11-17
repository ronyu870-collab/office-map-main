'use client';

import { Building2 } from 'lucide-react';
import styles from './HomeQuery.module.css';

/** A display label, not an authorization source. Never guess a first name from
 * an email, UUID, or a user name containing invisible direction controls. */
export function greetingName(displayName?: string): string | null {
  if (!displayName || /[\p{Cc}\p{Cf}]/u.test(displayName)) return null;
  const name = displayName.trim();
  if (!name || name.length > 80 || name.includes('@') || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name)
    || /^https?:\/\//i.test(name) || /^\d{7,}$/.test(name)) return null;
  return name;
}

export function QueryWelcome({ displayName }: { displayName?: string }) {
  const name = greetingName(displayName);
  return <div className={styles.welcome}>
    <h3>{name ? <>你好，<bdi>{name}</bdi>。</> : '你好。'}</h3>
    <p className={styles.welcomeIdentity}>我是 Colliers AI，高力国际北京办公楼市场的智能研究助手。</p>
    <p>查找楼宇、了解市场指标，或比较季度变化。</p>
  </div>;
}

export function AssistantHeading({ label }: { label: string }) {
  return <div className={styles.replyHeading}>
    <span className={styles.assistantMark} aria-hidden="true"><Building2 size={16} strokeWidth={1.6} /></span>
    <strong>Colliers AI</strong><span className={styles.replyLabel}>{label}</span>
  </div>;
}

export function QueryWorkingIndicator() {
  return <span className={styles.workingIndicator} aria-hidden="true"><i /><i /><i /></span>;
}
