'use client';

import * as React from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ImagePlus,
  MessageSquareMore,
  RefreshCw,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';

import {
  addFeedbackComment,
  createFeedback,
  getFeedbackComments,
  getMyFeedback,
  markFeedbackRead,
  reopenFeedback,
  uploadFeedbackImage,
  type FeedbackCategory,
  type FeedbackComment,
  type FeedbackIssue,
  type FeedbackStatus,
} from '@/src/services/feedbackApi';
import { logAction } from '@/src/utils/audit';

type FeedbackTab = 'submit' | 'mine';

interface FeedbackPanelProps {
  userId: string;
  userEmail: string;
  userName: string;
}

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: '系统 Bug' },
  { value: 'feature', label: '功能需求' },
  { value: 'data', label: '数据问题' },
  { value: 'other', label: '其他建议' },
];

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '系统 Bug',
  feature: '功能需求',
  data: '数据问题',
  other: '其他建议',
};

const MODULE_OPTIONS = [
  { value: 'general', label: '首页 / 其他' },
  { value: 'map', label: '地图系统' },
  { value: 'update', label: '季度数据填报' },
  { value: 'lease', label: '租赁成交' },
  { value: 'oss', label: '研究资料库' },
];

const MODULE_LABEL = Object.fromEntries(MODULE_OPTIONS.map((item) => [item.value, item.label]));

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  wontfix: '暂不处理',
  duplicate: '重复反馈',
};

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  open: 'bg-red-50 text-red-700 ring-red-100',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-100',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  wontfix: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  duplicate: 'bg-purple-50 text-purple-700 ring-purple-100',
};

const MAX_IMAGES = 3;
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

function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function LocalImagePreview({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = React.useState('');

  React.useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return (
    <div className="group relative h-16 w-16 overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]">
      {url ? <img src={url} alt={file.name} className="h-full w-full object-cover" /> : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white disabled:opacity-40"
        aria-label={`移除 ${file.name}`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function ImagePicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState('');
  const [dragging, setDragging] = React.useState(false);

  const addFiles = React.useCallback((incoming: File[]) => {
    const images = incoming.filter((file) => file.type.startsWith('image/'));
    if (images.length !== incoming.length) {
      setError('仅支持图片文件。');
      return;
    }
    if (images.some((file) => file.size > 8 * 1024 * 1024)) {
      setError('单张图片不能超过 8MB。');
      return;
    }
    if (files.length + images.length > MAX_IMAGES) {
      setError(`最多上传 ${MAX_IMAGES} 张截图。`);
      return;
    }
    setError('');
    onChange([...files, ...images]);
  }, [files, onChange]);

  return (
    <div
      onPaste={(event) => {
        if (disabled) return;
        const pasted = Array.from(event.clipboardData?.files ?? []);
        if (!pasted.length) return;
        event.preventDefault();
        addFiles(pasted);
      }}
    >
      {files.length > 0 ? (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <LocalImagePreview
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              disabled={disabled}
              onRemove={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled || files.length >= MAX_IMAGES}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { if (!disabled) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--cd-radius-md)] border border-dashed px-3 py-2.5 text-xs transition-colors disabled:opacity-50 ${dragging ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-muted)] hover:border-[var(--cd-color-brand)] hover:text-[var(--cd-color-brand)]'}`}
      >
        <ImagePlus size={15} strokeWidth={1.6} />
        <span>{files.length >= MAX_IMAGES ? '已达到 3 张上限' : '粘贴、拖拽或点击添加截图（最多 3 张）'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      {error ? <p className="mt-1.5 text-xs text-[var(--cd-color-danger)]">{error}</p> : null}
    </div>
  );
}

export function FeedbackPanel({ userId, userEmail, userName }: FeedbackPanelProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<FeedbackTab>('submit');
  const [category, setCategory] = React.useState<FeedbackCategory>('bug');
  const [module, setModule] = React.useState('general');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');

  const [issues, setIssues] = React.useState<FeedbackIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = React.useState(false);
  const [issuesLoaded, setIssuesLoaded] = React.useState(false);
  const [issuesError, setIssuesError] = React.useState('');
  const [selectedIssue, setSelectedIssue] = React.useState<FeedbackIssue | null>(null);
  const [comments, setComments] = React.useState<FeedbackComment[]>([]);
  const [commentsLoading, setCommentsLoading] = React.useState(false);
  const [reply, setReply] = React.useState('');
  const [replyFiles, setReplyFiles] = React.useState<File[]>([]);
  const [replying, setReplying] = React.useState(false);
  const [reopenMessage, setReopenMessage] = React.useState('');
  const [reopening, setReopening] = React.useState(false);
  const [detailError, setDetailError] = React.useState('');

  const unreadCount = React.useMemo(
    () => issues.filter((issue) => issue.has_unread_admin_activity).length,
    [issues],
  );

  const loadIssues = React.useCallback(async () => {
    setIssuesLoading(true);
    setIssuesError('');
    try {
      const data = await getMyFeedback(userEmail, userId);
      setIssues(data);
      setIssuesLoaded(true);
      return data;
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : '反馈列表暂时无法加载。');
      return [];
    } finally {
      setIssuesLoading(false);
    }
  }, [userEmail, userId]);

  React.useEffect(() => { void loadIssues(); }, [loadIssues]);

  const closeDialog = React.useCallback(() => {
    setOpen(false);
    setSelectedIssue(null);
    setDetailError('');
    setReply('');
    setReplyFiles([]);
    setReopenMessage('');
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDialog, open]);

  const uploadFiles = async (selectedFiles: File[]) => {
    const urls: string[] = [];
    for (const file of selectedFiles) urls.push(await uploadFeedbackImage(file, userId));
    return urls;
  };

  const openIssue = async (issue: FeedbackIssue) => {
    setSelectedIssue({ ...issue, has_unread_admin_activity: false, last_read_at: new Date().toISOString() });
    setIssues((current) => current.map((item) => item.id === issue.id ? { ...item, has_unread_admin_activity: false, last_read_at: new Date().toISOString() } : item));
    setComments([]);
    setCommentsLoading(true);
    setDetailError('');
    try {
      await markFeedbackRead(issue.id);
      setComments(await getFeedbackComments(issue.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '沟通记录暂时无法加载。');
    } finally {
      setCommentsLoading(false);
    }
  };

  const refreshSelected = async (issueId: string) => {
    const nextIssues = await loadIssues();
    const nextIssue = nextIssues.find((item) => item.id === issueId) ?? null;
    if (nextIssue) {
      await markFeedbackRead(issueId).catch(() => undefined);
      setSelectedIssue({ ...nextIssue, has_unread_admin_activity: false, last_read_at: new Date().toISOString() });
      setIssues((current) => current.map((item) => item.id === issueId ? { ...item, has_unread_admin_activity: false, last_read_at: new Date().toISOString() } : item));
      setComments(await getFeedbackComments(issueId));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const images = await uploadFiles(files);
      const issue = await createFeedback({
        title,
        description,
        category,
        module,
        images,
        createdBy: userEmail,
        context: {
          pathname: window.location.pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          user_agent: navigator.userAgent.slice(0, 300),
        },
      });
      logAction(userEmail, 'FEEDBACK_SUBMITTED', { issue_id: issue.id, category, module });
      setTitle('');
      setDescription('');
      setFiles([]);
      setCategory('bug');
      setModule('general');
      await loadIssues();
      setTab('mine');
      await openIssue(issue);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，内容已保留，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedIssue || replying || (!reply.trim() && replyFiles.length === 0)) return;
    setReplying(true);
    setDetailError('');
    try {
      const images = await uploadFiles(replyFiles);
      await addFeedbackComment(selectedIssue.id, reply, images, userEmail);
      logAction(userEmail, 'FEEDBACK_USER_REPLIED', { issue_id: selectedIssue.id, has_images: images.length > 0 });
      setReply('');
      setReplyFiles([]);
      await refreshSelected(selectedIssue.id);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '补充说明发送失败，请重试。');
    } finally {
      setReplying(false);
    }
  };

  const handleReopen = async () => {
    if (!selectedIssue || reopening) return;
    setReopening(true);
    setDetailError('');
    try {
      await reopenFeedback(selectedIssue.id, reopenMessage);
      logAction(userEmail, 'FEEDBACK_REOPENED', { issue_id: selectedIssue.id });
      setReopenMessage('');
      await refreshSelected(selectedIssue.id);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '重新打开反馈失败，请重试。');
    } finally {
      setReopening(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTab(unreadCount > 0 ? 'mine' : 'submit');
          setOpen(true);
          if (!issuesLoaded) void loadIssues();
        }}
        className="group mt-3 flex min-h-[52px] w-full items-center gap-3 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
        aria-haspopup="dialog"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-brand)]">
          <MessageSquareMore size={15} strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium text-[var(--cd-color-text-primary)]">问题与建议</span>
        {unreadCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--cd-color-brand)] px-1.5 text-[10px] font-semibold text-white" aria-label={`${unreadCount} 条新动态`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
        <ArrowRight size={14} strokeWidth={1.55} className="shrink-0 text-[var(--cd-color-text-muted)] transition-colors group-hover:text-[var(--cd-color-brand)]" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[var(--cd-z-modal)] flex items-end justify-center bg-[var(--cd-color-overlay)] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-dialog-title"
            className="flex h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-popover)] sm:h-auto sm:max-h-[86dvh] sm:rounded-[var(--cd-radius-lg)]"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--cd-color-border)] px-4 py-3.5 sm:px-5">
              <div>
                <h2 id="feedback-dialog-title" className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">问题与建议</h2>
                <p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">提交后可在这里查看处理进度和管理员回复</p>
              </div>
              <button ref={closeRef} type="button" onClick={closeDialog} className="flex h-9 w-9 items-center justify-center rounded-[var(--cd-radius-md)] text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)]" aria-label="关闭反馈窗口">
                <X size={17} />
              </button>
            </div>

            <div className="flex shrink-0 border-b border-[var(--cd-color-border)] px-4 sm:px-5" role="tablist">
              {([['submit', '提交反馈'], ['mine', unreadCount > 0 ? `我的反馈 · ${unreadCount}` : '我的反馈']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => { setTab(value); setSelectedIssue(null); if (value === 'mine') void loadIssues(); }}
                  className={`relative min-h-11 px-1 text-[13px] font-medium ${tab === value ? 'text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-muted)] hover:text-[var(--cd-color-text-primary)]'} ${value === 'mine' ? 'ml-6' : ''}`}
                >
                  {label}
                  {tab === value ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--cd-color-brand)]" /> : null}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              {tab === 'submit' ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-[var(--cd-color-text-secondary)]">反馈类型</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {CATEGORY_OPTIONS.map((option) => (
                        <button key={option.value} type="button" disabled={submitting} onClick={() => setCategory(option.value)} className={`min-h-10 rounded-[var(--cd-radius-md)] border px-2 text-xs font-medium ${category === option.value ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'border-[var(--cd-color-border)] text-[var(--cd-color-text-secondary)]'}`}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="feedback-module" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">相关模块</label>
                    <select id="feedback-module" value={module} onChange={(event) => setModule(event.target.value)} disabled={submitting} className="min-h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[13px] outline-none focus:border-[var(--cd-color-brand)]">
                      {MODULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="feedback-title" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">标题</label>
                    <input id="feedback-title" value={title} maxLength={120} disabled={submitting} onChange={(event) => setTitle(event.target.value)} placeholder="一句话说明问题或需求" className="min-h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 text-[13px] outline-none focus:border-[var(--cd-color-brand)]" />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between"><label htmlFor="feedback-description" className="text-xs font-medium text-[var(--cd-color-text-secondary)]">详细描述</label><span className="text-[11px] text-[var(--cd-color-text-muted)]">{description.length}/4000</span></div>
                    <textarea id="feedback-description" value={description} maxLength={4000} rows={6} disabled={submitting} onChange={(event) => setDescription(event.target.value)} placeholder="请说明发生了什么、你希望怎样改进；如果是 Bug，可写一下操作步骤。" className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 py-2.5 text-[13px] leading-5 outline-none focus:border-[var(--cd-color-brand)]" />
                  </div>
                  <div><label className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">截图（可选）</label><ImagePicker files={files} onChange={setFiles} disabled={submitting} /></div>
                  {submitError ? <p className="rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-2 text-xs text-red-700">{submitError}</p> : null}
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--cd-color-border)] pt-4">
                    <p className="text-[11px] text-[var(--cd-color-text-muted)]">提交人：{userName}</p>
                    <button type="submit" disabled={submitting || !title.trim() || !description.trim()} className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-4 text-[13px] font-medium text-white disabled:opacity-45"><Send size={14} />{submitting ? '提交中…' : '提交反馈'}</button>
                  </div>
                </form>
              ) : selectedIssue ? (
                <div>
                  <button type="button" onClick={() => { setSelectedIssue(null); setComments([]); }} className="mb-4 inline-flex min-h-9 items-center gap-1 rounded-[var(--cd-radius-sm)] px-1.5 text-xs text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)]"><ChevronLeft size={14} />返回我的反馈</button>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h3 className="break-words text-[15px] font-semibold text-[var(--cd-color-text-primary)]">{selectedIssue.title}</h3><p className="mt-1 text-xs text-[var(--cd-color-text-muted)]">{CATEGORY_LABEL[selectedIssue.category]} · {MODULE_LABEL[selectedIssue.module] ?? selectedIssue.module} · {formatTime(selectedIssue.created_at)}</p></div>
                    <StatusBadge status={selectedIssue.status} />
                  </div>
                  <div className="mt-4 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] px-3.5 py-3 text-[13px] leading-6 whitespace-pre-wrap break-words">{selectedIssue.description}</div>
                  {selectedIssue.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedIssue.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`反馈截图 ${index + 1}`} className="h-20 w-20 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] object-cover" /></a>)}</div> : null}

                  <div className="mt-6 border-t border-[var(--cd-color-border)] pt-4">
                    <h4 className="text-xs font-semibold text-[var(--cd-color-text-secondary)]">沟通记录</h4>
                    {commentsLoading ? <p className="py-5 text-center text-xs text-[var(--cd-color-text-muted)]">正在加载…</p> : comments.length === 0 ? <p className="py-5 text-center text-xs text-[var(--cd-color-text-muted)]">暂无沟通记录</p> : (
                      <div className="mt-3 space-y-2.5">
                        {comments.map((comment) => {
                          if (comment.kind === 'status_change') {
                            const from = comment.metadata?.from as FeedbackStatus | undefined;
                            const to = comment.metadata?.to as FeedbackStatus | undefined;
                            return <div key={comment.id} className="flex items-center gap-2 py-1 text-[11px] text-[var(--cd-color-text-muted)]"><span className="h-px flex-1 bg-[var(--cd-color-border)]" /><span>{comment.is_admin ? '管理员' : '你'}将状态从「{from ? STATUS_LABEL[from] : '未知'}」更新为「{to ? STATUS_LABEL[to] : '未知'}」 · {formatTime(comment.created_at)}</span><span className="h-px flex-1 bg-[var(--cd-color-border)]" /></div>;
                          }
                          return (
                            <div key={comment.id} className={`rounded-[var(--cd-radius-md)] border px-3 py-2.5 ${comment.is_admin ? 'border-[var(--cd-color-brand)]/20 bg-[var(--cd-color-brand-soft)]/50' : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]'}`}>
                              <div className="flex items-center justify-between gap-3 text-[11px]"><span className="font-medium text-[var(--cd-color-text-secondary)]">{comment.is_admin ? '管理员' : '我'}</span><span className="text-[var(--cd-color-text-muted)]">{formatTime(comment.created_at)}</span></div>
                              {comment.content ? <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5">{comment.content}</p> : null}
                              {comment.images?.length ? <div className="mt-2 flex flex-wrap gap-2">{comment.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`回复截图 ${index + 1}`} className="h-16 w-16 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] object-cover" /></a>)}</div> : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedIssue.status === 'resolved' ? (
                    <div className="mt-5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-3.5">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--cd-color-text-primary)]"><RotateCcw size={15} />问题仍未解决？</div>
                      <p className="mt-1 text-xs text-[var(--cd-color-text-muted)]">可以重新打开这条反馈，不需要重复提交。</p>
                      <textarea value={reopenMessage} onChange={(event) => setReopenMessage(event.target.value)} rows={2} maxLength={1000} placeholder="可选：说明目前仍存在的问题" className="mt-3 w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--cd-color-brand)]" />
                      <div className="mt-2 flex justify-end"><button type="button" onClick={() => void handleReopen()} disabled={reopening} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-brand)] px-3 text-xs font-medium text-[var(--cd-color-brand)] disabled:opacity-50"><RotateCcw size={13} />{reopening ? '重新打开中…' : '问题仍未解决'}</button></div>
                    </div>
                  ) : (
                    <form onSubmit={handleReply} className="mt-5 space-y-2.5">
                      <textarea value={reply} maxLength={2000} rows={3} disabled={replying} onChange={(event) => setReply(event.target.value)} placeholder="补充说明或回复管理员…" className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] px-3 py-2.5 text-[13px] leading-5 outline-none focus:border-[var(--cd-color-brand)]" />
                      <ImagePicker files={replyFiles} onChange={setReplyFiles} disabled={replying} />
                      <div className="flex justify-end"><button type="submit" disabled={replying || (!reply.trim() && replyFiles.length === 0)} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3.5 text-xs font-medium text-white disabled:opacity-45"><Send size={13} />{replying ? '发送中…' : '补充说明'}</button></div>
                    </form>
                  )}
                  {detailError ? <p className="mt-3 rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-2 text-xs text-red-700">{detailError}</p> : null}
                </div>
              ) : (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs text-[var(--cd-color-text-muted)]">仅显示你自己提交的反馈。</p><button type="button" disabled={issuesLoading} onClick={() => void loadIssues()} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-2 text-xs text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)]"><RefreshCw size={13} className={issuesLoading ? 'animate-spin' : ''} />刷新</button></div>
                  {issuesLoading && !issuesLoaded ? <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" />)}</div> : issuesError ? <p className="rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-3 text-center text-xs text-red-700">{issuesError}</p> : issues.length === 0 ? <div className="rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border)] px-4 py-9 text-center"><MessageSquareMore size={22} className="mx-auto text-[var(--cd-color-text-muted)]" /><p className="mt-2 text-xs text-[var(--cd-color-text-muted)]">还没有提交过反馈</p></div> : (
                    <div className="overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
                      {issues.map((issue) => (
                        <button key={issue.id} type="button" onClick={() => void openIssue(issue)} className="flex w-full items-center gap-3 border-b border-[var(--cd-color-border)] px-3.5 py-3 text-left last:border-b-0 hover:bg-[var(--cd-color-surface-alt)]">
                          {issue.has_unread_admin_activity ? <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cd-color-brand)]" aria-label="有新回复" /> : <span className="h-2 w-2 shrink-0" />}
                          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">{issue.title}</span><span className="mt-1 block text-[11px] text-[var(--cd-color-text-muted)]">{issue.has_unread_admin_activity ? '管理员有新回复 · ' : ''}{formatTime(issue.last_activity_at ?? issue.created_at)}</span></span>
                          <StatusBadge status={issue.status} />
                          <ArrowRight size={13} className="shrink-0 text-[var(--cd-color-text-muted)]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
