'use client';

import * as React from 'react';
import { ImagePlus, MessageSquare, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';

import {
  adminReplyToFeedback,
  createAdminFeedback,
  deleteAdminFeedback,
  getAdminFeedbackComments,
  getAdminFeedbackIssues,
  markAdminFeedbackRead,
  updateAdminFeedbackPriority,
  updateAdminFeedbackStatus,
  type AdminFeedbackCategory,
  type AdminFeedbackComment,
  type AdminFeedbackIssue,
  type AdminFeedbackPriority,
  type AdminFeedbackStatus,
} from '@/src/services/feedbackAdminApi';
import { uploadIssueImage } from '@/src/services/adminApi';
import { logAction } from '@/src/utils/audit';

const STATUS_LABEL: Record<AdminFeedbackStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  wontfix: '暂不处理',
  duplicate: '重复反馈',
};

const STATUS_CLASS: Record<AdminFeedbackStatus, string> = {
  open: 'bg-red-50 text-red-700 ring-red-100',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-100',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  wontfix: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  duplicate: 'bg-purple-50 text-purple-700 ring-purple-100',
};

const PRIORITY_LABEL: Record<AdminFeedbackPriority, string> = {
  high: '紧急',
  medium: '普通',
  low: '低',
};

const CATEGORY_LABEL: Record<AdminFeedbackCategory, string> = {
  bug: '缺陷',
  feature: '需求',
  data: '数据',
  other: '其他',
};

const MODULE_OPTIONS = [
  { value: 'general', label: '通用' },
  { value: 'map', label: '地图系统' },
  { value: 'update', label: '季度填报' },
  { value: 'bi', label: 'BI 看板' },
  { value: 'lease', label: '租赁成交' },
  { value: 'oss', label: '研究资料库' },
  { value: 'admin', label: '管理后台' },
];

const MODULE_LABEL = Object.fromEntries(MODULE_OPTIONS.map((item) => [item.value, item.label]));
const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function formatTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: AdminFeedbackStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

function NewIssueDialog({
  open,
  adminEmail,
  onClose,
  onCreated,
}: {
  open: boolean;
  adminEmail: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<AdminFeedbackCategory>('bug');
  const [priority, setPriority] = React.useState<AdminFeedbackPriority>('medium');
  const [module, setModule] = React.useState('general');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setCategory('bug');
    setPriority('medium');
    setModule('general');
    setError('');
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await createAdminFeedback({ title, description, category, priority, module, createdBy: adminEmail });
      logAction(adminEmail, 'FEEDBACK_ADMIN_CREATED', { category, priority, module });
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div><h3 className="text-base font-semibold text-zinc-900">新建内部问题</h3><p className="mt-0.5 text-xs text-zinc-500">管理员创建的事项不会出现在普通用户的“我的反馈”中。</p></div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><X size={16} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div><label className="mb-1 block text-xs font-medium text-zinc-600">标题 *</label><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-[#003e7e]" /></div>
          <div><label className="mb-1 block text-xs font-medium text-zinc-600">描述</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={4000} className="w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-[#003e7e]" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className="mb-1 block text-xs font-medium text-zinc-600">分类</label><select value={category} onChange={(e) => setCategory(e.target.value as AdminFeedbackCategory)} className="h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm"><option value="bug">缺陷</option><option value="feature">需求</option><option value="data">数据</option><option value="other">其他</option></select></div>
            <div><label className="mb-1 block text-xs font-medium text-zinc-600">优先级</label><select value={priority} onChange={(e) => setPriority(e.target.value as AdminFeedbackPriority)} className="h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm"><option value="high">紧急</option><option value="medium">普通</option><option value="low">低</option></select></div>
            <div><label className="mb-1 block text-xs font-medium text-zinc-600">模块</label><select value={module} onChange={(e) => setModule(e.target.value)} className="h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm">{MODULE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          </div>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm text-zinc-600">取消</button><button type="submit" disabled={saving || !title.trim()} className="h-9 rounded-lg bg-[#003e7e] px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? '创建中…' : '创建'}</button></div>
      </form>
    </div>
  );
}

export default function IssueManager({ adminEmail }: { adminEmail: string }) {
  const [issues, setIssues] = React.useState<AdminFeedbackIssue[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | AdminFeedbackStatus>('all');
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'user_feedback' | 'admin'>('all');
  const [selected, setSelected] = React.useState<AdminFeedbackIssue | null>(null);
  const [comments, setComments] = React.useState<AdminFeedbackComment[]>([]);
  const [commentsLoading, setCommentsLoading] = React.useState(false);
  const [reply, setReply] = React.useState('');
  const [replyImages, setReplyImages] = React.useState<string[]>([]);
  const [replying, setReplying] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [detailError, setDetailError] = React.useState('');
  const [newDialogOpen, setNewDialogOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const loadIssues = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAdminFeedbackIssues();
      setIssues(data);
      if (selected) {
        const refreshed = data.find((item) => item.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '需求反馈加载失败');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  React.useEffect(() => { void loadIssues(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadCount = React.useMemo(() => issues.filter((issue) => issue.has_unread_user_activity).length, [issues]);

  const filtered = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && issue.source !== sourceFilter) return false;
      if (!keyword) return true;
      return `${issue.title} ${issue.description} ${issue.created_by}`.toLowerCase().includes(keyword);
    });
  }, [issues, search, sourceFilter, statusFilter]);

  const openIssue = async (issue: AdminFeedbackIssue) => {
    setSelected({ ...issue, has_unread_user_activity: false, last_read_at: new Date().toISOString() });
    setIssues((current) => current.map((item) => item.id === issue.id ? { ...item, has_unread_user_activity: false, last_read_at: new Date().toISOString() } : item));
    setReply('');
    setReplyImages([]);
    setDetailError('');
    setCommentsLoading(true);
    try {
      await markAdminFeedbackRead(issue.id);
      setComments(await getAdminFeedbackComments(issue.id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '沟通记录加载失败');
    } finally {
      setCommentsLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!selected) return;
    const issueId = selected.id;
    const [nextIssues, nextComments] = await Promise.all([getAdminFeedbackIssues(), getAdminFeedbackComments(issueId)]);
    await markAdminFeedbackRead(issueId).catch(() => undefined);
    setIssues(nextIssues.map((item) => item.id === issueId ? { ...item, has_unread_user_activity: false, last_read_at: new Date().toISOString() } : item));
    const nextSelected = nextIssues.find((item) => item.id === issueId);
    if (nextSelected) setSelected({ ...nextSelected, has_unread_user_activity: false, last_read_at: new Date().toISOString() });
    setComments(nextComments);
  };

  const submitReply = async (nextStatus: AdminFeedbackStatus | null) => {
    if (!selected || replying || (!reply.trim() && replyImages.length === 0)) return;
    setReplying(true);
    setDetailError('');
    try {
      await adminReplyToFeedback({ issueId: selected.id, content: reply, images: replyImages, nextStatus });
      logAction(adminEmail, 'FEEDBACK_ADMIN_REPLIED', { issue_id: selected.id, next_status: nextStatus, has_images: replyImages.length > 0 });
      if (nextStatus && nextStatus !== selected.status) {
        logAction(adminEmail, 'FEEDBACK_STATUS_CHANGED', { issue_id: selected.id, old_status: selected.status, new_status: nextStatus });
      }
      setReply('');
      setReplyImages([]);
      await refreshDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '回复失败');
    } finally {
      setReplying(false);
    }
  };

  const changeStatus = async (status: AdminFeedbackStatus) => {
    if (!selected || status === selected.status) return;
    const oldStatus = selected.status;
    try {
      await updateAdminFeedbackStatus(selected.id, status);
      logAction(adminEmail, 'FEEDBACK_STATUS_CHANGED', { issue_id: selected.id, old_status: oldStatus, new_status: status });
      await refreshDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '状态更新失败');
    }
  };

  const changePriority = async (priority: AdminFeedbackPriority) => {
    if (!selected || priority === selected.priority) return;
    try {
      await updateAdminFeedbackPriority(selected.id, priority);
      await refreshDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '优先级更新失败');
    }
  };

  const uploadReplyImage = async (file: File) => {
    if (!file.type.startsWith('image/') || replyImages.length >= 3) return;
    setUploading(true);
    try {
      const url = await uploadIssueImage(file);
      setReplyImages((current) => [...current, url].slice(0, 3));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const removeIssue = async () => {
    if (!selected || !window.confirm('确定删除这条问题及其沟通记录吗？此操作不可恢复。')) return;
    try {
      await deleteAdminFeedback(selected.id);
      logAction(adminEmail, 'ADMIN_DATA_OPERATION', { operation: 'DELETE', table: 'admin_issues', target_id: selected.id });
      setSelected(null);
      setComments([]);
      await loadIssues();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-[620px] max-w-[1320px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 sm:px-5">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2"><h2 className="text-base font-semibold text-zinc-900">需求反馈</h2>{unreadCount > 0 ? <span className="rounded-full bg-[#003e7e] px-2 py-0.5 text-[11px] font-semibold text-white">{unreadCount} 条用户新动态</span> : null}</div>
          <p className="mt-0.5 text-xs text-zinc-500">用户反馈与内部问题统一管理；打开反馈后会标记为已读。</p>
        </div>
        <button type="button" onClick={() => void loadIssues()} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-xs text-zinc-600 hover:bg-zinc-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新</button>
        <button type="button" onClick={() => setNewDialogOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#003e7e] px-3 text-xs font-medium text-white"><Plus size={14} />新建内部问题</button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[390px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-zinc-200">
          <div className="space-y-2 border-b border-zinc-200 p-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题、描述或提交人" className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-[#003e7e]" />
            <div className="grid grid-cols-2 gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | AdminFeedbackStatus)} className="h-9 rounded-lg border border-zinc-300 px-2 text-xs"><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'user_feedback' | 'admin')} className="h-9 rounded-lg border border-zinc-300 px-2 text-xs"><option value="all">全部来源</option><option value="user_feedback">用户反馈</option><option value="admin">内部问题</option></select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && issues.length === 0 ? <div className="p-6 text-center text-sm text-zinc-400">正在加载…</div> : error ? <div className="m-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</div> : filtered.length === 0 ? <div className="p-8 text-center text-sm text-zinc-400">暂无匹配问题</div> : filtered.map((issue) => (
              <button key={issue.id} type="button" onClick={() => void openIssue(issue)} className={`flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left transition-colors hover:bg-zinc-50 ${selected?.id === issue.id ? 'bg-blue-50/60' : ''}`}>
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${issue.has_unread_user_activity ? 'bg-[#003e7e]' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-zinc-800">{issue.title}</span>{issue.source === 'user_feedback' ? <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">用户</span> : <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">内部</span>}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400"><span className="truncate">{issue.has_unread_user_activity ? '用户有新动态' : issue.created_by}</span><span>·</span><span>{formatTime(issue.last_activity_at ?? issue.created_at)}</span></span>
                </span>
                <StatusBadge status={issue.status} />
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-zinc-400"><MessageSquare size={28} strokeWidth={1.4} /><p className="mt-3 text-sm">选择一条反馈查看详情和沟通记录</p></div>
          ) : (
            <div className="mx-auto max-w-3xl p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-lg font-semibold text-zinc-900">{selected.title}</h3><StatusBadge status={selected.status} /></div><p className="mt-1 text-xs text-zinc-500">{selected.source === 'user_feedback' ? `用户反馈 · ${selected.created_by}` : `内部问题 · ${selected.created_by}`} · {CATEGORY_LABEL[selected.category]} · {MODULE_LABEL[selected.module] ?? selected.module} · {formatTime(selected.created_at)}</p></div>
                <button type="button" onClick={() => void removeIssue()} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} />删除</button>
              </div>

              <div className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700">{selected.description || '无详细描述'}</div>
              {selected.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{selected.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`截图 ${index + 1}`} className="h-20 w-20 rounded-lg border border-zinc-200 object-cover" /></a>)}</div> : null}

              <div className="mt-5 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2">
                <div><label className="mb-1 block text-[11px] font-medium text-zinc-500">处理状态</label><select value={selected.status} onChange={(e) => void changeStatus(e.target.value as AdminFeedbackStatus)} className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm">{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <div><label className="mb-1 block text-[11px] font-medium text-zinc-500">优先级</label><select value={selected.priority} onChange={(e) => void changePriority(e.target.value as AdminFeedbackPriority)} className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm">{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              </div>

              <div className="mt-6 border-t border-zinc-200 pt-5">
                <h4 className="text-sm font-semibold text-zinc-800">沟通记录</h4>
                {commentsLoading ? <div className="py-6 text-center text-sm text-zinc-400">正在加载…</div> : comments.length === 0 ? <div className="py-6 text-center text-sm text-zinc-400">暂无沟通记录</div> : (
                  <div className="mt-3 space-y-3">
                    {comments.map((comment) => {
                      if (comment.kind === 'status_change') {
                        const from = comment.metadata?.from as AdminFeedbackStatus | undefined;
                        const to = comment.metadata?.to as AdminFeedbackStatus | undefined;
                        return <div key={comment.id} className="flex items-center gap-2 text-[11px] text-zinc-400"><span className="h-px flex-1 bg-zinc-200" /><span>{comment.is_admin ? '管理员' : '用户'}将状态从「{from ? STATUS_LABEL[from] : '未知'}」更新为「{to ? STATUS_LABEL[to] : '未知'}」 · {formatTime(comment.created_at)}</span><span className="h-px flex-1 bg-zinc-200" /></div>;
                      }
                      return <div key={comment.id} className={`rounded-lg border p-3 ${comment.is_admin ? 'border-blue-100 bg-blue-50/70' : 'border-zinc-200 bg-white'}`}><div className="flex items-center justify-between gap-3 text-[11px]"><span className={`font-semibold ${comment.is_admin ? 'text-blue-700' : 'text-zinc-600'}`}>{comment.is_admin ? '管理员' : comment.created_by}</span><span className="text-zinc-400">{formatTime(comment.created_at)}</span></div>{comment.content ? <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-5 text-zinc-700">{comment.content}</p> : null}{comment.images?.length ? <div className="mt-2 flex flex-wrap gap-2">{comment.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`回复截图 ${index + 1}`} className="h-16 w-16 rounded border border-zinc-200 object-cover" /></a>)}</div> : null}</div>;
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <label className="block text-sm font-semibold text-zinc-800">回复用户</label>
                <p className="mt-0.5 text-xs text-zinc-500">回复会直接显示在用户的“我的反馈”中；状态变化也会进入沟通记录。</p>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={2000} placeholder={selected.source === 'user_feedback' ? '例如：问题已经定位，正在处理；或已修复，请刷新后重试。' : '添加处理说明…'} className="mt-3 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#003e7e]" />
                {replyImages.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{replyImages.map((url, index) => <div key={url} className="relative"><img src={url} alt="" className="h-14 w-14 rounded border border-zinc-200 object-cover" /><button type="button" onClick={() => setReplyImages((current) => current.filter((_, i) => i !== index))} className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white"><X size={10} /></button></div>)}</div> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || replyImages.length >= 3} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-600 disabled:opacity-50"><ImagePlus size={13} />{uploading ? '上传中…' : '添加截图'}</button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadReplyImage(file); e.target.value = ''; }} />
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => void submitReply(null)} disabled={replying || (!reply.trim() && replyImages.length === 0)} className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-600 disabled:opacity-50">仅回复</button>
                    <button type="button" onClick={() => void submitReply('in_progress')} disabled={replying || (!reply.trim() && replyImages.length === 0)} className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-700 disabled:opacity-50">回复并开始处理</button>
                    <button type="button" onClick={() => void submitReply('resolved')} disabled={replying || (!reply.trim() && replyImages.length === 0)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#003e7e] px-3 text-xs font-medium text-white disabled:opacity-50"><Send size={13} />回复并标记已解决</button>
                  </div>
                </div>
                {detailError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{detailError}</p> : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <NewIssueDialog open={newDialogOpen} adminEmail={adminEmail} onClose={() => setNewDialogOpen(false)} onCreated={loadIssues} />
    </div>
  );
}
