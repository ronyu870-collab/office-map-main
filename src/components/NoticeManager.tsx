'use client';

import * as React from 'react';
import { logAction } from '@/src/utils/audit';
import { getAllActiveNotices } from '@/src/services/apiClient';
import { publishNotice, deactivateNotice } from '@/src/services/adminApi';
import type { NoticeRow } from '@/src/services/apiClient';
import { MaskedText } from '@/src/components/demo';
import { Button } from '@/src/components/ui';

const MAX_NOTICES = 3;

interface Props {
  adminEmail: string;
}

export function NoticeManager({ adminEmail }: Props) {
  const [notices, setNotices] = React.useState<NoticeRow[]>([]);
  const [drafts, setDrafts] = React.useState<string[]>(['', '', '']);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<number | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchNotices = React.useCallback(async () => {
    setLoading(true);
    const data = await getAllActiveNotices();
    setNotices(data);
    // 草稿槽重置为空（已有内容的槽不预填，保持"需手动清空才能编辑"的设计）
    setDrafts(['', '', '']);
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchNotices(); }, [fetchNotices]);

  const handlePublish = async (slotIndex: number) => {
    const content = drafts[slotIndex].trim();
    if (!content) { showToast('公告内容不能为空', false); return; }
    if (notices.length >= MAX_NOTICES) {
      showToast('已达到3条上限，请先删除一条再发布', false);
      return;
    }
    setSaving(slotIndex);
    try {
      await publishNotice(content, adminEmail);
      logAction(adminEmail, 'UPDATE_NOTICE', { content: content.slice(0, 50) });
      showToast('公告已发布');
      await fetchNotices();
    } catch (e: any) {
      showToast(e.message ?? '发布失败', false);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (notice: NoticeRow) => {
    if (!confirm(`确认删除这条公告？\n\n"${notice.content.slice(0, 40)}${notice.content.length > 40 ? '…' : ''}"`)) return;
    try {
      await deactivateNotice(notice.id);
      logAction(adminEmail, 'DELETE_NOTICE', { content: notice.content.slice(0, 50) });
      showToast('公告已删除');
      await fetchNotices();
    } catch (e: any) {
      showToast(e.message ?? '删除失败', false);
    }
  };

  const setDraft = (i: number, val: string) =>
    setDrafts(prev => prev.map((d, idx) => idx === i ? val : d));

  // 空槽数量 = 3 - 当前生效条数
  const emptySlots = MAX_NOTICES - notices.length;

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
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
          notices.length > 0
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-zinc-200 bg-zinc-100 text-zinc-500'
        }`}>
          {notices.length} / {MAX_NOTICES} 条生效中
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-100" />)}
        </div>
      ) : (
        <>
          {/* ── 已生效的公告（只读，可删除） ── */}
          {notices.map((notice, i) => (
            <div key={notice.id} className="rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--cd-color-brand)]">
                  公告 {i + 1} · 生效中
                </span>
                <button
                  onClick={() => handleDelete(notice)}
                  className="rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  删除此条
                </button>
              </div>
              {/* 内容只读展示 */}
              <p className="text-sm leading-relaxed text-zinc-800 whitespace-pre-wrap">{notice.content}</p>
              <p className="mt-2 text-[11px] text-zinc-400">
                由 <MaskedText>{notice.updated_by}</MaskedText> 发布于 {new Date(notice.updated_at).toLocaleString('zh-CN', { hour12: false })}
              </p>
            </div>
          ))}

          {/* ── 空槽（可新增） ── */}
          {Array.from({ length: emptySlots }).map((_, i) => {
            const slotIdx = i; // draft 索引复用 0~2，但只用前 emptySlots 个
            return (
              <div key={`empty-${i}`} className="rounded-lg border border-dashed border-zinc-300 bg-white p-4">
                <p className="mb-2 text-xs font-semibold text-zinc-500">
                  空槽 · 可新增公告
                </p>
                <textarea
                  value={drafts[slotIdx]}
                  onChange={e => setDraft(slotIdx, e.target.value)}
                  rows={3}
                  placeholder="输入公告内容后点击发布，例如：本周五下午3点系统将进行例行维护，请提前保存数据。"
                  className="w-full resize-none rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 text-sm text-[var(--cd-color-text-primary)] outline-none transition-colors focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handlePublish(slotIdx)}
                    disabled={saving === slotIdx || !drafts[slotIdx].trim()}
                  >
                    {saving === slotIdx ? '发布中...' : '发布公告'}
                  </Button>
                  <span className="ml-auto text-[11px] text-zinc-400">{drafts[slotIdx].length} 字</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
