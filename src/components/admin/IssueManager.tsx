'use client';

import * as React from 'react';
import {
  ChevronDown,
  ImagePlus,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';

import {
  adminReplyToFeedback,
  createAdminFeedback,
  deleteAdminFeedback,
  getAdminFeedbackIssues,
  updateAdminFeedbackPriority,
  updateAdminFeedbackStatus,
  type AdminFeedbackCategory,
  type AdminFeedbackComment,
  type AdminFeedbackIssue,
  type AdminFeedbackPriority,
  type AdminFeedbackStatus,
} from '@/src/services/feedbackAdminApi';
import { isLaterFeedbackActivity, mergeFeedbackReadAt } from '@/src/services/feedbackThread';
import { useFeedbackThread, type FeedbackThreadSelection } from '@/src/hooks/useFeedbackThread';
import { uploadIssueImage } from '@/src/services/adminApi';
import { logAction } from '@/src/utils/audit';

function mergeReceipt(issue: AdminFeedbackIssue, readAt: string | null): AdminFeedbackIssue {
  const lastReadAt = mergeFeedbackReadAt(issue.last_read_at, readAt);
  return { ...issue, last_read_at: lastReadAt, has_unread_user_activity: issue.source === 'user_feedback' && isLaterFeedbackActivity(issue.last_user_activity_at, lastReadAt) };
}

const STATUS_LABEL: Record<AdminFeedbackStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  wontfix: '暂不处理',
  duplicate: '重复反馈',
};

const STATUS_CLASS: Record<AdminFeedbackStatus, string> = {
  open: 'bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)] ring-[var(--cd-color-border)]',
  in_progress: 'bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)] ring-[var(--cd-color-brand)]/15',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  wontfix: 'bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-muted)] ring-[var(--cd-color-border)]',
  duplicate: 'bg-violet-50 text-violet-700 ring-violet-100',
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
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
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
    <div className="fixed inset-0 z-[var(--cd-z-modal)] flex items-center justify-center bg-[var(--cd-color-overlay)] p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-xl overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-popover)]">
        <div className="flex items-center justify-between border-b border-[var(--cd-color-border)] px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">新建内部问题</h3>
            <p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">仅用于内部跟踪，不会显示在普通用户的“我的反馈”中。</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[var(--cd-radius-md)] text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)]"><X size={16} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">标题</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="一句话说明事项" className="h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 text-sm outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)]" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={4000} className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cd-color-brand)]" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className="mb-1 block text-[11px] font-medium text-[var(--cd-color-text-muted)]">分类</label><select value={category} onChange={(e) => setCategory(e.target.value as AdminFeedbackCategory)} className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-xs"><option value="bug">缺陷</option><option value="feature">需求</option><option value="data">数据</option><option value="other">其他</option></select></div>
            <div><label className="mb-1 block text-[11px] font-medium text-[var(--cd-color-text-muted)]">优先级</label><select value={priority} onChange={(e) => setPriority(e.target.value as AdminFeedbackPriority)} className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-xs"><option value="high">紧急</option><option value="medium">普通</option><option value="low">低</option></select></div>
            <div><label className="mb-1 block text-[11px] font-medium text-[var(--cd-color-text-muted)]">模块</label><select value={module} onChange={(e) => setModule(e.target.value)} className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-xs">{MODULE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          </div>
          {error ? <p className="rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--cd-color-border)] px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 text-sm text-[var(--cd-color-text-secondary)]">取消</button>
          <button type="submit" disabled={saving || !title.trim()} className="h-9 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? '创建中…' : '创建'}</button>
        </div>
      </form>
    </div>
  );
}

function TimelineItem({ comment }: { comment: AdminFeedbackComment }) {
  if (comment.kind === 'status_change') {
    const from = comment.metadata?.from as AdminFeedbackStatus | undefined;
    const to = comment.metadata?.to as AdminFeedbackStatus | undefined;
    return (
      <div className="relative pl-8">
        <span className="absolute left-[9px] top-2 h-2 w-2 rounded-full border-2 border-[var(--cd-color-surface)] bg-[var(--cd-color-border-strong)] ring-1 ring-[var(--cd-color-border)]" />
        <div className="py-0.5 text-[11px] leading-5 text-[var(--cd-color-text-muted)]">
          {comment.is_admin ? '管理员' : '用户'}将状态从「{from ? STATUS_LABEL[from] : '未知'}」更新为「{to ? STATUS_LABEL[to] : '未知'}」 · {formatTime(comment.created_at)}
        </div>
      </div>
    );
  }

  return (
    <div className="relative pl-8">
      <span className={`absolute left-[4px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold ring-4 ring-[var(--cd-color-surface)] ${comment.is_admin ? 'bg-[var(--cd-color-brand)] text-white' : 'bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)] ring-1 ring-[var(--cd-color-border)]'}`}>
        {comment.is_admin ? '管' : '用'}
      </span>
      <div className="pb-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`font-medium ${comment.is_admin ? 'text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-secondary)]'}`}>{comment.is_admin ? '管理员' : comment.created_by}</span>
          <span className="text-[var(--cd-color-text-muted)]">{formatTime(comment.created_at)}</span>
        </div>
        {comment.content ? <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--cd-color-text-primary)]">{comment.content}</p> : null}
        {comment.images?.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {comment.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`回复截图 ${index + 1}`} className="h-16 w-16 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] object-cover" /></a>)}
          </div>
        ) : null}
      </div>
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
  const thread = useFeedbackThread();
  const { comments, loading: commentsLoading, error: commentsError } = thread;
  const listGeneration = React.useRef(0);
  const [reply, setReply] = React.useState('');
  const [replyImages, setReplyImages] = React.useState<string[]>([]);
  const [replying, setReplying] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [detailError, setDetailError] = React.useState('');
  const [newDialogOpen, setNewDialogOpen] = React.useState(false);
  const [actionMenuOpen, setActionMenuOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const loadIssues = React.useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    setError('');
    try {
      const data = await getAdminFeedbackIssues();
      if (generation !== listGeneration.current) return;
      setIssues(current => {
        const readByIssue = new Map(current.map(issue => [issue.id, issue.last_read_at]));
        return data.map(issue => mergeReceipt(issue, readByIssue.get(issue.id) ?? null));
      });
      setSelected(current => {
        if (!current) return current;
        const refreshed = data.find(item => item.id === current.id);
        return refreshed ? mergeReceipt(refreshed, current.last_read_at) : current;
      });
    } catch (err) {
      if (generation === listGeneration.current) setError(err instanceof Error ? err.message : '需求反馈加载失败');
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadIssues(); }, [loadIssues]);

  const unreadCount = React.useMemo(() => issues.filter((issue) => issue.has_unread_user_activity).length, [issues]);

  const counts = React.useMemo(() => ({
    all: issues.length,
    open: issues.filter((issue) => issue.status === 'open').length,
    in_progress: issues.filter((issue) => issue.status === 'in_progress').length,
    resolved: issues.filter((issue) => issue.status === 'resolved').length,
  }), [issues]);

  const filtered = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && issue.source !== sourceFilter) return false;
      if (!keyword) return true;
      return `${issue.title} ${issue.description} ${issue.created_by}`.toLowerCase().includes(keyword);
    });
  }, [issues, search, sourceFilter, statusFilter]);

  const loadThread = (issue: AdminFeedbackIssue, selection: FeedbackThreadSelection) => {
    return thread.load(selection, (readAt) => {
      const receipt = readAt ?? issue.last_user_activity_at;
      setIssues(current => current.map(item => item.id === issue.id ? mergeReceipt(item, receipt) : item));
      setSelected(current => current?.id === issue.id ? mergeReceipt(current, receipt) : current);
    });
  };

  const openIssue = (issue: AdminFeedbackIssue) => {
    const selection = thread.select(issue.id);
    setSelected(issue);
    setReply('');
    setReplyImages([]);
    setDetailError('');
    setActionMenuOpen(false);
    return loadThread(issue, selection);
  };

  const refreshDetail = async (issue: AdminFeedbackIssue, selection: FeedbackThreadSelection) => {
    await Promise.all([loadIssues(), loadThread(issue, selection)]);
  };

  const submitReply = async (nextStatus: AdminFeedbackStatus | null) => {
    const selection = thread.current();
    if (!selected || selection?.issueId !== selected.id || replying || (!reply.trim() && replyImages.length === 0)) return;
    setReplying(true);
    setDetailError('');
    setActionMenuOpen(false);
    try {
      await adminReplyToFeedback({ issueId: selected.id, content: reply, images: replyImages, nextStatus });
      logAction(adminEmail, 'FEEDBACK_ADMIN_REPLIED', { issue_id: selected.id, next_status: nextStatus, has_images: replyImages.length > 0 });
      if (nextStatus && nextStatus !== selected.status) {
        logAction(adminEmail, 'FEEDBACK_STATUS_CHANGED', { issue_id: selected.id, old_status: selected.status, new_status: nextStatus });
      }
      if (thread.isCurrent(selection)) {
        setReply('');
        setReplyImages([]);
      }
      await refreshDetail(selected, selection);
    } catch (err) {
      if (thread.isCurrent(selection)) setDetailError(err instanceof Error ? err.message : '回复失败');
    } finally {
      setReplying(false);
    }
  };

  const changeStatus = async (status: AdminFeedbackStatus) => {
    const selection = thread.current();
    if (!selected || selection?.issueId !== selected.id || status === selected.status) return;
    const oldStatus = selected.status;
    try {
      await updateAdminFeedbackStatus(selected.id, status);
      logAction(adminEmail, 'FEEDBACK_STATUS_CHANGED', { issue_id: selected.id, old_status: oldStatus, new_status: status });
      await refreshDetail(selected, selection);
    } catch (err) {
      if (thread.isCurrent(selection)) setDetailError(err instanceof Error ? err.message : '状态更新失败');
    }
  };

  const changePriority = async (priority: AdminFeedbackPriority) => {
    const selection = thread.current();
    if (!selected || selection?.issueId !== selected.id || priority === selected.priority) return;
    try {
      await updateAdminFeedbackPriority(selected.id, priority);
      await refreshDetail(selected, selection);
    } catch (err) {
      if (thread.isCurrent(selection)) setDetailError(err instanceof Error ? err.message : '优先级更新失败');
    }
  };

  const uploadReplyImage = async (file: File) => {
    const selection = thread.current();
    if (!selection || !file.type.startsWith('image/') || replyImages.length >= 3) return;
    setUploading(true);
    try {
      const url = await uploadIssueImage(file);
      if (thread.isCurrent(selection)) setReplyImages((current) => [...current, url].slice(0, 3));
    } catch (err) {
      if (thread.isCurrent(selection)) setDetailError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const removeIssue = async () => {
    const selection = thread.current();
    if (!selected || selection?.issueId !== selected.id || !window.confirm('确定删除这条问题及其沟通记录吗？此操作不可恢复。')) return;
    try {
      await deleteAdminFeedback(selected.id);
      logAction(adminEmail, 'ADMIN_DATA_OPERATION', { operation: 'DELETE', table: 'admin_issues', target_id: selected.id });
      if (thread.isCurrent(selection)) { thread.clear(); setSelected(null); }
      await loadIssues();
    } catch (err) {
      if (thread.isCurrent(selection)) setDetailError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const primaryReplyAction = selected?.status === 'open'
    ? { label: '回复并开始处理', status: 'in_progress' as AdminFeedbackStatus }
    : selected?.status === 'in_progress'
      ? { label: '回复并标记已解决', status: 'resolved' as AdminFeedbackStatus }
      : { label: '回复', status: null };

  const replyDisabled = replying || (!reply.trim() && replyImages.length === 0);

  return (
    <div className="mx-auto flex h-full min-h-[620px] max-w-[1380px] flex-col overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--cd-color-border)] px-4 py-3.5 sm:px-5">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">需求反馈</h2>
            {unreadCount > 0 ? <span className="rounded-full bg-[var(--cd-color-brand)] px-2 py-0.5 text-[10px] font-semibold text-white">{unreadCount} 条新动态</span> : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--cd-color-text-muted)]">集中处理用户反馈与内部问题</p>
        </div>
        <button type="button" onClick={() => void loadIssues()} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新</button>
        <button type="button" onClick={() => setNewDialogOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3 text-xs font-medium text-white"><Plus size={14} />新建内部问题</button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--cd-color-border)]">
          <div className="border-b border-[var(--cd-color-border)] p-3">
            <div className="flex gap-1 overflow-x-auto pb-2">
              {([
                ['all', '全部', counts.all],
                ['open', '待处理', counts.open],
                ['in_progress', '处理中', counts.in_progress],
                ['resolved', '已解决', counts.resolved],
              ] as const).map(([value, label, count]) => (
                <button key={value} type="button" onClick={() => setStatusFilter(value)} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${statusFilter === value ? 'bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)]'}`}>
                  {label} <span className="opacity-70">{count}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cd-color-text-muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索反馈" className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] pl-8 pr-3 text-xs outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)]" />
              </label>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'user_feedback' | 'admin')} className="h-9 w-[100px] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-[11px] text-[var(--cd-color-text-secondary)]"><option value="all">全部来源</option><option value="user_feedback">用户反馈</option><option value="admin">内部问题</option></select>
              <select aria-label="其他状态筛选" value={statusFilter === 'wontfix' || statusFilter === 'duplicate' ? statusFilter : ''} onChange={(e) => { if (e.target.value) setStatusFilter(e.target.value as AdminFeedbackStatus); }} className="h-9 w-[92px] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-[11px] text-[var(--cd-color-text-secondary)]"><option value="">其他状态</option><option value="wontfix">暂不处理</option><option value="duplicate">重复反馈</option></select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && issues.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--cd-color-text-muted)]">正在加载…</div>
            ) : error ? (
              <div className="m-3 rounded-[var(--cd-radius-md)] bg-red-50 p-3 text-xs text-red-700">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--cd-color-text-muted)]">暂无匹配反馈</div>
            ) : filtered.map((issue) => (
              <button key={issue.id} type="button" onClick={() => void openIssue(issue)} className={`group flex w-full items-start gap-3 border-b border-[var(--cd-color-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--cd-color-surface-alt)] ${selected?.id === issue.id ? 'bg-[var(--cd-color-brand-soft)]/55' : ''}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${issue.has_unread_user_activity ? 'bg-[var(--cd-color-brand)]' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">{issue.title}</span>
                    <StatusBadge status={issue.status} />
                  </span>
                  <span className={`mt-1 block truncate text-[11px] ${issue.has_unread_user_activity ? 'font-medium text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-muted)]'}`}>
                    {issue.has_unread_user_activity ? '用户有新动态' : issue.source === 'user_feedback' ? issue.created_by : '内部问题'} · {formatTime(issue.last_activity_at ?? issue.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-[var(--cd-color-text-muted)]">
              <MessageSquare size={26} strokeWidth={1.35} />
              <p className="mt-3 text-sm">选择一条反馈查看详情</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-[18px] font-semibold leading-7 text-[var(--cd-color-text-primary)]">{selected.title}</h3>
                    <StatusBadge status={selected.status} />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--cd-color-text-muted)]">{selected.source === 'user_feedback' ? `用户反馈 · ${selected.created_by}` : `内部问题 · ${selected.created_by}`} · {CATEGORY_LABEL[selected.category]} · {MODULE_LABEL[selected.module] ?? selected.module} · {formatTime(selected.created_at)}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--cd-color-text-muted)]">状态
                      <select value={selected.status} onChange={(e) => void changeStatus(e.target.value as AdminFeedbackStatus)} className="h-8 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-[11px] font-medium text-[var(--cd-color-text-secondary)]"><option value="open">待处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="wontfix">暂不处理</option><option value="duplicate">重复反馈</option></select>
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--cd-color-text-muted)]">优先级
                      <select value={selected.priority} onChange={(e) => void changePriority(e.target.value as AdminFeedbackPriority)} className="h-8 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2 text-[11px] font-medium text-[var(--cd-color-text-secondary)]"><option value="high">紧急</option><option value="medium">普通</option><option value="low">低</option></select>
                    </label>
                  </div>
                </div>
                <button type="button" onClick={() => void removeIssue()} className="inline-flex h-8 items-center gap-1 rounded-[var(--cd-radius-sm)] px-2 text-[11px] text-[var(--cd-color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 size={12} />删除</button>
              </div>

              <section className="mt-5">
                <p className="mb-1.5 text-[11px] font-medium text-[var(--cd-color-text-muted)]">问题描述</p>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[var(--cd-color-text-primary)]">{selected.description || '无详细描述'}</p>
                {selected.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{selected.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`截图 ${index + 1}`} className="h-20 w-20 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] object-cover" /></a>)}</div> : null}
              </section>

              <section className="mt-6 border-t border-[var(--cd-color-border)] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-[12px] font-semibold text-[var(--cd-color-text-secondary)]">沟通记录</h4>
                  <span className="text-[10px] text-[var(--cd-color-text-muted)]">回复与状态变化按时间保留</span>
                </div>
                {commentsError && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-xs text-red-700">
                  <span>{commentsError}</span><button type="button" className="min-h-9 underline" onClick={() => { const selection = thread.current(); if (selection) void loadThread(selected, selection); }}>重试沟通记录</button>
                </div>}
                {commentsLoading ? (
                  <div className="py-6 text-center text-sm text-[var(--cd-color-text-muted)]">正在加载…</div>
                ) : comments.length === 0 ? (
                  !commentsError && <div className="py-6 text-center text-sm text-[var(--cd-color-text-muted)]">暂无沟通记录</div>
                ) : (
                  <div className="relative mt-4 space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-[var(--cd-color-border)]">
                    {comments.map((comment) => <TimelineItem key={comment.id} comment={comment} />)}
                  </div>
                )}
              </section>

              <section className="mt-6 border-t border-[var(--cd-color-border)] pt-5">
                <label className="block text-[12px] font-semibold text-[var(--cd-color-text-secondary)]">{selected.source === 'user_feedback' ? '回复用户' : '添加处理说明'}</label>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={2000} placeholder={selected.source === 'user_feedback' ? '输入回复，例如：问题已经定位，正在处理。' : '添加处理说明…'} className="mt-2.5 w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2.5 text-[13px] leading-5 outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)]" />

                {replyImages.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{replyImages.map((url, index) => <div key={url} className="relative"><img src={url} alt="" className="h-14 w-14 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] object-cover" /><button type="button" onClick={() => setReplyImages((current) => current.filter((_, i) => i !== index))} className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white"><X size={10} /></button></div>)}</div> : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || replyImages.length >= 3} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] disabled:opacity-50"><ImagePlus size={13} />{uploading ? '上传中…' : '添加截图'}</button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadReplyImage(file); e.target.value = ''; }} />

                  <div className="relative ml-auto flex items-center">
                    <button type="button" onClick={() => void submitReply(primaryReplyAction.status)} disabled={replyDisabled} className="inline-flex h-9 items-center gap-1.5 rounded-l-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3.5 text-xs font-medium text-white disabled:opacity-45"><Send size={13} />{replying ? '发送中…' : primaryReplyAction.label}</button>
                    <button type="button" onClick={() => setActionMenuOpen((value) => !value)} disabled={replyDisabled} className="flex h-9 w-8 items-center justify-center rounded-r-[var(--cd-radius-md)] border-l border-white/20 bg-[var(--cd-color-brand)] text-white disabled:opacity-45" aria-label="更多回复动作"><ChevronDown size={13} /></button>
                    {actionMenuOpen ? (
                      <div className="absolute bottom-11 right-0 z-10 min-w-[190px] overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] py-1 shadow-[var(--cd-shadow-popover)]">
                        <button type="button" onClick={() => void submitReply(null)} className="block w-full px-3 py-2 text-left text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]">仅回复</button>
                        <button type="button" onClick={() => void submitReply('in_progress')} className="block w-full px-3 py-2 text-left text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]">回复并开始处理</button>
                        <button type="button" onClick={() => void submitReply('resolved')} className="block w-full px-3 py-2 text-left text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]">回复并标记已解决</button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {detailError ? <p className="mt-3 rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-2 text-xs text-red-700">{detailError}</p> : null}
              </section>
            </div>
          )}
        </main>
      </div>

      <NewIssueDialog open={newDialogOpen} adminEmail={adminEmail} onClose={() => setNewDialogOpen(false)} onCreated={loadIssues} />
    </div>
  );
}
