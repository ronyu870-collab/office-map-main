'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Download,
  Edit2,
  File,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { isResearchLibraryManager } from '@/src/utils/adminAccess';
import { Button } from '@/src/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/ui/State';
import {
  classifyLibraryItem,
  filterAndSortLibraryItems,
  isDuplicateUploadName,
  isSupportedResearchFile,
  itemDisplayName,
  type LibrarySort,
  type LibraryTypeFilter,
  type ResearchLibraryItem,
} from '@/src/components/oss/libraryModel';

type UploadStatus = 'queued' | 'uploading' | 'success' | 'error' | 'duplicate' | 'unsupported';
type UploadEntry = { id: string; name: string; status: UploadStatus; progress: number; message?: string };
type Notice = { tone: 'success' | 'error' | 'warning'; text: string } | null;

const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  queued: '等待上传',
  uploading: '正在上传',
  success: '上传完成',
  error: '上传失败',
  duplicate: '名称重复',
  unsupported: '格式不支持',
};

function Modal({
  isOpen,
  onClose,
  title,
  children,
  danger = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-[#d9e0e8] bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${danger ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-[#f8fafc]'}`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${danger ? 'text-rose-800' : 'text-slate-900'}`}>
            {danger ? <AlertTriangle size={16} /> : null}{title}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

function typeLabel(item: ResearchLibraryItem) {
  const type = classifyLibraryItem(item);
  return ({ folder: '文件夹', pdf: 'PDF 文档', presentation: '演示文稿', document: '文字文档', spreadsheet: '电子表格', other: '其他文件', all: '全部' } as const)[type];
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('登录状态已失效，请重新登录');
  return { Authorization: `Bearer ${session.access_token}` };
}

function uploadToOSS(host: string, formData: FormData, onProgress: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', host);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`云端存储上传失败（状态码 ${xhr.status}）`));
    });
    xhr.addEventListener('error', () => reject(new Error('云端存储上传网络错误')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
    xhr.send(formData);
  });
}

export function OSSManager({ userEmail }: { userEmail: string }) {
  const [currentPrefix, setCurrentPrefix] = React.useState('');
  const [items, setItems] = React.useState<ResearchLibraryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');
  const [truncated, setTruncated] = React.useState(false);
  const [userRole, setUserRole] = React.useState('viewer');
  const [isImpersonating, setIsImpersonating] = React.useState(false);
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<LibraryTypeFilter>('all');
  const [sort, setSort] = React.useState<LibrarySort>('modified-desc');
  const [notice, setNotice] = React.useState<Notice>(null);
  const [uploads, setUploads] = React.useState<UploadEntry[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [operationInProgress, setOperationInProgress] = React.useState(false);

  const [showCreateFolderModal, setShowCreateFolderModal] = React.useState(false);
  const [showRenameModal, setShowRenameModal] = React.useState(false);
  const [showDeleteModal, setShowDeleteModal] = React.useState(false);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = React.useState(false);
  const [targetItem, setTargetItem] = React.useState<ResearchLibraryItem | null>(null);
  const [newName, setNewName] = React.useState('');
  const [folderName, setFolderName] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const canManage = isResearchLibraryManager(userRole) && !isImpersonating;
  const visibleItems = React.useMemo(
    () => filterAndSortLibraryItems(items, { query, type: typeFilter, sort }),
    [items, query, typeFilter, sort],
  );
  const filtersActive = Boolean(query.trim()) || typeFilter !== 'all';

  React.useEffect(() => {
    let cancelled = false;
    void getSessionFast().then((session) => {
      if (!cancelled) setUserRole(session?.role ?? 'viewer');
    });
    try {
      setIsImpersonating(Boolean(sessionStorage.getItem('__impersonation_state')));
    } catch {
      setIsImpersonating(false);
    }
    return () => { cancelled = true; };
  }, []);

  const loadReports = React.useCallback(async (prefix: string) => {
    setLoading(true);
    setLoadError('');
    setCurrentPrefix(prefix);
    setSelectedItems(new Set());
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/oss?action=get-list&prefix=${encodeURIComponent(prefix)}`, { headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') throw new Error(result.message || '资料列表加载失败');
      setItems(Array.isArray(result.data) ? result.data : []);
      setTruncated(Boolean(result.truncated));
    } catch (error) {
      setItems([]);
      setLoadError(error instanceof Error ? error.message : '资料列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadReports(''); }, [loadReports]);

  const goUp = () => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    void loadReports(parts.length ? `${parts.join('/')}/` : '');
  };

  const clearFilters = () => {
    setQuery('');
    setTypeFilter('all');
  };

  const toggleSelected = (name: string) => {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const openCreateFolder = () => {
    if (!canManage) return setNotice({ tone: 'warning', text: isImpersonating ? '用户模拟期间为只读模式。' : '只有管理员可以创建文件夹。' });
    setFolderName('');
    setShowCreateFolderModal(true);
  };

  const createFolder = async () => {
    if (!folderName.trim()) return setNotice({ tone: 'warning', text: '请输入文件夹名称。' });
    setOperationInProgress(true);
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/oss?action=create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ folder: `${currentPrefix}${folderName.trim()}/` }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') throw new Error(result.message || '创建失败');
      logAction(userEmail, 'OSS_CREATE_FOLDER', { folderName: `${currentPrefix}${folderName.trim()}/` });
      setShowCreateFolderModal(false);
      setNotice({ tone: 'success', text: '文件夹已创建。' });
      await loadReports(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '创建失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const executeUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    if (!canManage) return setNotice({ tone: 'warning', text: isImpersonating ? '用户模拟期间为只读模式。' : '只有管理员可以上传文件。' });

    const queue: UploadEntry[] = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      status: !isSupportedResearchFile(file.name) ? 'unsupported' : isDuplicateUploadName(items, file.name) ? 'duplicate' : 'queued',
      progress: 0,
      message: !isSupportedResearchFile(file.name) ? '不支持此文件类型' : isDuplicateUploadName(items, file.name) ? '当前目录已存在同名文件' : undefined,
    }));
    setUploads(queue);
    const uploadable = queue.filter((entry) => entry.status === 'queued');
    if (!uploadable.length) return;

    setUploading(true);
    try {
      const headers = await authHeaders();
      const signatureResponse = await fetch('/api/oss?action=get-signature', { headers });
      const signature = await signatureResponse.json().catch(() => ({}));
      if (!signatureResponse.ok || signature.status !== 'success') throw new Error(signature.message || '获取上传签名失败');

      for (const file of files) {
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        const entry = queue.find((candidate) => candidate.id === id);
        if (!entry || entry.status !== 'queued') continue;
        setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'uploading', progress: 1 } : item));
        try {
          const formData = new FormData();
          const fullKey = `${currentPrefix}${file.name}`;
          formData.append('key', fullKey);
          formData.append('policy', signature.policy);
          formData.append('OSSAccessKeyId', signature.accessid);
          formData.append('signature', signature.signature);
          formData.append('success_action_status', '200');
          formData.append('file', file);
          await uploadToOSS(signature.host, formData, (progress) => {
            setUploads((current) => current.map((item) => item.id === id ? { ...item, progress } : item));
          });
          logAction(userEmail, 'OSS_UPLOAD', { fileName: fullKey, size: file.size });
          setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'success', progress: 100 } : item));
        } catch (error) {
          setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'error', message: error instanceof Error ? error.message : '上传失败' } : item));
        }
      }
      setNotice({ tone: 'success', text: '上传队列已处理完成；请查看每个文件的状态。' });
      await loadReports(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '上传失败' });
      setUploads((current) => current.map((item) => item.status === 'queued' || item.status === 'uploading' ? { ...item, status: 'error', message: '上传初始化失败' } : item));
    } finally {
      setUploading(false);
    }
  };

  const openRename = (item: ResearchLibraryItem) => {
    if (!canManage) return setNotice({ tone: 'warning', text: '当前为只读模式。' });
    setTargetItem(item);
    setNewName(item.name);
    setShowRenameModal(true);
  };

  const renameItem = async () => {
    if (!targetItem || !newName.trim() || newName.trim() === targetItem.name) return;
    setOperationInProgress(true);
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/oss?action=move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ oldKey: targetItem.name, newKey: newName.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') throw new Error(result.message || '重命名失败');
      logAction(userEmail, 'OSS_MOVE', { fileName: targetItem.name, targetPath: newName.trim(), stats: result.stats });
      setShowRenameModal(false);
      setNotice({ tone: 'success', text: result.message || '名称已更新。' });
      await loadReports(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '重命名失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const openDelete = (item: ResearchLibraryItem) => {
    if (!canManage) return setNotice({ tone: 'warning', text: '当前为只读模式。' });
    setTargetItem(item);
    setShowDeleteModal(true);
  };

  const deleteOne = async () => {
    if (!targetItem) return;
    setOperationInProgress(true);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/oss?action=delete&file=${encodeURIComponent(targetItem.name)}`, { method: 'POST', headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') throw new Error(result.message || '删除失败');
      logAction(userEmail, 'OSS_DELETE', { fileName: targetItem.name, type: targetItem.type, stats: result.stats });
      setShowDeleteModal(false);
      setNotice({ tone: 'success', text: result.message || '项目已删除。' });
      await loadReports(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '删除失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedItems.size) return;
    setOperationInProgress(true);
    let success = 0;
    let failed = 0;
    try {
      const headers = await authHeaders();
      for (const name of selectedItems) {
        const response = await fetch(`/api/oss?action=delete&file=${encodeURIComponent(name)}`, { method: 'POST', headers });
        if (response.ok) success += 1; else failed += 1;
      }
      if (success) logAction(userEmail, 'OSS_BATCH_DELETE', { count: success });
      setShowBatchDeleteModal(false);
      setSelectedItems(new Set());
      setNotice({ tone: failed ? 'warning' : 'success', text: `批量删除完成：成功 ${success} 个，失败 ${failed} 个。` });
      await loadReports(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '批量删除失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const breadcrumbParts = currentPrefix.split('/').filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200/90 bg-[#f8fafc] px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <button type="button" onClick={() => void loadReports('')} className="font-semibold text-[#003e7e] transition hover:underline">研究资料库</button>
              {breadcrumbParts.map((part, index) => {
                const prefix = `${breadcrumbParts.slice(0, index + 1).join('/')}/`;
                return <React.Fragment key={prefix}><span className="text-slate-300">/</span><button type="button" onClick={() => void loadReports(prefix)} className="max-w-40 truncate transition hover:text-[#003e7e]">{part}</button></React.Fragment>;
              })}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{canManage ? '管理模式：可上传、重命名和删除' : isImpersonating ? '用户模拟期间强制只读' : '浏览模式：可搜索、打开和下载'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currentPrefix ? <Button variant="secondary" size="sm" onClick={goUp}><ArrowUp size={14} />上一级</Button> : null}
            <Button variant="secondary" size="sm" onClick={() => void loadReports(currentPrefix)} disabled={loading}><RefreshCw size={14} />刷新</Button>
            {canManage ? <>
              <Button variant="secondary" size="sm" onClick={openCreateFolder}><FolderPlus size={14} />新建文件夹</Button>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => void executeUpload(event)} />
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}><Upload size={14} />{uploading ? '上传中…' : '上传文件'}</Button>
            </> : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_160px_170px_auto]">
          <label className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 transition focus-within:border-[#003e7e] focus-within:ring-1 focus-within:ring-[#003e7e]/15">
            <Search size={14} className="text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前目录资料…" className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400" />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as LibraryTypeFilter)} className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-[#003e7e]">
            <option value="all">全部类型</option><option value="folder">文件夹</option><option value="pdf">PDF 文档</option><option value="presentation">演示文稿</option><option value="document">文字文档</option><option value="spreadsheet">电子表格</option><option value="other">其他文件</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-[#003e7e]">
            <option value="modified-desc">最近修改优先</option><option value="modified-asc">最早修改优先</option><option value="name-asc">按名称升序</option><option value="size-desc">按文件大小</option>
          </select>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <span className="text-[10px] font-medium tabular-nums text-slate-500">当前显示 {visibleItems.length} / {items.length} 项</span>
            {filtersActive ? <button type="button" onClick={clearFilters} className="text-[10px] font-semibold text-[#003e7e] hover:underline">清除筛选</button> : null}
          </div>
        </div>
      </div>

      {notice ? <div className={`mx-3 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs sm:mx-4 ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭状态"><X size={14} /></button></div> : null}
      {truncated ? <div className="mx-3 mt-3 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800 sm:mx-4">当前目录超过云端存储单次返回上限，页面仅显示本次返回结果。建议进入子目录缩小范围。</div> : null}

      {uploads.length ? <div className="mx-3 mt-3 shrink-0 rounded-md border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(23,32,51,0.03)] sm:mx-4">
        <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-700">上传状态</span><button type="button" onClick={() => setUploads([])} disabled={uploading} className="text-[10px] text-slate-500 transition hover:text-slate-800">清除</button></div>
        <div className="grid max-h-40 gap-1.5 overflow-y-auto lg:grid-cols-2">
          {uploads.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-100 bg-slate-50/50 px-2 py-1.5 text-[10px]">
            {entry.status === 'success' ? <CheckCircle2 size={13} className="shrink-0 text-emerald-600" /> : entry.status === 'error' || entry.status === 'unsupported' || entry.status === 'duplicate' ? <XCircle size={13} className="shrink-0 text-rose-500" /> : <Upload size={13} className="shrink-0 text-[#003e7e]" />}
            <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-700">{entry.name}</div><div className="text-slate-400">{entry.status === 'uploading' ? `${entry.progress}% · 正在上传` : entry.message || UPLOAD_STATUS_LABELS[entry.status]}</div></div>
            {entry.status === 'uploading' ? <div className="h-1 w-16 overflow-hidden rounded bg-slate-100"><div className="h-full bg-[#003e7e]" style={{ width: `${entry.progress}%` }} /></div> : null}
          </div>)}
        </div>
      </div> : null}

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {loading ? <LoadingState label="正在加载研究资料" /> : loadError ? <ErrorState title="资料库加载失败" description={loadError} action={<Button variant="secondary" size="sm" onClick={() => void loadReports(currentPrefix)}>重试</Button>} /> : visibleItems.length === 0 ? <EmptyState title={filtersActive ? '没有匹配的资料' : '当前目录为空'} description={filtersActive ? '请调整搜索词或文件类型筛选。' : '此目录暂时没有可浏览的研究资料。'} action={filtersActive ? <Button variant="secondary" size="sm" onClick={clearFilters}>清除筛选</Button> : undefined} /> : <>
          <div className="hidden overflow-hidden rounded-md border border-slate-200 bg-white md:block">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 text-[10px] font-semibold text-slate-500"><tr>{canManage ? <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="全选" checked={visibleItems.length > 0 && visibleItems.every((item) => selectedItems.has(item.name))} onChange={() => setSelectedItems((current) => visibleItems.every((item) => current.has(item.name)) ? new Set() : new Set(visibleItems.map((item) => item.name)))} /></th> : null}<th className="px-3 py-2.5">名称</th><th className="w-28 px-3 py-2.5">类型</th><th className="w-28 px-3 py-2.5">大小</th><th className="w-32 px-3 py-2.5">修改时间</th><th className="w-52 px-3 py-2.5 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{visibleItems.map((item) => <tr key={item.name} className="transition-colors hover:bg-slate-50/80">{canManage ? <td className="px-3 py-2.5"><input type="checkbox" aria-label={`选择 ${itemDisplayName(item)}`} checked={selectedItems.has(item.name)} onChange={() => toggleSelected(item.name)} /></td> : null}<td className="min-w-0 px-3 py-2.5"><button type="button" onClick={() => item.type === 'folder' ? void loadReports(item.name) : item.url && window.open(item.url, '_blank', 'noopener,noreferrer')} className="flex max-w-full items-center gap-2 font-medium text-slate-800 transition hover:text-[#003e7e]"><span className="shrink-0 text-slate-400">{item.type === 'folder' ? <Folder size={15} /> : <File size={15} />}</span><span className="truncate" title={itemDisplayName(item)}>{itemDisplayName(item)}</span></button></td><td className="px-3 py-2.5 text-slate-500">{typeLabel(item)}</td><td className="px-3 py-2.5 tabular-nums text-slate-500">{item.type === 'folder' ? '—' : item.size || '—'}</td><td className="px-3 py-2.5 text-slate-500">{formatDate(item.lastModified)}</td><td className="px-3 py-2.5 text-right"><div className="flex justify-end gap-1">{item.type === 'file' ? <Button variant="ghost" size="sm" onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}><Download size={13} />打开或下载</Button> : null}{canManage && item.type === 'file' ? <Button variant="ghost" size="sm" onClick={() => openRename(item)}><Edit2 size={13} />重命名</Button> : null}{canManage ? <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => openDelete(item)}><Trash2 size={13} />删除</Button> : null}</div></td></tr>)}</tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white md:hidden">{visibleItems.map((item) => <div key={item.name} className="p-3"><div className="flex items-start gap-2"><span className="mt-0.5 shrink-0 text-slate-400">{item.type === 'folder' ? <Folder size={16} /> : <File size={16} />}</span><button type="button" onClick={() => item.type === 'folder' ? void loadReports(item.name) : item.url && window.open(item.url, '_blank', 'noopener,noreferrer')} className="min-w-0 flex-1 text-left"><div className="break-words text-xs font-semibold text-slate-800">{itemDisplayName(item)}</div><div className="mt-1 text-[10px] text-slate-400">{typeLabel(item)} · {item.type === 'folder' ? '文件夹' : item.size || '—'} · {formatDate(item.lastModified)}</div></button>{canManage ? <input type="checkbox" aria-label={`选择 ${itemDisplayName(item)}`} checked={selectedItems.has(item.name)} onChange={() => toggleSelected(item.name)} /> : null}</div><div className="mt-2 flex flex-wrap justify-end gap-1">{item.type === 'file' ? <Button variant="secondary" size="sm" onClick={() => item.url && window.open(item.url, '_blank', 'noopener,noreferrer')}><Download size={13} />打开或下载</Button> : null}{canManage && item.type === 'file' ? <Button variant="secondary" size="sm" onClick={() => openRename(item)}><Edit2 size={13} />重命名</Button> : null}{canManage ? <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => openDelete(item)}><Trash2 size={13} />删除</Button> : null}</div></div>)}</div>
        </>}
      </div>

      {canManage && selectedItems.size ? <div className="shrink-0 border-t border-slate-200 bg-[#f8fafc] px-3 py-2 sm:px-4"><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-600">已选择 {selectedItems.size} 项</span><Button variant="danger" size="sm" onClick={() => setShowBatchDeleteModal(true)}><Trash2 size={13} />删除选中</Button></div></div> : null}

      <Modal isOpen={showCreateFolderModal} onClose={() => !operationInProgress && setShowCreateFolderModal(false)} title="新建文件夹"><label className="block text-xs font-medium text-slate-700">文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createFolder()} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-2.5 text-xs outline-none transition focus:border-[#003e7e]" /></label><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowCreateFolderModal(false)} disabled={operationInProgress}>取消</Button><Button size="sm" onClick={() => void createFolder()} disabled={operationInProgress || !folderName.trim()}>{operationInProgress ? '创建中…' : '创建'}</Button></div></Modal>

      <Modal isOpen={showRenameModal} onClose={() => !operationInProgress && setShowRenameModal(false)} title="重命名或移动"><label className="block text-xs font-medium text-slate-700">目标路径<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void renameItem()} className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-xs outline-none transition focus:border-[#003e7e]" /></label><p className="mt-2 text-[10px] text-slate-500">修改完整云端存储路径可移动文件；服务端移动逻辑保持不变。</p><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowRenameModal(false)} disabled={operationInProgress}>取消</Button><Button size="sm" onClick={() => void renameItem()} disabled={operationInProgress || !newName.trim() || newName.trim() === targetItem?.name}>{operationInProgress ? '处理中…' : '确认'}</Button></div></Modal>

      <Modal isOpen={showDeleteModal} onClose={() => !operationInProgress && setShowDeleteModal(false)} title="确认删除" danger><div className="rounded-md border border-rose-200 bg-rose-50 p-3"><p className="text-xs text-rose-900">确定删除以下{targetItem?.type === 'folder' ? '文件夹' : '文件'}？</p><p className="mt-2 break-all font-mono text-xs font-semibold text-rose-700">{targetItem ? itemDisplayName(targetItem) : ''}</p>{targetItem?.type === 'folder' ? <p className="mt-2 text-[10px] font-medium text-rose-700">文件夹删除会递归删除其中所有对象，无法撤销。</p> : null}</div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowDeleteModal(false)} disabled={operationInProgress}>取消</Button><Button variant="danger" size="sm" onClick={() => void deleteOne()} disabled={operationInProgress}><Trash2 size={13} />{operationInProgress ? '删除中…' : '确认删除'}</Button></div></Modal>

      <Modal isOpen={showBatchDeleteModal} onClose={() => !operationInProgress && setShowBatchDeleteModal(false)} title="批量删除确认" danger><div className="rounded-md border border-rose-200 bg-rose-50 p-3"><p className="text-xs font-semibold text-rose-900">确定删除选中的 {selectedItems.size} 项？</p><p className="mt-2 text-[10px] text-rose-700">其中若包含文件夹，将沿用现有递归删除逻辑。此操作无法撤销。</p></div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowBatchDeleteModal(false)} disabled={operationInProgress}>取消</Button><Button variant="danger" size="sm" onClick={() => void deleteSelected()} disabled={operationInProgress}><Trash2 size={13} />{operationInProgress ? '删除中…' : '确认删除'}</Button></div></Modal>
    </div>
  );
}
