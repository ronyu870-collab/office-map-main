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

import { getImpersonationRequestHeaders } from '@/src/services/impersonationHeaders';
import { supabase } from '@/src/services/supabaseClient';
import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { logAction } from '@/src/utils/audit';
import { isResearchLibraryManager } from '@/src/utils/adminAccess';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';
import { Input } from '@/src/components/ui/Input';
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
import { beginResearchDirectoryRead, clearResearchDirectories, invalidateResearchDirectories, researchDirectoryParent, subscribeResearchDirectoryChanges } from '@/src/components/oss/directorySnapshot';

type UploadStatus = 'queued' | 'uploading' | 'success' | 'error' | 'duplicate' | 'unsupported';
type UploadEntry = { id: string; name: string; status: UploadStatus; progress: number; message?: string };
type Notice = { tone: 'success' | 'error' | 'warning'; text: string } | null;
type DirectoryRequest = {
  controller: AbortController;
  prefix: string;
  rows: ResearchLibraryItem[];
  marker: string | null;
  seenMarkers: Set<string>;
  paging: boolean;
  read: ReturnType<typeof beginResearchDirectoryRead> | null;
};

const MAX_SIMULTANEOUS_UPLOADS = 2;

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
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={<span className={danger ? 'flex items-center gap-2 text-rose-700' : undefined}>{danger ? <AlertTriangle aria-hidden="true" size={16} /> : null}{title}</span>}
      size="sm"
    >
      {children}
    </Dialog>
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
  return { Authorization: `Bearer ${session.access_token}`, ...getImpersonationRequestHeaders() };
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
  const { session, status } = useAppSession();
  const { targetUserId, targetRole } = useImpersonation();
  const token = session?.session.access_token;
  React.useEffect(() => { if (status === 'unauthenticated') clearResearchDirectories(); }, [status]);
  if (status !== 'authenticated' || !session || !token || session.user.app_metadata?.must_change_password) {
    return status === 'unauthenticated' ? <ErrorState title="登录状态已失效" /> : <LoadingState label="正在加载研究资料" />;
  }
  const userId = session.session.user.id;
  const scope = JSON.stringify([process.env.NEXT_PUBLIC_SUPABASE_URL, userId, session.user.id, session.role, token, targetUserId, targetRole]);
  return <OSSWorkspace key={scope} scope={scope} userId={userId} token={token} userEmail={session.user.email || userEmail} role={session.role} targetUserId={targetUserId} />;
}

function OSSWorkspace({ userEmail, scope, token, userId, role, targetUserId }: {
  userEmail: string; scope: string; token: string; userId: string; role: string; targetUserId: string | null;
}) {
  const [currentPrefix, setCurrentPrefix] = React.useState('');
  const [items, setItems] = React.useState<ResearchLibraryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');
  const [truncated, setTruncated] = React.useState(false);
  const [nextMarker, setNextMarker] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState('');
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
  const currentPrefixRef = React.useRef('');
  const listRequest = React.useRef<DirectoryRequest | null>(null);
  const mounted = React.useRef(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadBatchActive = React.useRef(false);

  const isImpersonating = targetUserId !== null;
  const canManage = isResearchLibraryManager(role) && !isImpersonating;
  const visibleItems = React.useMemo(
    () => filterAndSortLibraryItems(items, { query, type: typeFilter, sort }),
    [items, query, typeFilter, sort],
  );
  const filtersActive = Boolean(query.trim()) || typeFilter !== 'all';

  const isCurrent = React.useCallback((request: DirectoryRequest) => (
    mounted.current && listRequest.current === request && !request.controller.signal.aborted
  ), []);

  const resetPaging = React.useCallback(() => {
    setTruncated(false);
    setNextMarker(null);
    setLoadingMore(false);
    setMoreError('');
  }, []);

  const denyDirectory = React.useCallback((message: string) => {
    clearResearchDirectories();
    listRequest.current?.controller.abort();
    listRequest.current = null;
    setItems([]);
    setSelectedItems(new Set());
    resetPaging();
    setLoading(false);
    setLoadError(message);
  }, [resetPaging]);

  const listAuthorization = React.useCallback(async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    const impersonationHeaders = getImpersonationRequestHeaders();
    const expiresAt = (session?.expires_at ?? 0) * 1000;
    if (error || session?.access_token !== token || session.user.id !== userId || expiresAt <= Date.now()
      || (impersonationHeaders['X-Colliers-Impersonate-User'] ?? null) !== targetUserId) return null;
    return { headers: { Authorization: `Bearer ${token}`, ...impersonationHeaders }, expiresAt };
  }, [targetUserId, token, userId]);

  const readPage = React.useCallback(async (request: DirectoryRequest, authorization: NonNullable<Awaited<ReturnType<typeof listAuthorization>>>, marker?: string) => {
    const params = new URLSearchParams({ action: 'get-list', prefix: request.prefix });
    if (marker) params.set('marker', marker);
    const response = await fetch(`/api/oss?${params}`, { headers: authorization.headers, cache: 'no-store', signal: request.controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!isCurrent(request)) return;
    if (response.status === 401 || response.status === 403) return denyDirectory(result.message || '资料访问权限已失效');
    if (!response.ok || result.status !== 'success') throw new Error(result.message || '资料列表加载失败');
    if (!Array.isArray(result.data)) throw new Error('资料列表响应不完整');
    const hasMore = Boolean(result.truncated);
    const next = hasMore && typeof result.nextMarker === 'string' && result.nextMarker && result.nextMarker.startsWith(request.prefix) ? result.nextMarker : null;
    if (marker && hasMore && (!next || request.seenMarkers.has(next))) throw new Error('目录分页未能继续，请重试或刷新目录');
    if (next) request.seenMarkers.add(next);
    request.marker = next;
    request.rows = marker
      ? [...new Map([...request.rows, ...result.data as ResearchLibraryItem[]].map(item => [item.name, item])).values()]
      : result.data;
    request.read?.remember(request.rows, hasMore, authorization.expiresAt);
    setItems(request.rows);
    setTruncated(hasMore);
    setNextMarker(next);
  }, [denyDirectory, isCurrent]);

  const loadReports = React.useCallback(async (prefix: string, force = false) => {
    if (!mounted.current) return;
    listRequest.current?.controller.abort();
    const request: DirectoryRequest = { controller: new AbortController(), prefix, rows: [], marker: null, seenMarkers: new Set(), paging: false, read: null };
    listRequest.current = request;
    currentPrefixRef.current = prefix;
    setLoading(true);
    setLoadError('');
    resetPaging();
    setCurrentPrefix(prefix);
    setSelectedItems(new Set());
    try {
      const authorization = await listAuthorization();
      if (!isCurrent(request)) return;
      if (!authorization) return denyDirectory('登录身份已变化，请重试');
      // The editing path always loads a fresh directory so upload checks never use a snapshot.
      request.read = canManage ? null : beginResearchDirectoryRead(scope, prefix);
      if (force) request.read?.discard();
      if (!force && request.read?.cached) {
        request.rows = request.read.cached.items;
        setItems(request.rows);
        return;
      }
      await readPage(request, authorization);
    } catch (error) {
      if (!isCurrent(request)) return;
      setItems([]);
      setLoadError(error instanceof Error ? error.message : '资料列表加载失败');
    } finally {
      if (isCurrent(request)) setLoading(false);
    }
  }, [canManage, denyDirectory, isCurrent, listAuthorization, readPage, resetPaging, scope]);

  const loadMore = async () => {
    const request = listRequest.current;
    if (!request?.marker || request.paging || !isCurrent(request)) return;
    const marker = request.marker;
    request.paging = true;
    setLoadingMore(true);
    setMoreError('');
    try {
      const authorization = await listAuthorization();
      if (!isCurrent(request)) return;
      if (!authorization) return denyDirectory('登录身份已变化，请重试');
      await readPage(request, authorization, marker);
    } catch (error) {
      if (isCurrent(request)) setMoreError(error instanceof Error ? error.message : '更多资料加载失败');
    } finally {
      if (isCurrent(request)) {
        request.paging = false;
        setLoadingMore(false);
      }
    }
  };

  React.useEffect(() => {
    mounted.current = true;
    void loadReports('');
    const unsubscribe = subscribeResearchDirectoryChanges(() => { void loadReports(currentPrefixRef.current, true); });
    return () => {
      unsubscribe();
      mounted.current = false;
      listRequest.current?.controller.abort();
      listRequest.current = null;
    };
  }, [loadReports]);

  // A completed upload/edit refreshes its original directory only if the
  // user is still there; it must never navigate them back to an old folder.
  const refreshDirectory = (prefix: string, additional: string[] = [], subtrees: string[] = []) => {
    const affects = invalidateResearchDirectories([prefix, ...additional], subtrees);
    if (mounted.current && affects(currentPrefixRef.current)) return loadReports(currentPrefixRef.current, true);
  };

  const goUp = () => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    void loadReports(parts.length ? `${parts.join('/')}/` : '');
  };

  const clearFilters = () => {
    setQuery('');
    setTypeFilter('all');
  };

  const openLibraryFile = React.useCallback((item: ResearchLibraryItem, accessMethod: 'preview' | 'download', source: string) => {
    if (item.type !== 'file') return;

    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setNotice({ tone: 'warning', text: '浏览器拦截了新窗口，请允许弹窗后重试。' });
      return;
    }
    popup.opener = null;

    void (async () => {
      try {
        const headers = await authHeaders();
        const response = await fetch('/api/oss?action=access', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: item.name,
            display_name: itemDisplayName(item),
            file_type: classifyLibraryItem(item),
            file_size_bytes: item.sizeBytes ?? null,
            access_method: accessMethod,
            source,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if ((response.status === 401 || response.status === 403) && mounted.current) {
          denyDirectory(result.message || '资料访问权限已失效');
        }
        if (!response.ok || result.status !== 'success' || typeof result.url !== 'string') {
          throw new Error(result.message || '资料访问失败');
        }
        popup.location.replace(result.url);
      } catch (error) {
        popup.close();
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '资料访问失败' });
      }
    })();
  }, [denyDirectory]);

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
      setShowCreateFolderModal(false);
      setNotice({ tone: 'success', text: '文件夹已创建。' });
      await refreshDirectory(currentPrefix);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '创建失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const executeUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length || loading || loadError || truncated || uploadBatchActive.current) return;
    if (!canManage) return setNotice({ tone: 'warning', text: isImpersonating ? '用户模拟期间为只读模式。' : '只有管理员可以上传文件。' });

    const namesInBatch = new Set<string>();
    const queue = files.map((file, index) => {
      const nameKey = file.name.trim().toLowerCase();
      const entry: UploadEntry = { id: String(index), name: file.name, status: 'queued', progress: 0 };
      if (!isSupportedResearchFile(file.name)) {
        entry.status = 'unsupported';
        entry.message = '不支持此文件类型';
      } else if (isDuplicateUploadName(items, file.name)) {
        entry.status = 'duplicate';
        entry.message = '当前目录已存在同名文件';
      } else if (namesInBatch.has(nameKey)) {
        entry.status = 'duplicate';
        entry.message = '本次选择中已有同名文件';
      } else {
        namesInBatch.add(nameKey);
      }
      return { file, entry };
    });
    setUploads(queue.map(({ entry }) => entry));
    const uploadable = queue.filter(({ entry }) => entry.status === 'queued');
    if (!uploadable.length) return;

    const prefix = currentPrefix;
    const update = (id: string, patch: Partial<UploadEntry>) => {
      if (mounted.current) setUploads(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    };
    uploadBatchActive.current = true;
    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    try {
      const authorization = await listAuthorization();
      if (!authorization || !mounted.current) throw new Error('登录身份已变化，请重新选择要上传的文件。');
      const signatureResponse = await fetch('/api/oss?action=get-signature', { headers: authorization.headers, cache: 'no-store' });
      const signature = await signatureResponse.json().catch(() => ({}));
      if (!signatureResponse.ok || signature.status !== 'success') throw new Error(signature.message || '获取上传签名失败');

      let next = 0;
      let identityChanged = false;
      const uploadNext = async () => {
        while (next < uploadable.length && mounted.current && !identityChanged) {
          const { file, entry: { id } } = uploadable[next++];
          const current = await listAuthorization().catch(() => null);
          if (!current || !mounted.current || identityChanged) {
            identityChanged = true;
            return;
          }
          update(id, { status: 'uploading', progress: 1 });
          const fullKey = `${prefix}${file.name}`;
          try {
            const formData = new FormData();
            formData.append('key', fullKey);
            formData.append('policy', signature.policy);
            formData.append('OSSAccessKeyId', signature.accessid);
            formData.append('signature', signature.signature);
            formData.append('success_action_status', '200');
            formData.append('file', file);
            await uploadToOSS(signature.host, formData, (progress) => update(id, { progress }));
            logAction(userEmail, 'OSS_UPLOAD', { fileName: fullKey, size: file.size });
            succeeded++;
            update(id, { status: 'success', progress: 100 });
          } catch (error) {
            failed++;
            update(id, { status: 'error', message: error instanceof Error ? error.message : '上传失败' });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_SIMULTANEOUS_UPLOADS, uploadable.length) }, uploadNext));
      if (mounted.current) {
        const remaining = uploadable.length - succeeded - failed;
        if (remaining) setUploads(current => current.map(item => item.status === 'queued' ? { ...item, status: 'error', message: '登录身份已变化，文件未上传' } : item));
        const skipped = queue.length - uploadable.length;
        setNotice({ tone: failed || remaining || skipped ? 'warning' : 'success', text: `上传队列已处理：成功 ${succeeded} 个，失败 ${failed} 个，未上传 ${remaining + skipped} 个。` });
      }
      // A network error can lose the response after storage received the object.
      // Read back once before the user retries; never resubmit automatically.
      if (succeeded || failed) await refreshDirectory(prefix);
    } catch (error) {
      if (mounted.current) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '上传失败' });
        setUploads(current => current.map(item => item.status === 'queued' || item.status === 'uploading' ? { ...item, status: 'error', message: '上传初始化失败' } : item));
      }
    } finally {
      uploadBatchActive.current = false;
      if (mounted.current) setUploading(false);
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
    const oldKey = targetItem.name;
    const newKey = newName.trim();
    const refreshMove = () => refreshDirectory(researchDirectoryParent(oldKey), [researchDirectoryParent(newKey)], oldKey.endsWith('/') ? [oldKey, newKey] : []);
    setOperationInProgress(true);
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/oss?action=move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ oldKey, newKey }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') {
        if (result.stats?.copied || result.stats?.deleted) await refreshMove();
        throw new Error(result.message || '重命名失败');
      }
      setShowRenameModal(false);
      setNotice({ tone: 'success', text: result.message || '名称已更新。' });
      await refreshMove();
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
    const key = targetItem.name;
    const refreshDelete = () => refreshDirectory(researchDirectoryParent(key), [], key.endsWith('/') ? [key] : []);
    setOperationInProgress(true);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/oss?action=delete&file=${encodeURIComponent(key)}`, { method: 'POST', headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'success') {
        if (result.stats?.deleted) await refreshDelete();
        throw new Error(result.message || '删除失败');
      }
      setShowDeleteModal(false);
      setNotice({ tone: 'success', text: result.message || '项目已删除。' });
      await refreshDelete();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '删除失败' });
    } finally {
      setOperationInProgress(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedItems.size) return;
    const attempted = selectedItems.size;
    const refreshSelection = () => refreshDirectory(currentPrefix, [], [...selectedItems].filter(key => key.endsWith('/')));
    setOperationInProgress(true);
    let success = 0;
    let failed = 0;
    try {
      const headers = await authHeaders();
      for (const name of selectedItems) {
        const response = await fetch(`/api/oss?action=delete&batch=1&file=${encodeURIComponent(name)}`, { method: 'POST', headers });
        if (response.ok) success += 1; else failed += 1;
      }
      if (success) {
        logAction(userEmail, 'OSS_BATCH_DELETE', {
          count: success,
          attempted,
          failed,
          audit_scope: 'aggregate',
          item_audit_authority: 'server',
        });
      }
      setShowBatchDeleteModal(false);
      setSelectedItems(new Set());
      setNotice({ tone: failed ? 'warning' : 'success', text: `批量删除完成：成功 ${success} 个，失败 ${failed} 个。` });
      await refreshSelection();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '批量删除失败' });
      if (success || failed) await refreshSelection();
    } finally {
      setOperationInProgress(false);
    }
  };

  const breadcrumbParts = currentPrefix.split('/').filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200/90 bg-[#f8fafc] px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <nav aria-label="资料库路径" className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <button type="button" onClick={() => void loadReports('')} className="font-semibold text-[var(--cd-color-brand)] transition hover:underline">全部资料</button>
              {breadcrumbParts.map((part, index) => {
                const prefix = `${breadcrumbParts.slice(0, index + 1).join('/')}/`;
                return <React.Fragment key={prefix}><span className="text-slate-300">/</span><button type="button" onClick={() => void loadReports(prefix)} className="max-w-40 truncate transition hover:text-[var(--cd-color-brand)]">{part}</button></React.Fragment>;
              })}
            </div>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            {currentPrefix ? <Button variant="secondary" size="sm" onClick={goUp}><ArrowUp size={14} />上一级</Button> : null}
            <Button variant="secondary" size="sm" onClick={() => void loadReports(currentPrefix, true)} disabled={loading}><RefreshCw size={14} />刷新</Button>
            {canManage ? <>
              <Button variant="secondary" size="sm" onClick={openCreateFolder}><FolderPlus size={14} />新建文件夹</Button>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => void executeUpload(event)} />
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading || loading || Boolean(loadError) || truncated}><Upload size={14} />{uploading ? '上传中…' : '上传文件'}</Button>
            </> : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_160px_170px_auto]">
          <label className="relative block">
            <span className="sr-only">搜索当前目录资料</span>
            <Search aria-hidden="true" size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前目录资料…" className="pl-8" />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as LibraryTypeFilter)} className="h-[var(--cd-control-height-md)] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2.5 text-xs text-[var(--cd-color-text-primary)] outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]">
            <option value="all">全部类型</option><option value="folder">文件夹</option><option value="pdf">PDF 文档</option><option value="presentation">演示文稿</option><option value="document">文字文档</option><option value="spreadsheet">电子表格</option><option value="other">其他文件</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} className="h-[var(--cd-control-height-md)] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2.5 text-xs text-[var(--cd-color-text-primary)] outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]">
            <option value="modified-desc">最近修改优先</option><option value="modified-asc">最早修改优先</option><option value="name-asc">按名称升序</option><option value="size-desc">按文件大小</option>
          </select>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <span className="text-[10px] font-medium tabular-nums text-slate-500">当前显示 {visibleItems.length} / {items.length} 项</span>
            {filtersActive ? <button type="button" onClick={clearFilters} className="text-[10px] font-semibold text-[var(--cd-color-brand)] hover:underline">清除筛选</button> : null}
          </div>
        </div>
      </div>

      {notice ? <div className={`mx-3 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs sm:mx-4 ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭状态"><X size={14} /></button></div> : null}
      {truncated ? <div className="mx-3 mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-4">
        <span>当前目录超过云端存储单次返回上限，搜索、排序和全选只针对已加载项目。</span>
        {canManage ? <span>上传前请加载完整目录，以便检查同名文件。</span> : null}
        {nextMarker ? <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? '加载中…' : '加载更多'}</Button> : <span>请刷新目录，或进入子目录缩小范围。</span>}
        {moreError ? <span role="status">{moreError}</span> : null}
      </div> : null}

      {uploads.length ? <div className="mx-3 mt-3 shrink-0 rounded-md border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(23,32,51,0.03)] sm:mx-4">
        <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-700">上传状态</span><button type="button" onClick={() => setUploads([])} disabled={uploading} className="text-[10px] text-slate-500 transition hover:text-slate-800">清除</button></div>
        <div className="grid max-h-40 gap-1.5 overflow-y-auto lg:grid-cols-2">
          {uploads.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-100 bg-slate-50/50 px-2 py-1.5 text-[10px]">
            {entry.status === 'success' ? <CheckCircle2 size={13} className="shrink-0 text-emerald-600" /> : entry.status === 'error' || entry.status === 'unsupported' || entry.status === 'duplicate' ? <XCircle size={13} className="shrink-0 text-rose-500" /> : <Upload size={13} className="shrink-0 text-[var(--cd-color-brand)]" />}
            <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-700">{entry.name}</div><div className="text-slate-400">{entry.status === 'uploading' ? `${entry.progress}% · 正在上传` : entry.message || UPLOAD_STATUS_LABELS[entry.status]}</div></div>
            {entry.status === 'uploading' ? <div className="h-1 w-16 overflow-hidden rounded bg-slate-100"><div className="h-full bg-[var(--cd-color-brand)]" style={{ width: `${entry.progress}%` }} /></div> : null}
          </div>)}
        </div>
      </div> : null}

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {loading ? <LoadingState label="正在加载研究资料" /> : loadError ? <ErrorState title="资料库加载失败" description={loadError} action={<Button variant="secondary" size="sm" onClick={() => void loadReports(currentPrefix, true)}>重试</Button>} /> : visibleItems.length === 0 ? <EmptyState title={filtersActive ? '没有匹配的资料' : '当前目录为空'} description={filtersActive ? '请调整搜索词或文件类型筛选。' : '此目录暂时没有可浏览的研究资料。'} action={filtersActive ? <Button variant="secondary" size="sm" onClick={clearFilters}>清除筛选</Button> : undefined} /> : <>
          <div className="hidden overflow-hidden rounded-md border border-slate-200 bg-white md:block">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 text-[10px] font-semibold text-slate-500"><tr>{canManage ? <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="全选" checked={visibleItems.length > 0 && visibleItems.every((item) => selectedItems.has(item.name))} onChange={() => setSelectedItems((current) => visibleItems.every((item) => current.has(item.name)) ? new Set() : new Set(visibleItems.map((item) => item.name)))} /></th> : null}<th className="px-3 py-2.5">名称</th><th className="w-28 px-3 py-2.5">类型</th><th className="w-28 px-3 py-2.5">大小</th><th className="w-32 px-3 py-2.5">修改时间</th><th className="w-52 px-3 py-2.5 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{visibleItems.map((item) => <tr key={item.name} className="transition-colors hover:bg-slate-50/80">{canManage ? <td className="px-3 py-2.5"><input type="checkbox" aria-label={`选择 ${itemDisplayName(item)}`} checked={selectedItems.has(item.name)} onChange={() => toggleSelected(item.name)} /></td> : null}<td className="min-w-0 px-3 py-2.5"><button type="button" onClick={() => item.type === 'folder' ? void loadReports(item.name) : openLibraryFile(item, 'preview', 'name')} className="flex max-w-full items-center gap-2 font-medium text-slate-800 transition hover:text-[var(--cd-color-brand)]"><span className="shrink-0 text-slate-400">{item.type === 'folder' ? <Folder size={15} /> : <File size={15} />}</span><span className="truncate" title={itemDisplayName(item)}>{itemDisplayName(item)}</span></button></td><td className="px-3 py-2.5 text-slate-500">{typeLabel(item)}</td><td className="px-3 py-2.5 tabular-nums text-slate-500">{item.type === 'folder' ? '—' : item.size || '—'}</td><td className="px-3 py-2.5 text-slate-500">{formatDate(item.lastModified)}</td><td className="px-3 py-2.5 text-right"><div className="flex justify-end gap-1">{item.type === 'file' ? <Button variant="ghost" size="sm" onClick={() => openLibraryFile(item, 'download', 'download_button')}><Download size={13} />下载</Button> : null}{canManage && item.type === 'file' ? <Button variant="ghost" size="sm" onClick={() => openRename(item)}><Edit2 size={13} />重命名</Button> : null}{canManage ? <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => openDelete(item)}><Trash2 size={13} />删除</Button> : null}</div></td></tr>)}</tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white md:hidden">{visibleItems.map((item) => <div key={item.name} className="p-3"><div className="flex items-start gap-2"><span className="mt-0.5 shrink-0 text-slate-400">{item.type === 'folder' ? <Folder size={16} /> : <File size={16} />}</span><button type="button" onClick={() => item.type === 'folder' ? void loadReports(item.name) : openLibraryFile(item, 'preview', 'name')} className="min-w-0 flex-1 text-left"><div className="break-words text-xs font-semibold text-slate-800">{itemDisplayName(item)}</div><div className="mt-1 text-[10px] text-slate-400">{typeLabel(item)} · {item.type === 'folder' ? '文件夹' : item.size || '—'} · {formatDate(item.lastModified)}</div></button>{canManage ? <input type="checkbox" aria-label={`选择 ${itemDisplayName(item)}`} checked={selectedItems.has(item.name)} onChange={() => toggleSelected(item.name)} /> : null}</div><div className="mt-2 flex flex-wrap justify-end gap-1">{item.type === 'file' ? <Button variant="secondary" size="sm" onClick={() => openLibraryFile(item, 'download', 'download_button')}><Download size={13} />下载</Button> : null}{canManage && item.type === 'file' ? <Button variant="secondary" size="sm" onClick={() => openRename(item)}><Edit2 size={13} />重命名</Button> : null}{canManage ? <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => openDelete(item)}><Trash2 size={13} />删除</Button> : null}</div></div>)}</div>
        </>}
      </div>

      {canManage && selectedItems.size ? <div className="shrink-0 border-t border-slate-200 bg-[#f8fafc] px-3 py-2 sm:px-4"><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-600">已选择 {selectedItems.size} 项</span><Button variant="danger" size="sm" onClick={() => setShowBatchDeleteModal(true)}><Trash2 size={13} />删除选中</Button></div></div> : null}

      <Modal isOpen={showCreateFolderModal} onClose={() => !operationInProgress && setShowCreateFolderModal(false)} title="新建文件夹"><label className="block text-xs font-medium text-slate-700">文件夹名称<Input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createFolder()} className="mt-1.5" /></label><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowCreateFolderModal(false)} disabled={operationInProgress}>取消</Button><Button size="sm" onClick={() => void createFolder()} disabled={operationInProgress || !folderName.trim()}>{operationInProgress ? '创建中…' : '创建'}</Button></div></Modal>

      <Modal isOpen={showRenameModal} onClose={() => !operationInProgress && setShowRenameModal(false)} title="重命名或移动"><label className="block text-xs font-medium text-slate-700">目标路径<Input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void renameItem()} className="mt-1.5 font-mono" /></label><p className="mt-2 text-[10px] text-slate-500">修改完整云端存储路径可移动文件；服务端移动逻辑保持不变。</p><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowRenameModal(false)} disabled={operationInProgress}>取消</Button><Button size="sm" onClick={() => void renameItem()} disabled={operationInProgress || !newName.trim() || newName.trim() === targetItem?.name}>{operationInProgress ? '处理中…' : '确认'}</Button></div></Modal>

      <Modal isOpen={showDeleteModal} onClose={() => !operationInProgress && setShowDeleteModal(false)} title="确认删除" danger><div className="rounded-md border border-rose-200 bg-rose-50 p-3"><p className="text-xs text-rose-900">确定删除以下{targetItem?.type === 'folder' ? '文件夹' : '文件'}？</p><p className="mt-2 break-all font-mono text-xs font-semibold text-rose-700">{targetItem ? itemDisplayName(targetItem) : ''}</p>{targetItem?.type === 'folder' ? <p className="mt-2 text-[10px] font-medium text-rose-700">文件夹删除会递归删除其中所有对象，无法撤销。</p> : null}</div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowDeleteModal(false)} disabled={operationInProgress}>取消</Button><Button variant="danger" size="sm" onClick={() => void deleteOne()} disabled={operationInProgress}><Trash2 size={13} />{operationInProgress ? '删除中…' : '确认删除'}</Button></div></Modal>

      <Modal isOpen={showBatchDeleteModal} onClose={() => !operationInProgress && setShowBatchDeleteModal(false)} title="批量删除确认" danger><div className="rounded-md border border-rose-200 bg-rose-50 p-3"><p className="text-xs font-semibold text-rose-900">确定删除选中的 {selectedItems.size} 项？</p><p className="mt-2 text-[10px] text-rose-700">其中若包含文件夹，将沿用现有递归删除逻辑。此操作无法撤销。</p></div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setShowBatchDeleteModal(false)} disabled={operationInProgress}>取消</Button><Button variant="danger" size="sm" onClick={() => void deleteSelected()} disabled={operationInProgress}><Trash2 size={13} />{operationInProgress ? '删除中…' : '确认删除'}</Button></div></Modal>
    </div>
  );
}
