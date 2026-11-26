'use client';

import * as React from 'react';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { sampleMembership } from '@/src/lib/intelligence/query/sampleMembership';
import type { SampleMembershipMode } from '@/src/lib/intelligence/query/sampleMembership';
import styles from './HomeQueryResultExperience.module.css';

const pageSize = 25;
export function HomeQuerySampleMembership({ result, mode, onSource }: {
  result: QueryResultView; mode: SampleMembershipMode;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void;
}) {
  const membership = React.useMemo(() => sampleMembership(result, mode), [result, mode]);
  const [selection, setSelection] = React.useState({ group: 0, page: 0 });
  const group = membership.groups[selection.group] ?? membership.groups[0];
  const page = Math.min(selection.page, Math.max(0, Math.ceil((group?.members.length ?? 0) / pageSize) - 1));
  const title = mode === 'common' ? '全区间共同有效样本清单' : '各期独立有效样本清单';
  return <section className={styles.membership} aria-label={title}>
    <h3 className={styles.sectionTitle}>{title}</h3>
    {!membership.complete && <p>部分样本缺少可追溯楼宇名称或成员明细，未补造名单；以下仅展示已确认记录。</p>}
    {group && <>
      {membership.groups.length > 1 ? <label>指标与期间 <select value={selection.group < membership.groups.length ? selection.group : 0} onChange={event => setSelection({ group: Number(event.target.value), page: 0 })}>
        {membership.groups.map((item, index) => <option key={item.key} value={index}>{item.title} · {item.count} 栋</option>)}
      </select></label> : <p>{group.title}</p>}
      <p>参与样本 {group.count} 栋 · 已确认名称 {group.members.length} 栋{group.missing > 0 ? ' · 未确认 ' + group.missing + ' 栋' : ''}。</p>
      {group.members.length > 0 && <ol start={page * pageSize + 1} className={styles.memberList}>
        {group.members.slice(page * pageSize, (page + 1) * pageSize).map(member => <li key={member.entityId}><button type="button" onClick={event => onSource(member.sourceIds, member.name, event.currentTarget)}>{member.name}</button></li>)}
      </ol>}
      {group.members.length > pageSize && <nav aria-label="样本清单分页" className={styles.memberPagination}>
        <button type="button" disabled={page === 0} onClick={() => setSelection({ group: selection.group, page: page - 1 })}>上一页</button>
        <span>{page + 1} / {Math.ceil(group.members.length / pageSize)} 页</span>
        <button type="button" disabled={(page + 1) * pageSize >= group.members.length} onClick={() => setSelection({ group: selection.group, page: page + 1 })}>下一页</button>
      </nav>}
    </>}
  </section>;
}
