'use client';

import * as React from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { Plus, Pencil, Trash2, X, Save, Rocket, Wrench, Bug, Clock, CheckCircle2, Circle, Map, Database, FileText, BarChart3, Cloud, Settings } from 'lucide-react';

/* ── 类型 ────────────────────────────────────────────────────────────────── */

interface ChangelogEntry {
  id: string;
  code: string | null;
  title: string;
  description: string;
  status: 'planned' | 'in_progress' | 'released';
  category: 'feature' | 'improvement' | 'fix';
  module: string;
  version: string | null;
  released_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type FormData = Omit<ChangelogEntry, 'id' | 'created_at' | 'updated_at'>;
type ListEntry = Omit<ChangelogEntry, 'description' | 'sort_order' | 'updated_at'> & {
  description_preview: string;
};
const LIST_FIELDS = 'id,code,title,status,category,module,version,released_at,created_at';
const PREVIEW_FIELD = 'description_preview:changelog_description_preview';
const FORM_FIELDS = 'code,title,description,status,category,module,version,released_at,sort_order';

async function readList(signal: AbortSignal): Promise<ListEntry[]> {
  const query = (field: string) => supabase.from('changelog')
    .select(`${LIST_FIELDS},${field}`)
    .order('sort_order', { ascending: false })
    .order('created_at', { ascending: false })
    .abortSignal(signal);
  const summary = await query(PREVIEW_FIELD).returns<ListEntry[]>();
  if (!summary.error) return summary.data ?? [];
  // The app can ship before the migration, or use the old schema during rollback.
  if (signal.aborted || summary.error.code !== '42703' || !/\bchangelog_description_preview\b/.test(summary.error.message)) {
    throw summary.error;
  }
  const legacy = await query('description').returns<(Omit<ListEntry, 'description_preview'> & { description: string })[]>();
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? []).map(({ description, ...entry }) => ({
    ...entry, description_preview: Array.from(description ?? '').slice(0, 160).join(''),
  }));
}

const EMPTY_FORM: FormData = {
  code: null,
  title: '',
  description: '',
  status: 'planned',
  category: 'feature',
  module: 'general',
  version: null,
  released_at: null,
  sort_order: 0,
};

/* ── 常量 ────────────────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  planned:     { label: '即将更新', color: 'bg-blue-100 text-blue-700 ring-blue-600/20',     icon: Circle },
  in_progress: { label: '开发中',   color: 'bg-amber-100 text-amber-700 ring-amber-600/20', icon: Clock },
  released:    { label: '已上线',   color: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20', icon: CheckCircle2 },
};

const CATEGORY_CONFIG = {
  feature:     { label: '新功能', icon: Rocket },
  improvement: { label: '优化',   icon: Wrench },
  fix:         { label: '修复',   icon: Bug },
};

const MODULE_CONFIG: Record<string, { label: string; icon: typeof Map; color: string }> = {
  map:      { label: '地图系统',     icon: Map,       color: 'text-blue-600' },
  database: { label: '数据库管理',   icon: Database,  color: 'text-violet-600' },
  lease:    { label: '租赁成交',     icon: FileText,  color: 'text-orange-600' },
  bi:       { label: '商业分析',     icon: BarChart3, color: 'text-emerald-600' },
  cloud:    { label: '云端资料库',   icon: Cloud,     color: 'text-sky-600' },
  admin:    { label: '管理后台',     icon: Settings,  color: 'text-zinc-600' },
  general:  { label: '通用',         icon: Settings,  color: 'text-zinc-500' },
};

const MODULE_ORDER = ['map', 'database', 'lease', 'bi', 'cloud', 'admin', 'general'];

/* ── 组件 ────────────────────────────────────────────────────────────────── */

export function ChangelogManager({ adminEmail = '' }: { adminEmail?: string }) {
  const [entries, setEntries] = React.useState<ListEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [listError, setListError] = React.useState(false);
  const [editing, setEditing] = React.useState<ListEntry | null>(null);
  const [detailState, setDetailState] = React.useState<'loading' | 'error' | 'ready'>('ready');
  const [form, setForm] = React.useState<FormData>(EMPTY_FORM);
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<string>('planned');
  const [filterModule, setFilterModule] = React.useState<string>('all');
  const listRequest = React.useRef<AbortController | null>(null);
  const detailRequest = React.useRef<AbortController | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = React.useRef(false);

  const showToast = (msg: string, ok = true) => {
    if (!mounted.current) return;
    clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  /* ── 数据加载 ── */

  const fetchEntries = React.useCallback(async () => {
    if (!mounted.current) return;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    setListError(false);
    try {
      const data = await readList(request.signal);
      if (!request.signal.aborted) setEntries(data);
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
    void fetchEntries();
    return () => {
      mounted.current = false;
      listRequest.current?.abort();
      detailRequest.current?.abort();
      clearTimeout(toastTimer.current);
    };
  }, [fetchEntries]);

  /* ── 快速切换状态 ── */

  const quickChangeStatus = async (entry: ListEntry, newStatus: ChangelogEntry['status']) => {
    if (saving || newStatus === entry.status) return;
    const updates: Pick<FormData, 'status'> & Partial<Pick<FormData, 'released_at'>> = { status: newStatus };
    if (newStatus === 'released' && !entry.released_at) {
      updates.released_at = new Date().toISOString().slice(0, 10);
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('changelog').update(updates).eq('id', entry.id);
      if (error) throw error;
      showToast(`已更新为「${STATUS_CONFIG[newStatus].label}」`);
      await fetchEntries();
    } catch (error) {
      showToast('状态更新失败: ' + errorMessage(error), false);
    } finally {
      setSaving(false);
    }
  };

  /* ── 表单操作 ── */

  const openNew = () => {
    detailRequest.current?.abort();
    setEditing(null);
    setDetailState('ready');
    // 自动生成下一个编号
    const maxNum = entries.reduce((max, e) => {
      if (!e.code) return max;
      const n = parseInt(e.code.replace('CL-', ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    setForm({ ...EMPTY_FORM, code: `CL-${String(maxNum + 1).padStart(3, '0')}` });
    setShowForm(true);
  };

  const openEdit = async (entry: ListEntry) => {
    detailRequest.current?.abort();
    const request = new AbortController();
    detailRequest.current = request;
    setEditing(entry);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setDetailState('loading');
    try {
      const { data, error } = await supabase.from('changelog').select(FORM_FIELDS)
        .eq('id', entry.id).abortSignal(request.signal).single<FormData>();
      if (error || !data) throw error ?? new Error('记录不存在');
      if (request.signal.aborted) return;
      setForm({ ...data, module: data.module || 'general' });
      setDetailState('ready');
    } catch {
      if (!request.signal.aborted) setDetailState('error');
    } finally {
      if (detailRequest.current === request) detailRequest.current = null;
    }
  };

  const closeForm = () => {
    detailRequest.current?.abort();
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (saving || detailState !== 'ready') return;
    if (!form.title.trim()) { showToast('标题不能为空', false); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code || null,
        title: form.title,
        description: form.description,
        status: form.status,
        category: form.category,
        module: form.module,
        version: form.version || null,
        released_at: form.status === 'released' ? (form.released_at || new Date().toISOString().slice(0, 10)) : null,
        sort_order: form.sort_order,
      };
      if (editing) {
        const { error } = await supabase.from('changelog').update(payload).eq('id', editing.id);
        if (error) throw error;
        logAction(adminEmail || 'unknown', 'CHANGELOG_UPDATE', { code: payload.code, title: payload.title });
        showToast('已更新');
      } else {
        const { error } = await supabase.from('changelog').insert(payload);
        if (error) throw error;
        logAction(adminEmail || 'unknown', 'CHANGELOG_CREATE', { code: payload.code, title: payload.title });
        showToast('已创建');
      }
      closeForm();
      await fetchEntries();
    } catch (error) {
      showToast('保存失败: ' + errorMessage(error), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: ListEntry) => {
    if (saving || !confirm(`确认删除「${entry.title}」？`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('changelog').delete().eq('id', entry.id);
      if (error) throw error;
      logAction(adminEmail || 'unknown', 'CHANGELOG_DELETE', { code: entry.code, title: entry.title });
      showToast('已删除');
      if (editing?.id === entry.id) closeForm();
      await fetchEntries();
    } catch (error) {
      showToast('删除失败: ' + errorMessage(error), false);
    } finally {
      setSaving(false);
    }
  };

  /* ── 筛选与分组 ── */

  const statusCounts = React.useMemo(() => {
    const c: Record<string, number> = { all: entries.length, planned: 0, in_progress: 0, released: 0 };
    entries.forEach(e => { c[e.status] = (c[e.status] ?? 0) + 1; });
    return c;
  }, [entries]);

  const filtered = React.useMemo(() => {
    return entries.filter(e => {
      if (filterStatus !== 'all' && e.status !== filterStatus) return false;
      if (filterModule !== 'all' && (e.module || 'general') !== filterModule) return false;
      return true;
    });
  }, [entries, filterStatus, filterModule]);

  const grouped = React.useMemo(() => {
    const g: Record<string, ListEntry[]> = {};
    filtered.forEach(e => {
      const m = e.module || 'general';
      (g[m] ?? (g[m] = [])).push(e);
    });
    return g;
  }, [filtered]);

  const activeModules = MODULE_ORDER.filter(m => grouped[m]?.length);

  const moduleCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    entries.forEach(e => {
      if (filterStatus === 'all' || e.status === filterStatus) {
        const m = e.module || 'general';
        c[m] = (c[m] ?? 0) + 1;
      }
    });
    return c;
  }, [entries, filterStatus]);

  /* ── 渲染 ── */

  return (
    <div className="relative flex h-full overflow-hidden w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* ── 左侧：列表 ── */}
      <div className={`min-w-0 flex-1 flex-col overflow-hidden border-zinc-200/60 lg:border-r ${showForm ? 'hidden lg:flex lg:max-w-[460px]' : 'flex'}`}>
        {/* 头部 */}
        <div className="shrink-0 flex items-center justify-between border-b border-zinc-200/60 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">更新日志</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">按模块管理系统的功能更新记录</p>
          </div>
          <button
            onClick={openNew}
            disabled={loading || listError || saving}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 lg:min-h-0"
          >
            <Plus size={14} strokeWidth={2} />
            新增
          </button>
        </div>

        {/* 筛选栏 */}
        <div className="shrink-0 border-b border-zinc-200/60 bg-zinc-50/60 px-5 py-2.5 space-y-2">
          {/* 状态筛选 */}
          <div className="flex items-center gap-1">
            {([
              { key: 'all',         label: '全部' },
              { key: 'planned',     label: '即将更新' },
              { key: 'in_progress', label: '开发中' },
              { key: 'released',    label: '已上线' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  filterStatus === key
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                {label}
                <span className="ml-1 text-[10px] opacity-60">{statusCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
          {/* 模块筛选 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-400">模块:</span>
            <select
              value={filterModule}
              onChange={e => setFilterModule(e.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600 outline-none focus:border-primary"
            >
              <option value="all">全部</option>
              {MODULE_ORDER.filter(m => moduleCounts[m]).map(m => (
                <option key={m} value={m}>{MODULE_CONFIG[m].label} ({moduleCounts[m]})</option>
              ))}
            </select>
          </div>
        </div>

        {/* 列表：按模块分组 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {listError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <span>更新日志列表读取失败</span>
              <button type="button" className="min-h-11 rounded-md px-2 font-medium underline lg:min-h-0" onClick={() => void fetchEntries()}>重试加载列表</button>
            </div>
          )}
          {loading && entries.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100" />)}
            </div>
          ) : listError && entries.length === 0 ? null : entries.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-400">
              暂无更新记录，点击右上角「新增」创建
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-400">
              无匹配记录，尝试调整筛选条件
            </div>
          ) : (
            activeModules.map(mod => {
              const items = grouped[mod];
              const modCfg = MODULE_CONFIG[mod] ?? MODULE_CONFIG.general;
              const ModIcon = modCfg.icon;
              return (
                <div key={mod}>
                  {/* 模块标题 */}
                  <div className="mb-2 flex items-center gap-1.5 sticky top-0 bg-gradient-to-b from-white via-white to-white/80 py-1 -mx-1 px-1">
                    <ModIcon size={14} className={modCfg.color} />
                    <span className="text-xs font-bold text-zinc-700">{modCfg.label}</span>
                    <span className="text-[11px] text-zinc-400">({items.length})</span>
                  </div>

                  <div className="space-y-1.5">
                    {items.map(entry => {
                      const catCfg = CATEGORY_CONFIG[entry.category];
                      const CatIcon = catCfg.icon;
                      const staCfg = STATUS_CONFIG[entry.status];
                      const isActive = editing?.id === entry.id;
                      return (
                        <div
                          key={entry.id}
                          data-changelog-id={entry.id}
                          className={`rounded-lg border px-3.5 py-2.5 transition-all group ${
                            isActive
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {/* 左侧内容区：点击打开编辑 */}
                            <button
                              onClick={() => void openEdit(entry)}
                              disabled={saving}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-1.5 mb-1">
                                <CatIcon size={12} className="shrink-0 text-zinc-400" />
                                {entry.code && (
                                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-500">
                                    {entry.code}
                                  </span>
                                )}
                                <span className="text-xs font-medium text-zinc-900 truncate">{entry.title}</span>
                              </div>
                              {entry.description_preview && (
                                <p className="text-[11px] text-zinc-500 line-clamp-1 leading-relaxed">{entry.description_preview}</p>
                              )}
                              <div className="mt-1.5 flex items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${staCfg.color}`}>
                                  {staCfg.label}
                                </span>
                                {entry.version && (
                                  <span className="text-[10px] text-zinc-400 font-mono">{entry.version}</span>
                                )}
                                <span className="text-[10px] text-zinc-400">
                                  {entry.created_at ? new Date(entry.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : ''}
                                </span>
                              </div>
                            </button>

                            {/* 右侧操作区 */}
                            <div className="flex shrink-0 items-center gap-1">
                              {/* 快速状态切换 */}
                              <select
                                value={entry.status}
                                aria-label="快速切换状态"
                                disabled={saving || isActive}
                                onChange={e => { e.stopPropagation(); quickChangeStatus(entry, e.target.value as ChangelogEntry['status']); }}
                                onClick={e => e.stopPropagation()}
                                className={`min-h-11 rounded border-0 px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ring-1 ring-inset ${staCfg.color} transition-all hover:brightness-95 lg:min-h-0`}
                              >
                                <option value="planned">即将更新</option>
                                <option value="in_progress">开发中</option>
                                <option value="released">已上线</option>
                              </select>
                              <button
                                type="button"
                                aria-label="编辑记录"
                                onClick={() => void openEdit(entry)}
                                disabled={saving}
                                className="hidden rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 lg:inline-flex [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="删除记录"
                                disabled={saving}
                                onClick={() => void handleDelete(entry)}
                                className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 lg:min-h-0 lg:min-w-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 右侧：编辑面板 ── */}
      {showForm && (
        <section aria-label="更新日志编辑" className="flex w-full min-w-0 shrink-0 flex-col overflow-hidden bg-zinc-50/50 lg:w-[46%] lg:max-w-[380px]">
          {/* 表头 */}
          <div className="shrink-0 flex items-center justify-between border-b border-zinc-200/60 px-5 py-3">
            <h3 className="text-sm font-semibold text-zinc-800">
              {editing ? '编辑记录' : '新增记录'}
            </h3>
            <button type="button" onClick={closeForm} disabled={saving} aria-label="关闭编辑面板" className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 lg:min-h-0 lg:min-w-0">
              <X size={16} />
            </button>
          </div>

          {detailState === 'loading' ? (
            <p role="status" className="px-5 py-4 text-sm text-zinc-500">正在读取记录…</p>
          ) : detailState === 'error' && editing ? (
            <div role="alert" className="space-y-2 px-5 py-4 text-sm text-zinc-700">
              <p>无法读取完整记录，请重试。</p>
              <button type="button" className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium lg:min-h-0 lg:py-1.5" onClick={() => void openEdit(editing)}>重试读取记录</button>
            </div>
          ) : <>
          {/* 表单 */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* 编号（只读） */}
            <Field label="编号">
              <input
                value={form.code ?? ''}
                readOnly
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-500 cursor-not-allowed"
              />
            </Field>

            <Field label="标题" required>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="如：新增楼宇对比功能"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </Field>

            <Field label="描述">
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4}
                placeholder="详细描述更新内容…"
                className="w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </Field>

            {/* 模块 */}
            <Field label="所属模块">
              <select
                value={form.module}
                onChange={e => setForm(f => ({ ...f, module: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                {MODULE_ORDER.map(m => {
                  const cfg = MODULE_CONFIG[m];
                  return <option key={m} value={m}>{cfg.label}</option>;
                })}
              </select>
            </Field>

            {/* 状态 + 分类 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="状态">
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as FormData['status'] }))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  <option value="planned">即将更新</option>
                  <option value="in_progress">开发中</option>
                  <option value="released">已上线</option>
                </select>
              </Field>
              <Field label="分类">
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as FormData['category'] }))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  <option value="feature">新功能</option>
                  <option value="improvement">优化</option>
                  <option value="fix">修复</option>
                </select>
              </Field>
            </div>

            {/* 版本号 + 上线日期 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="版本号">
                <input
                  value={form.version ?? ''}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value || null }))}
                  placeholder="v2.1"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </Field>
              <Field label="上线日期">
                <input
                  type="date"
                  value={form.released_at ?? ''}
                  onChange={e => setForm(f => ({ ...f, released_at: e.target.value || null }))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </Field>
            </div>

            <Field label="排序权重">
              <input
                type="number"
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <p className="mt-1 text-[11px] text-zinc-400">数值越大越靠前</p>
            </Field>
          </div>

          {/* 底部按钮 */}
          <div className="shrink-0 flex items-center justify-between border-t border-zinc-200/60 px-5 py-3">
            {editing ? (
              <button
                onClick={() => void handleDelete(editing)}
                disabled={saving}
                className="min-h-11 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 lg:min-h-0"
              >
                删除
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                onClick={closeForm}
                disabled={saving}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 lg:min-h-0"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim()}
                className="flex min-h-11 items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 lg:min-h-0"
              >
                <Save size={13} />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
          </>}
        </section>
      )}
    </div>
  );
}

/* ── 辅助组件 ── */

function errorMessage(error: unknown) {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
