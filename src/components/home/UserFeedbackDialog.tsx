'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ImagePlus, Loader2, MessageSquareText, Send, Trash2 } from 'lucide-react';

import { Button, Dialog } from '@/src/components/ui';
import {
  addFeedbackComment,
  createFeedback,
  getFeedbackComments,
  getMyFeedback,
  uploadFeedbackImage,
  type FeedbackCategory,
  type UserFeedbackComment,
  type UserFeedbackIssue,
} from '@/src/services/feedbackApi';
import { logAction } from '@/src/utils/audit';

type UserFeedbackDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userName: string;
};

type PendingImage = {
  file: File;
  previewUrl: string;
};

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string; help: string }> = [
  { value: 'bug', label: '系统 Bug', help: '功能异常、按钮失效、显示错误' },
  { value: 'feature', label: '功能需求', help: '希望新增或改进的功能' },
  { value: 'data', label: '数据问题', help: '数据缺失、错误或更新问题' },
  { value: 'other', label: '其他建议', help: '其他体验或流程建议' },
];

const MODULE_OPTIONS = [
  { value: 'general', label: '首页 / 其他' },
  { value: 'map', label: '办公楼地图' },
  { value: 'update', label: '季度数据填报' },
  { value: 'lease', label: '租赁成交填报' },
  { value: 'oss', label: '研究资料库' },
];

const STATUS_LABEL: Record<UserFeedbackIssue['status'], string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  wontfix: '暂不处理',
  duplicate: '重复反馈',
};

const STATUS_CLASS: Record<UserFeedbackIssue['status'], string> = {
  open: 'bg-red-50 text-red-700 ring-red-100',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-100',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  wontfix: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  duplicate: 'bg-purple-50 text-purple-700 ring-purple-100',
};

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function UserFeedbackDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  userName,
}: UserFeedbackDialogProps) {
  const pathname = usePathname();
  const [tab, setTab] = React.useState<'submit' | 'mine'>('submit');
  const [category, setCategory] = React.useState<FeedbackCategory>('bug');
  const [module, setModule] = React.useState('general');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<UserFeedbackIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = React.useState(false);
  const [issuesError, setIssuesError] = React.useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = React.useState<UserFeedbackIssue | null>(null);
  const [comments, setComments] = React.useState<UserFeedbackComment[]>([]);
  const [commentsLoading, setCommentsLoading] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');
  const [commentSending, setCommentSending] = React.useState(false);
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingImagesRef = React.useRef<PendingImage[]>([]);

  const releaseImages = React.useCallback((images: PendingImage[]) => {
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  React.useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  React.useEffect(() => () => releaseImages(pendingImagesRef.current), [releaseImages]);

  const loadIssues = React.useCallback(async () => {
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      setIssues(await getMyFeedback(userEmail));
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : '反馈记录加载失败');
    } finally {
      setIssuesLoading(false);
    }
  }, [userEmail]);

  React.useEffect(() => {
    if (open && tab === 'mine' && !selectedIssue) void loadIssues();
  }, [loadIssues, open, selectedIssue, tab]);

  const loadComments = React.useCallback(async (issue: UserFeedbackIssue) => {
    setCommentsLoading(true);
    setCommentError(null);
    try {
      setComments(await getFeedbackComments(issue.id));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '回复加载失败');
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const openIssue = (issue: UserFeedbackIssue) => {
    setSelectedIssue(issue);
    setComments([]);
    setCommentText('');
    void loadComments(issue);
  };

  const addFiles = React.useCallback((files: File[]) => {
    const available = Math.max(0, 3 - pendingImages.length);
    if (available === 0) return;
    const images = files.filter((file) => file.type.startsWith('image/')).slice(0, available);
    if (images.length === 0) return;
    setPendingImages((current) => [
      ...current,
      ...images.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }, [pendingImages.length]);

  const removePendingImage = (index: number) => {
    setPendingImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const resetForm = () => {
    setCategory('bug');
    setModule('general');
    setTitle('');
    setDescription('');
    setSubmitError(null);
    setPendingImages((current) => {
      releaseImages(current);
      return [];
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (!cleanTitle || !cleanDescription || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const images = await Promise.all(
        pendingImages.map(({ file }) => uploadFeedbackImage(file, userId)),
      );
      const issue = await createFeedback({
        title: cleanTitle,
        description: cleanDescription,
        category,
        module,
        images,
        userEmail,
        context: {
          pathname: pathname || '/',
          browser: typeof navigator === 'undefined' ? '' : navigator.userAgent,
          viewport: typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
          submitted_at: new Date().toISOString(),
        },
      });

      logAction(userEmail, 'SUBMIT_FEEDBACK', {
        feedback_id: issue.id,
        category,
        module,
        title: cleanTitle.slice(0, 80),
      });

      resetForm();
      setIssues((current) => [issue, ...current.filter((item) => item.id !== issue.id)]);
      setSelectedIssue(null);
      setTab('mine');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendComment = async () => {
    if (!selectedIssue || !commentText.trim() || commentSending) return;
    setCommentSending(true);
    setCommentError(null);
    try {
      const comment = await addFeedbackComment(selectedIssue.id, commentText.trim(), userEmail);
      setComments((current) => [...current, comment]);
      setCommentText('');
      logAction(userEmail, 'COMMENT_FEEDBACK', { feedback_id: selectedIssue.id });
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '发送失败，请稍后重试');
    } finally {
      setCommentSending(false);
    }
  };

  const switchTab = (nextTab: 'submit' | 'mine') => {
    setTab(nextTab);
    setSelectedIssue(null);
    setCommentError(null);
  };

  const titleNode = selectedIssue ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="rounded-[var(--cd-radius-sm)] p-1 text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)]"
        onClick={() => setSelectedIssue(null)}
        aria-label="返回我的反馈"
      >
        <ArrowLeft size={16} />
      </button>
      <span className="truncate">反馈详情</span>
    </div>
  ) : '问题与建议';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={titleNode}
      description={selectedIssue ? undefined : '反馈系统问题、数据问题或功能需求，管理员会在后台统一处理。'}
      size="lg"
      dismissible={!submitting && !commentSending}
    >
      {selectedIssue ? (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">{selectedIssue.title}</h3>
                <div className="mt-1 text-xs text-[var(--cd-color-text-muted)]">{formatTime(selectedIssue.created_at)}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ring-1 ${STATUS_CLASS[selectedIssue.status]}`}>
                {STATUS_LABEL[selectedIssue.status]}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-[var(--cd-color-text-secondary)]">
              {selectedIssue.description}
            </p>
            {selectedIssue.images.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedIssue.images.map((image, index) => (
                  <a key={image} href={image} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt={`反馈截图 ${index + 1}`} className="h-24 w-24 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] object-cover" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="border-t border-[var(--cd-color-border)] pt-4">
            <h4 className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">处理沟通</h4>
            {commentsLoading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-[var(--cd-color-text-muted)]">
                <Loader2 size={14} className="animate-spin" /> 正在加载回复…
              </div>
            ) : comments.length === 0 ? (
              <div className="py-6 text-xs text-[var(--cd-color-text-muted)]">暂无回复。管理员处理后会在这里反馈。</div>
            ) : (
              <div className="mt-3 space-y-2.5">
                {comments.map((comment) => (
                  <div key={comment.id} className={`rounded-[var(--cd-radius-md)] border px-3 py-2.5 ${comment.is_admin ? 'border-[var(--cd-color-brand)]/15 bg-[var(--cd-color-brand-soft)]/45' : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]'}`}>
                    <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--cd-color-text-muted)]">
                      <span className="font-medium text-[var(--cd-color-text-secondary)]">{comment.is_admin ? '管理员' : userName || '我'}</span>
                      <span>{formatTime(comment.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--cd-color-text-primary)]">{comment.content}</p>
                    {comment.images.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {comment.images.map((image, index) => (
                          <a key={image} href={image} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image} alt={`回复截图 ${index + 1}`} className="h-20 w-20 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] object-cover" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <textarea
                value={commentText}
                onChange={(event) => {
                  setCommentText(event.target.value);
                  if (commentError) setCommentError(null);
                }}
                rows={2}
                maxLength={2000}
                placeholder="补充说明…"
                className="min-h-[64px] min-w-0 flex-1 resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 text-[13px] text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10"
              />
              <Button
                onClick={() => void handleSendComment()}
                disabled={commentSending || !commentText.trim()}
                className="self-end"
                aria-label="发送补充说明"
              >
                {commentSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                发送
              </Button>
            </div>
            {commentError ? <p role="alert" className="mt-2 text-xs text-[var(--cd-color-danger)]">{commentError}</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-1 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] p-1">
            <button
              type="button"
              onClick={() => switchTab('submit')}
              className={`flex-1 rounded-[var(--cd-radius-sm)] px-3 py-2 text-[13px] font-medium transition-colors ${tab === 'submit' ? 'bg-[var(--cd-color-surface)] text-[var(--cd-color-text-primary)] shadow-sm' : 'text-[var(--cd-color-text-muted)] hover:text-[var(--cd-color-text-secondary)]'}`}
            >
              提交反馈
            </button>
            <button
              type="button"
              onClick={() => switchTab('mine')}
              className={`flex-1 rounded-[var(--cd-radius-sm)] px-3 py-2 text-[13px] font-medium transition-colors ${tab === 'mine' ? 'bg-[var(--cd-color-surface)] text-[var(--cd-color-text-primary)] shadow-sm' : 'text-[var(--cd-color-text-muted)] hover:text-[var(--cd-color-text-secondary)]'}`}
            >
              我的反馈
            </button>
          </div>

          {tab === 'submit' ? (
            <form onSubmit={handleSubmit} className="space-y-4" onPaste={(event) => {
              const files = Array.from(event.clipboardData.files ?? []);
              if (files.some((file) => file.type.startsWith('image/'))) {
                event.preventDefault();
                addFiles(files);
              }
            }}>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">反馈类型</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CATEGORY_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setCategory(item.value)}
                      className={`rounded-[var(--cd-radius-md)] border px-3 py-2 text-left transition-colors ${category === item.value ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)]' : 'border-[var(--cd-color-border)] hover:bg-[var(--cd-color-surface-alt)]'}`}
                    >
                      <div className="text-[13px] font-medium text-[var(--cd-color-text-primary)]">{item.label}</div>
                      <div className="mt-0.5 hidden text-[11px] leading-4 text-[var(--cd-color-text-muted)] sm:block">{item.help}</div>
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
                  className="h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[13px] text-[var(--cd-color-text-primary)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10"
                >
                  {MODULE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="feedback-title" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">标题</label>
                <input
                  id="feedback-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (submitError) setSubmitError(null);
                  }}
                  maxLength={120}
                  placeholder="用一句话概括问题或建议"
                  className="h-10 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[13px] text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10"
                  required
                />
              </div>

              <div>
                <label htmlFor="feedback-description" className="mb-1.5 block text-xs font-medium text-[var(--cd-color-text-secondary)]">详细描述</label>
                <textarea
                  id="feedback-description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    if (submitError) setSubmitError(null);
                  }}
                  rows={5}
                  maxLength={4000}
                  placeholder="请说明发生了什么、你希望怎样改进；如果是 Bug，可以写一下操作步骤。"
                  className="w-full resize-y rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 text-[13px] leading-5 text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/10"
                  required
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-[var(--cd-color-text-secondary)]">截图（可选，最多 3 张）</label>
                  <span className="text-[11px] text-[var(--cd-color-text-muted)]">支持粘贴截图</span>
                </div>
                {pendingImages.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingImages.map((image, index) => (
                      <div key={image.previewUrl} className="group relative h-20 w-20 overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.previewUrl} alt={`待上传截图 ${index + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePendingImage(index)}
                          className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-90 hover:opacity-100"
                          aria-label={`移除截图 ${index + 1}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={pendingImages.length >= 3}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface-alt)] px-3 text-xs text-[var(--cd-color-text-secondary)] transition-colors hover:border-[var(--cd-color-brand)] hover:text-[var(--cd-color-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ImagePlus size={16} />
                  {pendingImages.length >= 3 ? '已达到 3 张上限' : '选择截图或直接粘贴图片'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
              </div>

              {submitError ? <p role="alert" className="text-xs text-[var(--cd-color-danger)]">{submitError}</p> : null}

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={submitting || !title.trim() || !description.trim()}>
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareText size={14} />}
                  {submitting ? '正在提交…' : '提交反馈'}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              {issuesLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-[var(--cd-color-text-muted)]">
                  <Loader2 size={15} className="animate-spin" /> 正在加载我的反馈…
                </div>
              ) : issuesError ? (
                <div className="py-10 text-center">
                  <p className="text-xs text-[var(--cd-color-danger)]">{issuesError}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadIssues()}>重试</Button>
                </div>
              ) : issues.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--cd-color-text-muted)]">你还没有提交过反馈。</div>
              ) : (
                <div className="overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
                  {issues.map((issue) => (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => openIssue(issue)}
                      className="flex w-full items-center gap-3 border-b border-[var(--cd-color-border)] px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--cd-color-surface-alt)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">{issue.title}</div>
                        <div className="mt-1 text-[11px] text-[var(--cd-color-text-muted)]">{formatTime(issue.created_at)}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ring-1 ${STATUS_CLASS[issue.status]}`}>
                        {STATUS_LABEL[issue.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
