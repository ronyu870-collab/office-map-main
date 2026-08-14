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
  const [entries, setEntries] = React.useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<ChangelogEntry | null>(null);
  const [form, setForm] = React.useState<FormData>(EMPTY_FORM);
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<string>('planned');
  const [filterModule, setFilterModule] = React.useState<string>('all');

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  /* ── 数据加载 ── */

  const fetchEntries = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('changelog')
      .select('*')
      .order('sort_order', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Changelog] 加载失败:', error.message);
      showToast('加载失败: ' + error.message, false);
    }
    setEntries(data ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchEntries(); }, [fetchEntries]);

  /* ── 快速切换状态 ── */

  const quickChangeStatus = async (entry: ChangelogEntry, newStatus: ChangelogEntry['status']) => {
    const updates: Record<string, any> = { status: newStatus };
    if (newStatus === 'released' && !entry.released_at) {
      updates.released_at = new Date().toISOString().slice(0, 10);
    }
    const { error } = await supabase.from('changelog').update(updates).eq('id', entry.id);
    if (error) {
      showToast('状态更新失败: ' + error.message, false);
      return;
    }
    showToast(`已更新为「${STATUS_CONFIG[newStatus].label}」`);
    await fetchEntries();
  };

  /* ── 表单操作 ── */

  const openNew = () => {
    setEditing(null);
    // 自动生成下一个编号
    const maxNum = entries.reduce((max, e) => {
      if (!e.code) return max;
      const n = parseInt(e.code.replace('CL-', ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    setForm({ ...EMPTY_FORM, code: `CL-${String(maxNum + 1).padStart(3, '0')}` });
    setShowForm(true);
  };

  const openEdit = (entry: ChangelogEntry) => {
    setEditing(entry);
    setForm({
      code: entry.code,
      title: entry.title,
      description: entry.description,
      status: entry.status,
      category: entry.category,
      module: entry.module || 'general',
      version: entry.version,
      released_at: entry.released_at,
      sort_order: entry.sort_order,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
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
    } catch (e: any) {
      showToast('保存失败: ' + (e.message ?? e), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: ChangelogEntry) => {
    if (!confirm(`确认删除「${entry.title}」？`)) return;
    const { error } = await supabase.from('changelog').delete().eq('id', entry.id);
    if (error) { showToast('删除失败: ' + error.message, false); return; }
    logAction(adminEmail || 'unknown', 'CHANGELOG_DELETE', { code: entry.code, title: entry.title });
    showToast('已删除');
    if (editing?.id === entry.id) closeForm();
    await fetchEntries();
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
    const g: Record<string, ChangelogEntry[]> = {};
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
      <div className={`flex flex-1 flex-col overflow-hidden border-r border-zinc-200/60 ${showForm ? 'min-w-[380px] max-w-[460px]' : ''}`}>
        {/* 头部 */}
        <div className="shrink-0 flex items-center justify-between border-b border-zinc-200/60 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">更新日志</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">按模块管理系统的功能更新记录</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 active:scale-[0.98] transition-all"
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
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100" />)}
            </div>
          ) : entries.length === 0 ? (
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
                          className={`rounded-lg border px-3.5 py-2.5 transition-all group ${
                            isActive
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {/* 左侧内容区：点击打开编辑 */}
                            <button
                              onClick={() => openEdit(entry)}
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
                              {entry.description && (
                                <p className="text-[11px] text-zinc-500 line-clamp-1 leading-relaxed">{entry.description}</p>
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
                                onChange={e => { e.stopPropagation(); quickChangeStatus(entry, e.target.value as ChangelogEntry['status']); }}
                                onClick={e => e.stopPropagation()}
                                className={`rounded border-0 px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer outline-none ring-1 ring-inset ${staCfg.color} transition-all hover:brightness-95`}
                              >
                                <option value="planned">即将更新</option>
                                <option value="in_progress">开发中</option>
                                <option value="released">已上线</option>
                              </select>
                              {/* 编辑/删除（hover 显示） */}
                              <span
                                onClick={e => { e.stopPropagation(); openEdit(entry); }}
                                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                              >
                                <Pencil size={13} />
                              </span>
                              <span
                                onClick={e => { e.stopPropagation(); handleDelete(entry); }}
                                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={13} />
                              </span>
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
        <div className="flex w-[380px] shrink-0 flex-col overflow-hidden bg-zinc-50/50">
          {/* 表头 */}
          <div className="shrink-0 flex items-center justify-between border-b border-zinc-200/60 px-5 py-3">
            <h3 className="text-sm font-semibold text-zinc-800">
              {editing ? '编辑记录' : '新增记录'}
            </h3>
            <button onClick={closeForm} className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 transition-colors">
              <X size={16} />
            </button>
          </div>

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
                onClick={() => handleDelete(editing)}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                删除
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                onClick={closeForm}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim()}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                <Save size={13} />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 辅助组件 ── */

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
