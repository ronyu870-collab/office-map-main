'use client';

import * as React from 'react';
import {
  getIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  uploadIssueImage,
  getComments,
  addComment,
  deleteComment,
  type AdminIssue,
  type AdminIssueComment,
} from '@/src/services/adminApi';
import { logAction } from '@/src/utils/audit';
import { Button, Dialog, Input } from '@/src/components/ui';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  open:        { label: '待处理', color: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  in_progress: { label: '处理中', color: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  resolved:    { label: '已解决', color: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  wontfix:     { label: '不修复', color: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20', dot: 'bg-zinc-400' },
  duplicate:   { label: '重复', color: 'bg-purple-50 text-purple-700 ring-purple-600/20', dot: 'bg-purple-500' },
} as const;

const PRIORITY_CONFIG = {
  high:   { label: '紧急', color: 'bg-red-50 text-red-700 ring-red-600/20' },
  medium: { label: '普通', color: 'bg-zinc-50 text-zinc-700 ring-zinc-600/20' },
  low:    { label: '低', color: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
} as const;

const CATEGORY_CONFIG = {
  bug:     { label: '缺陷' },
  feature: { label: '需求' },
  data:    { label: '数据' },
  other:   { label: '其他' },
} as const;

const MODULE_OPTIONS = [
  { value: 'general', label: '通用' },
  { value: 'map', label: '地图系统' },
  { value: 'update', label: '季度填报' },
  { value: 'bi', label: 'BI 看板' },
  { value: 'lease', label: '租赁成交' },
  { value: 'oss', label: '云端资料库' },
  { value: 'admin', label: '管理后台' },
];

type IssueFormData = {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: 'bug' | 'feature' | 'data' | 'other';
  module: string;
  images: string[];
};

const EMPTY_FORM: IssueFormData = { title: '', description: '', priority: 'medium', category: 'bug', module: 'general', images: [] };

// ─── 图片压缩（客户端） ──────────────────────────────────────────────────────

async function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<File> {
  if (file.size < 500 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─── 图片上传区 ────────────────────────────────────────────────────────────────

function ImageUploadArea({
  images,
  onChange,
}: {
  images: string[];
  onChange: (urls: string[]) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [dragOver, setDragOver] = React.useState(false);

  const uploadFile = React.useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      setUploading(true);
      setProgress(0);
      try {
        const url = await uploadIssueImage(file, setProgress);
        onChange([...images, url]);
      } catch (err) {
        alert(err instanceof Error ? err.message : '图片上传失败');
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [images, onChange]
  );

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) uploadFile(file);
          return;
        }
      }
    },
    [uploadFile]
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      files.forEach(f => uploadFile(f));
    },
    [uploadFile]
  );

  const removeImage = (idx: number) => {
    const next = [...images];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div onPaste={handlePaste}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {images.map((url, idx) => (
            <div key={idx} className="relative group">
              <img src={url} alt={`截图 ${idx + 1}`} className="h-20 w-20 rounded-lg border border-zinc-200 object-cover" />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors ${
          dragOver ? 'border-[#003e7e] bg-blue-50' : 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50'
        }`}
      >
        {uploading ? (
          <div className="w-full max-w-xs">
            <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#003e7e]" />
              上传中...
            </div>
            <div className="h-1.5 rounded-full bg-zinc-200 overflow-hidden">
              <div className="h-full rounded-full bg-[#003e7e] transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <svg className="h-6 w-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-zinc-500">粘贴截图 (<span className="font-mono text-xs">Ctrl+V</span>) 或拖拽/点击上传</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) Array.from(files).forEach(f => uploadFile(f));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ─── 图片灯箱 ──────────────────────────────────────────────────────────────────

function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onNavigate(Math.max(0, index - 1));
      if (e.key === 'ArrowRight') onNavigate(Math.min(images.length - 1, index + 1));
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [index, images.length, onClose, onNavigate]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <img src={images[index]} alt="预览" className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
        {images.length > 1 && (
          <>
            <button
              onClick={() => onNavigate(Math.max(0, index - 1))}
              disabled={index === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 text-zinc-800 flex items-center justify-center disabled:opacity-30 hover:bg-white"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button
              onClick={() => onNavigate(Math.min(images.length - 1, index + 1))}
              disabled={index === images.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 text-zinc-800 flex items-center justify-center disabled:opacity-30 hover:bg-white"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {index + 1} / {images.length}
            </div>
          </>
        )}
        <button onClick={onClose} className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-white text-zinc-800 flex items-center justify-center shadow-lg hover:bg-zinc-100">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

// ─── 评论组件 ──────────────────────────────────────────────────────────────────

function CommentSection({
  issueId,
  adminEmail,
}: {
  issueId: string;
  adminEmail: string;
}) {
  const [comments, setComments] = React.useState<AdminIssueComment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState('');
  const [commentImages, setCommentImages] = React.useState<string[]>([]);
  const [sending, setSending] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const fetchComments = React.useCallback(async () => {
    try {
      const data = await getComments(issueId);
      setComments(data);
    } catch (e) {
      console.error('加载评论失败:', e);
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  React.useEffect(() => { fetchComments(); }, [fetchComments]);

  const handleSubmit = async () => {
    if (!newComment.trim() && commentImages.length === 0) return;
    setSending(true);
    try {
      await addComment(issueId, newComment.trim(), commentImages, adminEmail, true);
      setNewComment('');
      setCommentImages([]);
      await fetchComments();
    } catch (e) {
      alert(e instanceof Error ? e.message : '评论发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleUploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const url = await uploadIssueImage(file);
      setCommentImages(prev => [...prev, url]);
    } catch (e) {
      alert(e instanceof Error ? e.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-t border-zinc-100 pt-4">
      <h4 className="text-sm font-semibold text-zinc-700 mb-3">评论 ({comments.length})</h4>

      {/* 评论列表 */}
      {loading ? (
        <div className="py-4 text-center text-sm text-zinc-400">加载中...</div>
      ) : comments.length === 0 ? (
        <div className="py-4 text-center text-sm text-zinc-400">暂无评论</div>
      ) : (
        <div className="space-y-3 mb-4 max-h-60 overflow-auto">
          {comments.map((c) => (
            <div key={c.id} className={`rounded-lg p-3 ${c.is_admin ? 'bg-blue-50 border border-blue-100' : 'bg-zinc-50 border border-zinc-100'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold ${c.is_admin ? 'text-blue-700' : 'text-zinc-600'}`}>
                  {c.created_by}
                </span>
                <span className="text-xs text-zinc-400">
                  {new Date(c.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  onClick={() => { if (confirm('删除此评论？')) { deleteComment(c.id).then(fetchComments); } }}
                  className="ml-auto text-xs text-zinc-400 hover:text-red-500"
                >
                  删除
                </button>
              </div>
              {c.content && <p className="text-sm text-zinc-700 whitespace-pre-wrap">{c.content}</p>}
              {c.images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {c.images.map((url, i) => (
                    <img key={i} src={url} alt="" className="h-16 w-16 rounded border border-zinc-200 object-cover" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 发送评论 */}
      <div className="space-y-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="添加评论..."
          rows={2}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e] resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        {commentImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {commentImages.map((url, i) => (
              <div key={i} className="relative group">
                <img src={url} alt="" className="h-14 w-14 rounded border border-zinc-200 object-cover" />
                <button
                  onClick={() => setCommentImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-zinc-500 hover:text-[#003e7e] flex items-center gap-1"
            >
              {uploading ? (
                <><div className="h-3 w-3 animate-spin rounded-full border border-zinc-300 border-t-[#003e7e]" /> 上传中</>
              ) : (
                <><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                图片</>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadImage(f); e.target.value = ''; }} />
            <span className="text-[11px] text-zinc-400">Ctrl+Enter 发送</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={sending || (!newComment.trim() && commentImages.length === 0)}
            className="rounded-lg bg-[#003e7e] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#002a5c] disabled:opacity-50"
          >
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 新建/编辑弹窗 ─────────────────────────────────────────────────────────────

function IssueFormModal({
  open,
  initialData,
  onSubmit,
  onClose,
}: {
  open: boolean;
  initialData?: IssueFormData;
  onSubmit: (data: IssueFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = React.useState<IssueFormData>(initialData ?? EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (open) { setForm(initialData ?? EMPTY_FORM); setDirty(false); }
  }, [open, initialData]);

  const handleChange = (patch: Partial<IssueFormData>) => {
    setForm(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const requestClose = () => {
    if (dirty && !confirm('有未保存的内容，确定关闭？')) return;
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
      title={initialData ? '编辑问题' : '新建问题'}
      size="md"
      dismissible={!submitting}
      footer={<><Button variant="secondary" onClick={requestClose} disabled={submitting}>取消</Button><Button onClick={() => { void handleSubmit(); }} disabled={submitting || !form.title.trim()}>{submitting ? '提交中…' : '提交'}</Button></>}
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">问题标题 *</label>
            <Input type="text" value={form.title} onChange={(e) => handleChange({ title: e.target.value })} placeholder="简要描述问题" required />
          </div>

          {/* 分类 + 模块 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">分类</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(CATEGORY_CONFIG) as (keyof typeof CATEGORY_CONFIG)[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleChange({ category: c })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                      form.category === c ? 'bg-[#003e7e] text-white ring-[#003e7e]' : 'bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    {CATEGORY_CONFIG[c].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">关联模块</label>
              <select
                value={form.module}
                onChange={(e) => handleChange({ module: e.target.value })}
                className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
              >
                {MODULE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* 优先级 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">优先级</label>
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleChange({ priority: p })}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
                    form.priority === p ? PRIORITY_CONFIG[p].color : 'bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">详细描述</label>
            <textarea
              value={form.description}
              onChange={(e) => handleChange({ description: e.target.value })}
              placeholder="描述问题的具体表现、复现步骤等"
              rows={4}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e] resize-none"
            />
          </div>

          {/* 截图 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">截图</label>
            <ImageUploadArea images={form.images} onChange={(urls) => handleChange({ images: urls })} />
          </div>
        </form>
    </Dialog>
  );
}

// ─── 详情弹窗 ──────────────────────────────────────────────────────────────────

function IssueDetailModal({
  issue,
  adminEmail,
  onClose,
  onStatusChange,
  onDelete,
  onRefresh,
}: {
  issue: AdminIssue | null;
  adminEmail: string;
  onClose: () => void;
  onStatusChange: (id: string, status: AdminIssue['status'], note?: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const [imgPreviewIdx, setImgPreviewIdx] = React.useState<number | null>(null);
  const [statusNote, setStatusNote] = React.useState('');
  const [showStatusMenu, setShowStatusMenu] = React.useState(false);

  if (!issue) return null;

  const status = STATUS_CONFIG[issue.status];
  const priority = PRIORITY_CONFIG[issue.category === 'bug' ? 'high' : 'medium'];
  const cat = CATEGORY_CONFIG[issue.category] ?? CATEGORY_CONFIG.other;
  const modLabel = MODULE_OPTIONS.find(m => m.value === issue.module)?.label ?? issue.module;

  // 所有可切换的状态
  const allStatuses = Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[];
  const availableStatuses = allStatuses.filter(s => s !== issue.status);

  const handleStatusSwitch = (newStatus: AdminIssue['status']) => {
    onStatusChange(issue.id, newStatus, statusNote.trim() || undefined);
    setStatusNote('');
    setShowStatusMenu(false);
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => { if (!open) onClose(); }}
        title={issue.title}
        description={(
          <span className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${status.color}`}>{status.label}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_CONFIG[issue.priority].color}`}>{PRIORITY_CONFIG[issue.priority].label}</span>
              <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600">{cat.label}</span>
              <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600">{modLabel}</span>
          </span>
        )}
        size="md"
        footer={<div className="flex w-full items-center justify-between"><Button variant="danger" onClick={() => { if (confirm('确定删除此问题？')) { onDelete(issue.id); onClose(); } }}>删除</Button><Button variant="secondary" onClick={onClose}>关闭</Button></div>}
      >
          <div className="space-y-4">

            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span>提交人：{issue.created_by}</span>
              <span>{new Date(issue.created_at).toLocaleString('zh-CN')}</span>
              {issue.resolved_at && <span>解决于：{new Date(issue.resolved_at).toLocaleString('zh-CN')}</span>}
              {issue.resolved_by && <span>解决人：{issue.resolved_by}</span>}
            </div>

            {issue.description && (
              <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700 whitespace-pre-wrap">{issue.description}</div>
            )}

            {issue.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {issue.images.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt={`截图 ${idx + 1}`}
                    className="h-24 w-24 rounded-lg border border-zinc-200 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setImgPreviewIdx(idx)}
                  />
                ))}
              </div>
            )}

            {/* 状态变更区 */}
            <div className="border-t border-zinc-100 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-zinc-700">变更状态</span>
                <div className="flex flex-wrap gap-1.5">
                  {availableStatuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusSwitch(s)}
                      className={`rounded px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors hover:opacity-80 ${STATUS_CONFIG[s].color}`}
                    >
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="变更备注（可选）"
                className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
              />
            </div>

            {/* 评论区 */}
            <CommentSection issueId={issue.id} adminEmail={adminEmail} />
          </div>
      </Dialog>

      {/* 图片灯箱 */}
      {imgPreviewIdx !== null && issue.images.length > 0 && (
        <ImageLightbox
          images={issue.images}
          index={imgPreviewIdx}
          onClose={() => setImgPreviewIdx(null)}
          onNavigate={setImgPreviewIdx}
        />
      )}
    </>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

interface IssueManagerProps {
  adminEmail: string;
}

export function IssueManager({ adminEmail }: IssueManagerProps) {
  const [issues, setIssues] = React.useState<AdminIssue[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [moduleFilter, setModuleFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [sortByPriority, setSortByPriority] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [selectedIssue, setSelectedIssue] = React.useState<AdminIssue | null>(null);

  const fetchIssues = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await getIssues({
        statusFilter,
        categoryFilter,
        moduleFilter,
        prioritySort: sortByPriority,
        search: search.trim() || undefined,
      });
      setIssues(data);
    } catch (err) {
      console.error('加载问题列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, moduleFilter, sortByPriority, search]);

  React.useEffect(() => { fetchIssues(); }, [fetchIssues]);

  const handleCreate = async (form: IssueFormData) => {
    await createIssue(form.title, form.description, form.priority, form.category, form.module, form.images, adminEmail);
    logAction(adminEmail, 'ADMIN_DATA_OPERATION', { operation: 'INSERT', table: 'admin_issues', table_label: '需求反馈', title: form.title });
    await fetchIssues();
  };

  const handleStatusChange = async (id: string, status: AdminIssue['status'], note?: string) => {
    const updates: any = { status };
    if (status === 'resolved') updates.resolved_by = adminEmail;
    if (status === 'open') updates.reopened_at = new Date().toISOString();
    await updateIssue(id, updates);
    logAction(adminEmail, 'ADMIN_DATA_OPERATION', { operation: 'UPDATE', table: 'admin_issues', table_label: '需求反馈', target_id: id, new_status: status, note });
    await fetchIssues();
    // 刷新详情弹窗中的数据
    setSelectedIssue(prev => prev && prev.id === id ? { ...prev, status, resolved_by: status === 'resolved' ? adminEmail : prev.resolved_by } : prev);
  };

  const handleDelete = async (id: string) => {
    await deleteIssue(id);
    logAction(adminEmail, 'ADMIN_DATA_OPERATION', { operation: 'DELETE', table: 'admin_issues', table_label: '需求反馈', target_id: id });
    await fetchIssues();
  };

  const openCount = issues.filter((i) => i.status === 'open').length;
  const inProgressCount = issues.filter((i) => i.status === 'in_progress').length;

  // 用于详情弹窗刷新列表
  const refreshAndKeepOpen = async () => {
    await fetchIssues();
    if (selectedIssue) {
      const updated = issues.find(i => i.id === selectedIssue.id);
      if (updated) setSelectedIssue(updated);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* 顶部栏 */}
      <div className="shrink-0 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">需求反馈</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              记录系统中需要修复的问题
              {openCount > 0 && <span className="ml-2 text-red-600 font-medium">{openCount} 个待处理</span>}
              {inProgressCount > 0 && <span className="ml-2 text-amber-600 font-medium">{inProgressCount} 个处理中</span>}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-[#003e7e] px-4 py-2 text-sm font-medium text-white hover:bg-[#002a5c]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            新建问题
          </button>
        </div>

        {/* 搜索 + 筛选栏 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 搜索 */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题或描述..."
              className="w-full rounded-lg border border-zinc-300 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
            />
          </div>

          {/* 状态 */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]">
            <option value="all">全部状态</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {/* 分类 */}
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]">
            <option value="all">全部分类</option>
            {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {/* 模块 */}
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#003e7e]">
            <option value="all">全部模块</option>
            {MODULE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          {/* 排序 */}
          <button
            onClick={() => setSortByPriority(!sortByPriority)}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              sortByPriority ? 'border-[#003e7e] bg-blue-50 text-[#003e7e]' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
            优先级
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]" />
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <svg className="h-12 w-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p className="text-sm">{search ? '没有匹配的问题' : '暂无问题'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">标题</th>
                <th className="w-16 px-4 py-3 text-center text-xs font-semibold text-zinc-500">分类</th>
                <th className="w-20 px-4 py-3 text-center text-xs font-semibold text-zinc-500">状态</th>
                <th className="w-20 px-4 py-3 text-center text-xs font-semibold text-zinc-500">优先级</th>
                <th className="w-20 px-4 py-3 text-center text-xs font-semibold text-zinc-500">模块</th>
                <th className="w-28 px-4 py-3 text-left text-xs font-semibold text-zinc-500">提交人</th>
                <th className="w-16 px-4 py-3 text-center text-xs font-semibold text-zinc-500">截图</th>
                <th className="w-36 px-4 py-3 text-left text-xs font-semibold text-zinc-500">时间</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const s = STATUS_CONFIG[issue.status];
                const cat = CATEGORY_CONFIG[issue.category] ?? CATEGORY_CONFIG.other;
                const modLabel = MODULE_OPTIONS.find(m => m.value === issue.module)?.label ?? issue.module;
                const isResolved = issue.status === 'resolved' || issue.status === 'wontfix' || issue.status === 'duplicate';
                return (
                  <tr
                    key={issue.id}
                    onClick={() => setSelectedIssue(issue)}
                    className={`border-b border-zinc-100 cursor-pointer transition-colors ${isResolved ? 'opacity-60 hover:opacity-80' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${isResolved ? 'text-zinc-500 line-through' : 'text-zinc-900'}`}>{issue.title}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs">{cat.label}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_CONFIG[issue.priority].color}`}>{PRIORITY_CONFIG[issue.priority].label}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-zinc-500">{modLabel}</td>
                    <td className="px-4 py-3 text-sm text-zinc-600">{issue.created_by}</td>
                    <td className="px-4 py-3 text-center text-sm text-zinc-500">{issue.images.length > 0 ? issue.images.length : '-'}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {new Date(issue.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 弹窗 */}
      <IssueFormModal open={showCreate} onSubmit={handleCreate} onClose={() => setShowCreate(false)} />
      <IssueDetailModal
        issue={selectedIssue}
        adminEmail={adminEmail}
        onClose={() => setSelectedIssue(null)}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
        onRefresh={refreshAndKeepOpen}
      />
    </div>
  );
}
