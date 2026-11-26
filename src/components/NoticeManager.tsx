'use client';

import * as React from 'react';
import { logAction } from '@/src/utils/audit';
import { getActiveNoticeContent, getActiveNoticeSummaries, MAX_ACTIVE_NOTICES, toNoticeSummary } from '@/src/services/apiClient';
import { publishNotice, deactivateNotice } from '@/src/services/adminApi';
import type { NoticeSummary } from '@/src/services/apiClient';
import { MaskedText } from '@/src/components/demo';
import { Button } from '@/src/components/ui';
import { useAdminEditProtection } from '@/src/components/admin/AdminEditProtection';
import { readNoticeDrafts, writeNoticeDrafts } from '@/src/components/admin/noticeDraftStorage';

type NoticeDetail = { id: string; state: 'loading' | 'error' } | { id: string; state: 'ready'; content: string };

interface Props {
  adminEmail: string;
  draftStorageKey?: string | null;
}

const noticeSlots = (texts: string[] = []) => Array.from({ length: MAX_ACTIVE_NOTICES }, (_, id) => ({ id, text: texts[id] ?? '' }));

export function NoticeManager({ adminEmail, draftStorageKey = null }: Props) {
  const [notices, setNotices] = React.useState<NoticeSummary[] | null>(null);
  const [drafts, setDrafts] = React.useState(() => noticeSlots(readNoticeDrafts(draftStorageKey, MAX_ACTIVE_NOTICES)));
  const latestDrafts = React.useRef(drafts);
  const nextDraftId = React.useRef(MAX_ACTIVE_NOTICES);
  const [loading, setLoading] = React.useState(true);
  const [listError, setListError] = React.useState(false);
  const [detail, setDetail] = React.useState<NoticeDetail | null>(null);
  const mutationInFlight = React.useRef(false);
  const listRequest = React.useRef<AbortController | null>(null);
  const detailRequest = React.useRef<{ id: string; controller: AbortController } | null>(null);
  const mounted = React.useRef(false);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [deleting, setDeleting] = React.useState(false);
  const [saving, setSaving] = React.useState<number | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);
  const { register } = useAdminEditProtection();
  const draftGuard = React.useRef(Symbol('notice-drafts'));
  const dirty = drafts.some(draft => draft.text.length > 0);

  const updateDrafts = React.useCallback((next: typeof drafts) => {
    latestDrafts.current = next;
    setDrafts(next);
    writeNoticeDrafts(draftStorageKey, next.map(draft => draft.text));
  }, [draftStorageKey]);

  React.useEffect(() => {
    if (!dirty) return;
    const unregister = register(draftGuard.current, async () => {
      if (!latestDrafts.current.some(draft => draft.text.length > 0)) return true;
      if (mutationInFlight.current || !window.confirm('还有未发布的公告草稿。要放弃草稿并离开吗？')) return false;
      updateDrafts(latestDrafts.current.map(draft => ({ ...draft, text: '' })));
      return true;
    });
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!latestDrafts.current.some(draft => draft.text.length > 0)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => { unregister(); window.removeEventListener('beforeunload', warnBeforeUnload); };
  }, [dirty, register, updateDrafts]);

  const showToast = (msg: string, ok = true) => {
    if (!mounted.current) return;
    clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const fetchNotices = React.useCallback(async () => {
    if (!mounted.current) return;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    setListError(false);
    try {
      const rows = await getActiveNoticeSummaries(request.signal);
      if (!request.signal.aborted) {
        setNotices(rows);
        const pendingDetail = detailRequest.current;
        if (pendingDetail && !rows.some(row => row.id === pendingDetail.id)) pendingDetail.controller.abort();
        setDetail(current => current && rows.some(row => row.id === current.id) ? current : null);
      }
    } catch {
      if (!request.signal.aborted) setListError(true);
    } finally {
      if (listRequest.current === request) {
        listRequest.current = null;
        if (!request.signal.aborted) setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void fetchNotices();
    return () => {
      mounted.current = false;
      listRequest.current?.abort();
      detailRequest.current?.controller.abort();
      clearTimeout(toastTimer.current);
    };
  }, [fetchNotices]);

  const closeDetail = () => {
    detailRequest.current?.controller.abort();
    setDetail(null);
  };

  const openDetail = async (id: string) => {
    detailRequest.current?.controller.abort();
    const controller = new AbortController();
    const request = { id, controller };
    detailRequest.current = request;
    setDetail({ id, state: 'loading' });
    try {
      const content = await getActiveNoticeContent(id, controller.signal);
      if (!controller.signal.aborted) setDetail({ id, state: 'ready', content });
    } catch {
      if (!controller.signal.aborted) setDetail({ id, state: 'error' });
    } finally {
      if (detailRequest.current === request) detailRequest.current = null;
    }
  };

  const handlePublish = async (draftId: number) => {
    if (mutationInFlight.current || loading || listError || !notices) return;
    const content = drafts.find(draft => draft.id === draftId)?.text.trim();
    if (!content) { showToast('公告内容不能为空', false); return; }
    if (notices.length >= MAX_ACTIVE_NOTICES) {
      showToast('已达到3条上限，请先删除一条再发布', false);
      return;
    }
    mutationInFlight.current = true;
    setSaving(draftId);
    try {
      const published = await publishNotice(content, adminEmail);
      logAction(adminEmail, 'UPDATE_NOTICE', { content: content.slice(0, 50) });
      if (!mounted.current) return;
      // Compact the remaining drafts before the number of visible slots shrinks.
      const blankDraft = { id: nextDraftId.current++, text: '' };
      updateDrafts([...latestDrafts.current.filter(draft => draft.id !== draftId), blankDraft]);
      setNotices(current => [...(current ?? []).filter(notice => notice.id !== published.id), toNoticeSummary(published)].slice(0, MAX_ACTIVE_NOTICES));
      showToast('公告已发布');
      await fetchNotices();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '发布失败', false);
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setSaving(null);
    }
  };

  const handleDelete = async (notice: NoticeSummary) => {
    if (mutationInFlight.current || loading || listError) return;
    if (!confirm(`确认删除这条公告？\n\n"${notice.contentPreview.slice(0, 40)}${notice.contentPreview.length > 40 ? '…' : ''}"`)) return;
    mutationInFlight.current = true;
    setDeleting(true);
    try {
      await deactivateNotice(notice.id);
      logAction(adminEmail, 'DELETE_NOTICE', { content: notice.contentPreview.slice(0, 50) });
      if (!mounted.current) return;
      if (detailRequest.current?.id === notice.id) detailRequest.current.controller.abort();
      setDetail(current => current?.id === notice.id ? null : current);
      setNotices(current => current?.filter(row => row.id !== notice.id) ?? null);
      showToast('公告已删除');
      await fetchNotices();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', false);
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setDeleting(false);
    }
  };

  const setDraft = (id: number, text: string) =>
    updateDrafts(latestDrafts.current.map(draft => draft.id === id ? { id, text } : draft));

  const emptySlots = notices ? MAX_ACTIVE_NOTICES - notices.length : 0;
  const actionsDisabled = saving !== null || deleting || loading || listError;

  return (
    <div className="relative space-y-4 w-full">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">系统公告管理</h2>
          <p className="mt-0.5 text-xs text-zinc-500">最多同时发布 3 条公告，显示在所有用户主页底部</p>
        </div>
        {notices && <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
          notices.length > 0
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-zinc-200 bg-zinc-100 text-zinc-500'
        }`}>
          {notices.length} / {MAX_ACTIVE_NOTICES} 条生效中
        </span>}
      </div>

      {listError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span>{notices ? '公告列表刷新失败，请重试后再操作' : '公告列表读取失败'}</span>
          <Button variant="ghost" size="sm" onClick={() => void fetchNotices()}>重试加载列表</Button>
        </div>
      )}
      {loading && !notices ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-100" />)}
        </div>
      ) : (
        <>
          {/* ── 已生效的公告（只读，可删除） ── */}
          {notices?.map((notice, i) => {
            const opened = detail?.id === notice.id ? detail : null;
            return (
              <div key={notice.id} className="rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--cd-color-brand)]">
                    公告 {i + 1} · 生效中
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(notice)}
                    disabled={actionsDisabled}
                    className="min-h-11 rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 sm:min-h-8"
                  >
                    删除此条
                  </button>
                </div>
                <div id={`notice-content-${notice.id}`}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 [overflow-wrap:anywhere]">
                    {opened?.state === 'ready' ? opened.content : notice.contentPreview + (notice.hasMore ? '…' : '')}
                  </p>
                  {opened?.state === 'loading' && <p role="status" className="mt-2 text-xs text-zinc-500">正在读取正文…</p>}
                  {opened?.state === 'error' && (
                    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-800">
                      正文暂时无法读取
                      <Button variant="ghost" size="sm" onClick={() => void openDetail(notice.id)}>重试读取正文</Button>
                    </div>
                  )}
                </div>
                {notice.hasMore && (
                  <Button variant="ghost" size="sm" className="mt-1 min-h-11 sm:min-h-8" aria-expanded={!!opened} aria-controls={`notice-content-${notice.id}`}
                    aria-label={opened ? `收起公告 ${i + 1} 正文` : `查看公告 ${i + 1} 全文`}
                    onClick={() => opened ? closeDetail() : void openDetail(notice.id)}>
                    {opened ? '收起正文' : '查看全文'}
                  </Button>
                )}
                <p className="mt-2 text-[11px] text-zinc-400">
                  由 <MaskedText>{notice.updated_by}</MaskedText> 发布于 {new Date(notice.updated_at).toLocaleString('zh-CN', { hour12: false })}
                </p>
              </div>
            );
          })}

          {/* ── 空槽（可新增） ── */}
          {drafts.slice(0, emptySlots).map((draft, index) => {
            return (
              <div key={draft.id} className="rounded-lg border border-dashed border-zinc-300 bg-white p-4">
                <p className="mb-2 text-xs font-semibold text-zinc-500">
                  空槽 · 可新增公告
                </p>
                <textarea
                  aria-label={`公告草稿 ${index + 1}`}
                  value={draft.text}
                  disabled={saving === draft.id}
                  onChange={e => setDraft(draft.id, e.target.value)}
                  rows={3}
                  placeholder="输入公告内容后点击发布，例如：本周五下午3点系统将进行例行维护，请提前保存数据。"
                  className="w-full resize-none rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 text-sm text-[var(--cd-color-text-primary)] outline-none transition-colors focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    onClick={() => handlePublish(draft.id)}
                    disabled={actionsDisabled || !draft.text.trim()}
                  >
                    {saving === draft.id ? '发布中...' : '发布公告'}
                  </Button>
                  <span className="ml-auto text-[11px] text-zinc-400">{draft.text.length} 字</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
