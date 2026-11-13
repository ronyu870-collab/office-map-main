'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '@/src/services/supabaseClient';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { Button, LoadingState } from '@/src/components/ui';
import type { UserRole } from '@/src/types/auth';

interface UserEntry {
  user_id: string;
  email: string;
  chinese_name: string | null;
  full_name: string | null;
  role: UserRole;
}

const DIRECTORY_PAGE_SIZE = 200;
const DISPLAY_BATCH_SIZE = 50;

async function readDirectory(operatorUserId: string, signal: AbortSignal): Promise<UserEntry[]> {
  const users: UserEntry[] = [];
  let total = 0;
  do {
    signal.throwIfAborted();
    const { data, count, error } = await supabase.from('user_roles')
      .select('user_id, email, chinese_name, full_name, role', users.length === 0 ? { count: 'exact' } : undefined)
      .neq('user_id', operatorUserId)
      .order('chinese_name')
      .order('user_id')
      .range(users.length, users.length + DIRECTORY_PAGE_SIZE - 1)
      .abortSignal(signal);
    signal.throwIfAborted();
    if (error || !data || (users.length === 0 && count === null)) throw new Error('用户目录读取失败');
    if (users.length === 0) total = count ?? 0;
    if (!data.length && users.length < total) throw new Error('用户目录读取不完整');
    users.push(...data as UserEntry[]);
  } while (users.length < total);
  return users;
}

type Directory = { status: 'loading' | 'error' } | { status: 'ready'; users: UserEntry[] };

export function ImpersonationPanel({ operatorUserId }: { operatorUserId: string }) {
  const [directory, setDirectory] = useState<Directory>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(DISPLAY_BATCH_SIZE);
  const [transition, setTransition] = useState<{ targetId: string } | { error: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const { startImpersonation } = useImpersonation();

  useEffect(() => {
    const request = new AbortController();
    void readDirectory(operatorUserId, request.signal).then(
      users => { if (!request.signal.aborted) setDirectory({ status: 'ready', users }); },
      () => { if (!request.signal.aborted) setDirectory({ status: 'error' }); },
    );
    return () => request.abort();
  }, [operatorUserId, retry]);

  useEffect(() => () => pending.current?.abort(), []);

  const filtered = useMemo(() => {
    if (directory.status !== 'ready') return [];
    const query = search.trim().toLowerCase();
    return directory.users.filter(user => user.user_id !== operatorUserId && (
      !query || [user.chinese_name, user.full_name, user.email].some(value => value?.toLowerCase().includes(query))
    ));
  }, [directory, operatorUserId, search]);

  async function handleSelect(user: UserEntry) {
    if (pending.current || user.user_id === operatorUserId) return;
    if (!window.confirm(`确定要模拟 ${user.chinese_name || user.full_name || user.email} 吗？\n\n模拟期间将以该用户身份浏览，所有操作为只读。`)) return;
    const request = new AbortController();
    pending.current = request;
    setTransition({ targetId: user.user_id });
    try {
      await startImpersonation(user.user_id, operatorUserId, request.signal);
    } catch (error) {
      if (!request.signal.aborted) setTransition({ error: error instanceof Error ? error.message : '进入模拟失败，请重试' });
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }

  const entering = transition && 'targetId' in transition ? transition.targetId : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">用户模拟</h2>
        <p className="mt-1 text-sm text-[var(--cd-color-text-secondary)]">
          选择用户后可按该用户的权限浏览。模拟期间为只读，进入和退出会记录审计。
        </p>
      </div>

      <div className="relative shrink-0">
        <Search aria-hidden="true" size={16} className="pointer-events-none absolute inset-y-0 left-3 my-auto text-[var(--cd-color-text-secondary)]" />
        <input
          type="search"
          aria-label="搜索姓名或邮箱"
          placeholder="搜索姓名或邮箱..."
          value={search}
          onChange={(event) => { setSearch(event.target.value); setVisibleCount(DISPLAY_BATCH_SIZE); }}
          className="min-h-11 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] py-2 pl-9 pr-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] sm:min-h-9"
        />
      </div>

      {transition && 'error' in transition && <p role="alert" className="shrink-0 text-sm text-[var(--cd-color-danger)]">{transition.error}</p>}
      {directory.status === 'loading' ? (
        <LoadingState label="正在读取用户目录" rows={0} className="py-10" />
      ) : directory.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-[var(--cd-color-danger)]">用户目录读取失败，请重试。</p>
          <Button variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => { setDirectory({ status: 'loading' }); setRetry(n => n + 1); }}>重试目录</Button>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
            {filtered.length === 0 ? <p className="p-4 text-sm text-[var(--cd-color-text-secondary)]">没有找到匹配的用户</p> : (
              <ul aria-label="可模拟用户" className="divide-y divide-[var(--cd-color-border)]">
                {filtered.slice(0, visibleCount).map(user => (
                  <li key={user.user_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_5rem_auto] sm:px-4">
                    <div className="min-w-0 text-sm">
                      <p className="break-words font-medium">{user.chinese_name || user.full_name || '—'}</p>
                      <p className="break-words text-[var(--cd-color-text-secondary)] sm:hidden">{user.email}</p>
                      <p className="text-[var(--cd-color-text-secondary)] sm:hidden">{user.role}</p>
                    </div>
                    <p className="hidden break-words text-sm text-[var(--cd-color-text-secondary)] sm:block">{user.email}</p>
                    <p className="hidden text-sm text-[var(--cd-color-text-secondary)] sm:block">{user.role}</p>
                    <Button variant="secondary" size="sm" className="min-h-11 whitespace-nowrap sm:min-h-0" disabled={Boolean(entering)} onClick={() => void handleSelect(user)}>
                      {entering === user.user_id ? '正在进入…' : '模拟此用户'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {filtered.length > visibleCount && <div className="p-3">
              <Button variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => setVisibleCount(n => n + DISPLAY_BATCH_SIZE)}>显示更多</Button>
            </div>}
          </div>
          <p className="shrink-0 text-sm text-[var(--cd-color-text-secondary)]">找到 {filtered.length} 位可模拟用户，已显示 {Math.min(filtered.length, visibleCount)} 位</p>
        </>
      )}
    </div>
  );
}
