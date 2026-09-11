'use client';

import * as React from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ImagePlus,
  MessageSquareWarning,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';

import {
  addFeedbackComment,
  createFeedback,
  getFeedbackComments,
  getMyFeedback,
  uploadFeedbackImage,
  type FeedbackCategory,
  type FeedbackComment,
  type FeedbackIssue,
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

const STATUS_CONFIG: Record<FeedbackIssue['status'], { label: string; className: string }> = {
  open: { label: '待处理', className: 'bg-red-50 text-red-700 ring-red-100' },
  in_progress: { label: '处理中', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  resolved: { label: '已解决', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  wontfix: { label: '暂不处理', className: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
  duplicate: { label: '重复反馈', className: 'bg-purple-50 text-purple-700 ring-purple-100' },
};

const MAX_IMAGES = 3;
const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
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
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white opacity-90 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`移除 ${file.name}`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function ImagePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
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
      {files.length ? (
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
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--cd-radius-md)] border border-dashed px-3 py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20 disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-muted)] hover:border-[var(--cd-color-brand)] hover:text-[var(--cd-color-brand)]'}`}
      >
        <ImagePlus size={15} strokeWidth={1.6} aria-hidden="true" />
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
      {error ? <p className="mt-1.5 text-xs text-[var(--cd-color-danger)]" role="alert">{error}</p> : null}
    </div>
  );
}

function StatusBadge({ issue }: { issue: FeedbackIssue }) {
  const config = STATUS_CONFIG[issue.status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${config.className}`}>{config.label}</span>;
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
  const [successMessage, setSuccessMessage] = React.useState('');

  const [issues, setIssues] = React.useState<FeedbackIssue[]>([]);
  const [mineLoaded, setMineLoaded] = React.useState(false);
  const [mineLoading, setMineLoading] = React.useState(false);
  const [mineError, setMineError] = React.useState('');
  const [selectedIssue, setSelectedIssue] = React.useState<FeedbackIssue | null>(null);
  const [comments, setComments] = React.useState<FeedbackComment[]>([]);
  const [commentsLoading, setCommentsLoading] = React.useState(false);
  const [commentError, setCommentError] = React.useState('');
  const [reply, setReply] = React.useState('');
  const [replyFiles, setReplyFiles] = React.useState<File[]>([]);
  const [replying, setReplying] = React.useState(false);

  const closeDialog = React.useCallback(() => {
    setOpen(false);
    setSuccessMessage('');
    setSubmitError('');
    setSelectedIssue(null);
    setCommentError('');
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

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDialog, open]);

  const loadMine = React.useCallback(async () => {
    setMineLoading(true);
    setMineError('');
    try {
      const data = await getMyFeedback(userEmail);
      setIssues(data);
      setMineLoaded(true);
    } catch (error) {
      setMineError(error instanceof Error ? error.message : '反馈列表暂时无法加载。');
    } finally {
      setMineLoading(false);
    }
  }, [userEmail]);

  React.useEffect(() => {
    if (open && tab === 'mine' && !mineLoaded && !mineLoading) void loadMine();
  }, [loadMine, mineLoaded, mineLoading, open, tab]);

  const openIssue = async (issue: FeedbackIssue) => {
    setSelectedIssue(issue);
    setComments([]);
    setCommentError('');
    setCommentsLoading(true);
    try {
      setComments(await getFeedbackComments(issue.id));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '回复暂时无法加载。');
    } finally {
      setCommentsLoading(false);
    }
  };

  const uploadFiles = async (selectedFiles: File[]) => {
    const urls: string[] = [];
    for (const file of selectedFiles) urls.push(await uploadFeedbackImage(file, userId));
    return urls;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (!cleanTitle || !cleanDescription || submitting) return;

    setSubmitting(true);
    setSubmitError('');
    setSuccessMessage('');
    try {
      const images = await uploadFiles(files);
      const issue = await createFeedback({
        title: cleanTitle,
        description: cleanDescription,
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
      logAction(userEmail, 'SUBMIT_FEEDBACK', {
        feedback_id: issue.id,
        title: cleanTitle.slice(0, 80),
        category,
        module,
      });
      setTitle('');
      setDescription('');
      setFiles([]);
      setCategory('bug');
      setModule('general');
      setSuccessMessage('反馈已提交，管理员可以在需求反馈后台看到。');
      setMineLoaded(false);
      setSelectedIssue(null);
      setTab('mine');
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
    setCommentError('');
    try {
      const images = await uploadFiles(replyFiles);
      const comment = await addFeedbackComment(selectedIssue.id, reply, images, userEmail);
      setComments((current) => [...current, comment]);
      setReply('');
      setReplyFiles([]);
      logAction(userEmail, 'POST_FEEDBACK_COMMENT', {
        feedback_id: selectedIssue.id,
        has_images: images.length > 0,
      });
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '补充说明发送失败，请重试。');
    } finally {
      setReplying(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTab('submit');
          setOpen(true);
        }}
        className="group mt-3 flex min-h-[64px] w-full items-center gap-3 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
        aria-haspopup="dialog"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
          <MessageSquareWarning size={16} strokeWidth={1.55} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-[var(--cd-color-text-primary)]">问题与建议</span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--cd-color-text-muted)]">反馈 Bug、数据问题或功能需求</span>
        </span>
        <ArrowRight size={14} strokeWidth={1.55} className="shrink-0 text-[var(--cd-color-text-muted)] transition-colors group-hover:text-[var(--cd-color-brand)]" aria-hidden="true" />
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
                <p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">反馈会直接进入管理员的需求反馈后台</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--cd-radius-md)] text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                aria-label="关闭反馈窗口"
              >
                <X size={17} strokeWidth={1.6} />
              </button>
            </div>

            <div className="flex shrink-0 border-b border-[var(--cd-color-border)] px-4 sm:px-5" role="tablist" aria-label="反馈操作">
              {([
                ['submit', '提交反馈'],
                ['mine', '我的反馈'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => {
                    setTab(value);
                    setSelectedIssue(null);
                    setSuccessMessage('');
                  }}
                  className={`relative min-h-11 px-1 text-[13px] font-medium ${tab === value ? 'text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-muted)] hover:text-[var(--cd-color-text-primary)]'} ${value === 'mine' ? 'ml-6' : ''}`}
                >
                  {label}
                  {tab === value ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--cd-color-brand)]" /> : null}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
              {tab === 'submit' ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-[var(--cd-color-text-secondary)]">反馈类型</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {CATEGORY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={submitting}
                          onClick={() => setCategory(option.value)}
                          className={`min-h-10 rounded-[var(--cd-radius-md)] border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20 ${category === option.value ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="feedback-module" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">相关模块</label>
                    <select
                      id="feedback-module"
                      value={module}
                      onChange={(event) => setModule(event.target.value)}
                      disabled={submitting}
                      className="min-h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[13px] text-[var(--cd-color-text-primary)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10 disabled:opacity-60"
                    >
                      {MODULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="feedback-title" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">标题</label>
                    <input
                      id="feedback-title"
                      value={title}
                      maxLength={120}
                      disabled={submitting}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        if (submitError) setSubmitError('');
                      }}
                      placeholder="一句话说明问题或需求"
                      className="min-h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[13px] text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10 disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <label htmlFor="feedback-description" className="text-xs font-medium text-[var(--cd-color-text-secondary)]">详细描述</label>
                      <span className="text-[11px] tabular-nums text-[var(--cd-color-text-muted)]">{description.length}/4000</span>
                    </div>
                    <textarea
                      id="feedback-description"
                      value={description}
                      maxLength={4000}
                      rows={6}
                      disabled={submitting}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        if (submitError) setSubmitError('');
                      }}
                      placeholder="请说明发生了什么、你希望怎样改进；如果是 Bug，可写一下操作步骤。"
                      className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2.5 text-[13px] leading-5 text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10 disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">截图（可选）</label>
                    <ImagePicker files={files} onChange={setFiles} disabled={submitting} />
                  </div>

                  {submitError ? <p role="alert" className="rounded-[var(--cd-radius-md)] bg-red-50 px-3 py-2 text-xs text-red-700">{submitError}</p> : null}

                  <div className="flex items-center justify-between gap-3 border-t border-[var(--cd-color-border)] pt-4">
                    <p className="text-[11px] leading-4 text-[var(--cd-color-text-muted)]">提交人：{userName}</p>
                    <button
                      type="submit"
                      disabled={submitting || !title.trim() || !description.trim()}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-4 text-[13px] font-medium text-white hover:bg-[var(--cd-color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Send size={14} strokeWidth={1.6} />
                      {submitting ? '提交中…' : '提交反馈'}
                    </button>
                  </div>
                </form>
              ) : selectedIssue ? (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIssue(null);
                      setComments([]);
                      setCommentError('');
                    }}
                    className="mb-4 inline-flex min-h-9 items-center gap-1 rounded-[var(--cd-radius-sm)] px-1.5 text-xs text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                  >
                    <ChevronLeft size={14} />
                    返回我的反馈
                  </button>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-[15px] font-semibold text-[var(--cd-color-text-primary)]">{selectedIssue.title}</h3>
                      <p className="mt-1 text-xs text-[var(--cd-color-text-muted)]">{CATEGORY_LABEL[selectedIssue.category]} · {MODULE_LABEL[selectedIssue.module] ?? selectedIssue.module} · {formatTime(selectedIssue.created_at)}</p>
                    </div>
                    <StatusBadge issue={selectedIssue} />
                  </div>

                  <div className="mt-4 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] px-3.5 py-3 text-[13px] leading-6 text-[var(--cd-color-text-primary)] whitespace-pre-wrap break-words">
                    {selectedIssue.description}
                  </div>

                  {selectedIssue.images?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedIssue.images.map((url, index) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20">
                          <img src={url} alt={`反馈截图 ${index + 1}`} className="h-20 w-20 object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-6 border-t border-[var(--cd-color-border)] pt-4">
                    <h4 className="text-xs font-semibold text-[var(--cd-color-text-secondary)]">沟通记录</h4>
                    {commentsLoading ? (
                      <p className="py-5 text-center text-xs text-[var(--cd-color-text-muted)]">正在加载…</p>
                    ) : comments.length === 0 ? (
                      <p className="py-5 text-center text-xs text-[var(--cd-color-text-muted)]">暂无回复</p>
                    ) : (
                      <div className="mt-3 space-y-2.5">
                        {comments.map((comment) => (
                          <div key={comment.id} className={`rounded-[var(--cd-radius-md)] border px-3 py-2.5 ${comment.is_admin ? 'border-[var(--cd-color-brand)]/20 bg-[var(--cd-color-brand-soft)]/50' : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]'}`}>
                            <div className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="font-medium text-[var(--cd-color-text-secondary)]">{comment.is_admin ? '管理员' : '我'}</span>
                              <span className="text-[var(--cd-color-text-muted)]">{formatTime(comment.created_at)}</span>
                            </div>
                            {comment.content ? <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--cd-color-text-primary)]">{comment.content}</p> : null}
                            {comment.images?.length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {comment.images.map((url, index) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer">
                                    <img src={url} alt={`回复截图 ${index + 1}`} className="h-16 w-16 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] object-cover" />
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}

                    <form onSubmit={handleReply} className="mt-4 space-y-2.5">
                      <textarea
                        value={reply}
                        maxLength={2000}
                        rows={3}
                        disabled={replying}
                        onChange={(event) => {
                          setReply(event.target.value);
                          if (commentError) setCommentError('');
                        }}
                        placeholder="补充说明或回复管理员…"
                        className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2.5 text-[13px] leading-5 text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10 disabled:opacity-60"
                      />
                      <ImagePicker files={replyFiles} onChange={setReplyFiles} disabled={replying} />
                      {commentError ? <p role="alert" className="text-xs text-[var(--cd-color-danger)]">{commentError}</p> : null}
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={replying || (!reply.trim() && replyFiles.length === 0)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3.5 text-xs font-medium text-white hover:bg-[var(--cd-color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Send size={13} />
                          {replying ? '发送中…' : '补充说明'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              ) : (
                <div>
                  {successMessage ? <p className="mb-3 rounded-[var(--cd-radius-md)] bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p> : null}

                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--cd-color-text-muted)]">仅显示你自己提交的反馈。</p>
                    <button
                      type="button"
                      disabled={mineLoading}
                      onClick={() => void loadMine()}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-2 text-xs text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20 disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={mineLoading ? 'animate-spin' : ''} />
                      刷新
                    </button>
                  </div>

                  {mineLoading && !mineLoaded ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" />)}
                    </div>
                  ) : mineError ? (
                    <div className="rounded-[var(--cd-radius-md)] border border-red-100 bg-red-50 px-3 py-4 text-center">
                      <p className="text-xs text-red-700">{mineError}</p>
                      <button type="button" onClick={() => void loadMine()} className="mt-2 text-xs font-medium text-[var(--cd-color-brand)]">重试</button>
                    </div>
                  ) : issues.length === 0 ? (
                    <div className="rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border)] px-4 py-9 text-center">
                      <MessageSquareWarning size={22} strokeWidth={1.4} className="mx-auto text-[var(--cd-color-text-muted)]" />
                      <p className="mt-2 text-xs text-[var(--cd-color-text-muted)]">还没有提交过反馈</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
                      {issues.map((issue) => (
                        <button
                          key={issue.id}
                          type="button"
                          onClick={() => void openIssue(issue)}
                          className="flex w-full items-center gap-3 border-b border-[var(--cd-color-border)] px-3.5 py-3 text-left last:border-b-0 hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cd-color-brand)]/20"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">{issue.title}</span>
                            <span className="mt-1 block text-[11px] text-[var(--cd-color-text-muted)]">{CATEGORY_LABEL[issue.category]} · {MODULE_LABEL[issue.module] ?? issue.module} · {formatTime(issue.created_at)}</span>
                          </span>
                          <StatusBadge issue={issue} />
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
