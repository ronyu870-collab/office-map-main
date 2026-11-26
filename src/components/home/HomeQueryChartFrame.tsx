'use client';
import * as React from 'react';
import { HomeQueryDetailContent, useQueryDetail } from './HomeQueryDetailPanel';
import styles from './HomeQueryChartFrame.module.css';
export function HomeQueryChartFrame({ id: resultId, title, children, actions }: { id: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const detail = useQueryDetail();
  const instanceId = React.useId();
  const id = `${resultId}-${instanceId}`;
  return <HomeQueryDetailContent id={id}><section className={styles.frame} aria-label="图表成果">
    <header><h3>{title}</h3><div className={styles.actions}>{actions}{detail && detail.active?.id !== id && <button type="button" onClick={event => detail.open(id, title, event.currentTarget)}>展开图表</button>}</div></header>
    <div className={styles.body}>{children}</div>
  </section></HomeQueryDetailContent>;
}
