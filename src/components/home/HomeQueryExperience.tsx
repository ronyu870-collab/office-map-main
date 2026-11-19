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
    <p>今天想研究什么？</p>
  </div>;
}

/** Only shorten server-authorized examples; selecting one edits the original
 * question so the user can review its exact scope and period before sending. */
export function queryStarters(examples: readonly string[]): { question: string; label: string }[] {
  const unique = [...new Set(examples)];
  const selected: { question: string; label: string }[] = [];
  for (const [pattern, label] of [
    [/有哪些楼|查找.*楼|查询.*楼/, '查找办公楼'],
    [/租金.*趋势|趋势.*租金/, '市场租金趋势'],
    [/按子市场比较|比较.*区域|区域.*比较/, '比较不同区域'],
  ] as const) {
    const question = unique.find(value => pattern.test(value) && !selected.some(item => item.question === value));
    if (question) selected.push({ question, label });
  }
  for (const question of unique) {
    if (selected.length === 3) break;
    if (!selected.some(item => item.question === question)) selected.push({ question, label: question });
  }
  return selected;
}

export function AssistantHeading({ label }: { label?: string }) {
  const description = label?.trim();
  return <div className={styles.replyHeading}>
    <span className={styles.assistantMark} aria-hidden="true"><Building2 size={16} strokeWidth={1.6} /></span>
    <strong>Colliers AI</strong>{description && description !== 'Colliers AI' && <span className={styles.replyLabel}>{description}</span>}
  </div>;
}

export function QueryWorkingIndicator() {
  return <span className={styles.workingIndicator} aria-hidden="true"><i /><i /><i /></span>;
}
