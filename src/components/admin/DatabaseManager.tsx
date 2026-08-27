"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Maximize2, Minimize2 } from "lucide-react";

import { IconButton } from "@/src/components/ui";
import { supabase } from "@/src/services/supabaseClient";
import { GridPanel } from "./grid/GridPanel";
import { CORE_TABLE_CONFIGS, ALL_CORE_TABLE_NAMES } from "./tableConfigs";
import { discoverAutoTables } from "./schemaDiscovery";
import { BackupModal } from "./BackupModal";
import type { TableConfig, DictBundle } from "./types";

// ─── 字典缓存 ─────────────────────────────────────────────────────────────────
const DICT_CACHE_KEY = "__db_manager_dicts";
const DICT_CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存（建筑名/用户名变化频率低）

function getCachedDicts(): { dicts: DictBundle; timestamp: number } | null {
  try {
    const cached = sessionStorage.getItem(DICT_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}
  return null;
}

function setCachedDicts(dicts: DictBundle) {
  try {
    sessionStorage.setItem(DICT_CACHE_KEY, JSON.stringify({
      dicts,
      timestamp: Date.now(),
    }));
  } catch {}
}

// ─── 骨架屏组件 ──────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* Tab栏骨架 */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2 flex items-center gap-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-7 w-20 bg-zinc-200 rounded-lg" />
        ))}
      </div>
      {/* 工具栏骨架 */}
      <div className="shrink-0 px-4 py-3 flex items-center gap-3">
        <div className="h-9 w-56 bg-zinc-200 rounded-lg" />
        <div className="h-7 w-24 bg-zinc-200 rounded-lg" />
        <div className="ml-auto flex gap-2">
          <div className="h-8 w-16 bg-zinc-200 rounded-lg" />
          <div className="h-8 w-16 bg-zinc-200 rounded-lg" />
          <div className="h-8 w-20 bg-zinc-200 rounded-lg" />
        </div>
      </div>
      {/* 表格骨架 */}
      <div className="flex-1 px-4 pb-4">
        <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]">
          {/* 表头 */}
          <div className="h-11 bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-4 bg-zinc-200 rounded" style={{ width: `${80 + Math.random() * 60}px` }} />
            ))}
          </div>
          {/* 行 */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map(row => (
            <div key={row} className="h-9 border-b border-zinc-100 flex items-center px-4 gap-4">
              {[1, 2, 3, 4, 5, 6].map(col => (
                <div key={col} className="h-3.5 bg-zinc-100 rounded" style={{ width: `${60 + Math.random() * 80}px` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function DatabaseManager() {
  const [activeTab, setActiveTab] = React.useState(0);
  const [dicts, setDicts] = React.useState<DictBundle>({});
  const [autoTables, setAutoTables] = React.useState<TableConfig[]>([]);
  const [autoTableOpen, setAutoTableOpen] = React.useState(false);
  const autoTableBtnRef = React.useRef<HTMLButtonElement>(null);
  const autoTableDropdownRef = React.useRef<HTMLDivElement>(null);
  const [autoTablePos, setAutoTablePos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [selectedAutoTable, setSelectedAutoTable] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [dictsReady, setDictsReady] = React.useState(false);

  // 新增/编辑/删除 buildings 后刷新字典
  const refreshDicts = React.useCallback(async () => {
    const newDicts = await fetchBuildingDicts();
    setDicts(prev => ({ ...prev, ...newDicts }));
    setCachedDicts({ ...dicts, ...newDicts });
  }, [dicts]);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [backupOpen, setBackupOpen] = React.useState(false);

  // 已访问过的 tab 缓存
  const [visitedTabs, setVisitedTabs] = React.useState<Set<number>>(new Set([0]));

  React.useEffect(() => {
    void init();
  }, []);

  // 点击外部关闭"更多表"下拉
  React.useEffect(() => {
    if (!autoTableOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (autoTableBtnRef.current?.contains(target)) return;
      if (autoTableDropdownRef.current?.contains(target)) return;
      setAutoTableOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [autoTableOpen]);

  async function init() {
    setLoading(true);

    // 检查缓存
    const cached = getCachedDicts();
    if (cached && Date.now() - cached.timestamp < DICT_CACHE_TTL) {
      setDicts(cached.dicts);
      setDictsReady(true);
      setLoading(false); // 字典就绪立即显示，不等 autoTables
      // 后台静默刷新 autoTables
      discoverAutoTables(ALL_CORE_TABLE_NAMES).then(auto => setAutoTables(auto));
      return;
    }

    // 并行加载字典和表发现
    const [buildingDicts, userDict, auto] = await Promise.all([
      fetchBuildingDicts(),
      fetchUserDict(),
      discoverAutoTables(ALL_CORE_TABLE_NAMES),
    ]);

    const newDicts = { ...buildingDicts, user_roles: userDict };
    setDicts(newDicts);
    setDictsReady(true);
    setAutoTables(auto);
    setCachedDicts(newDicts);
    setLoading(false);
  }

  const handleTabChange = React.useCallback((idx: number) => {
    setActiveTab(idx);
    setSelectedAutoTable(null);
    setVisitedTabs(prev => new Set([...prev, idx]));
  }, []);

  // 将配置按 group 字段分组，用于渲染带层级分隔的标签栏
  const tabGroups = React.useMemo(() => {
    const result: { groupKey: string; configs: TableConfig[]; startIdx: number }[] = [];
    for (let i = 0; i < CORE_TABLE_CONFIGS.length; i++) {
      const cfg = CORE_TABLE_CONFIGS[i];
      const gk = cfg.group ?? `__nogroup_${cfg.table}`;
      const last = result[result.length - 1];
      if (last && last.groupKey === gk) {
        last.configs.push(cfg);
      } else {
        result.push({ groupKey: gk, configs: [cfg], startIdx: i });
      }
    }
    return result;
  }, []);

  // 初始加载：显示骨架屏
  if (loading && !dictsReady) {
    return <TableSkeleton />;
  }

  return (
    <div
      className={`flex flex-col h-full min-h-0 overflow-hidden w-full ${
        isFullscreen ? "fixed inset-0 z-50 bg-zinc-50" : ""
      }`}
    >
      {/* Tab 栏 — 左右分栏：左=建筑类，右=数据类，竖线分隔 */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2 flex items-center gap-2">
        {/* ── 左半区：项目台账 + 建筑三表 ── */}
        <div className="flex items-center gap-1">
          {(() => {
            const PALETTE = [
              { active: "bg-[var(--cd-color-brand)] text-white", inactive: "text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]" },
              { active: "bg-[var(--cd-color-brand)] text-white", inactive: "text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]" },
            ];
            const leftGroups = tabGroups.slice(0, 2);
            return leftGroups.map((group, gi) => {
              const color = PALETTE[gi % PALETTE.length];
              return (
                <React.Fragment key={group.groupKey}>
                  {gi > 0 && (
                    <span className="inline-block w-px h-5 bg-zinc-200 self-center mx-1 shrink-0" />
                  )}
                  <div className={`flex items-center ${group.configs.length > 1 ? 'gap-0.5' : ''}`}>
                    {group.configs.map((cfg) => {
                      const idx = CORE_TABLE_CONFIGS.indexOf(cfg);
                      const isActive = activeTab === idx && !selectedAutoTable;
                      return (
                        <button
                          key={cfg.table}
                          onClick={() => handleTabChange(idx)}
                          className={`h-8 shrink-0 rounded-[var(--cd-radius-md)] px-3 text-xs font-medium transition-colors ${
                            isActive ? color.active : color.inactive
                          }`}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </React.Fragment>
              );
            });
          })()}
        </div>

        {/* 左右分隔线 */}
        <span className="inline-block w-px h-5 bg-zinc-300 self-center mx-1 shrink-0" />

        {/* ── 右半区：数据表与租赁成交 ── */}
        <div className="flex items-center gap-1">
          {(() => {
            const PALETTE = [
              { active: "bg-[var(--cd-color-brand)] text-white", inactive: "text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]" },
              { active: "bg-[var(--cd-color-brand)] text-white", inactive: "text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]" },
              { active: "bg-[var(--cd-color-brand)] text-white", inactive: "text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]" },
            ];
            const rightGroups = tabGroups.slice(2);
            return rightGroups.map((group, gi) => {
              const color = PALETTE[gi % PALETTE.length];
              return (
                <React.Fragment key={group.groupKey}>
                  {gi > 0 && (
                    <span className="inline-block w-px h-5 bg-zinc-200 self-center mx-1 shrink-0" />
                  )}
                  <div className={`flex items-center ${group.configs.length > 1 ? 'gap-0.5' : ''}`}>
                    {group.configs.map((cfg) => {
                      const idx = CORE_TABLE_CONFIGS.indexOf(cfg);
                      const isActive = activeTab === idx && !selectedAutoTable;
                      return (
                        <button
                          key={cfg.table}
                          onClick={() => handleTabChange(idx)}
                          className={`h-8 shrink-0 rounded-[var(--cd-radius-md)] px-3 text-xs font-medium transition-colors ${
                            isActive ? color.active : color.inactive
                          }`}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </React.Fragment>
              );
            });
          })()}

          {/* 更多表下拉 */}
          {autoTables.length > 0 && (
            <div className="ml-1">
              <button
                ref={autoTableBtnRef}
                onClick={() => {
                  if (!autoTableOpen && autoTableBtnRef.current) {
                    const rect = autoTableBtnRef.current.getBoundingClientRect();
                    setAutoTablePos({ top: rect.bottom + 4, left: rect.left });
                  }
                  setAutoTableOpen((v) => !v);
                }}
                className={`h-8 rounded-[var(--cd-radius-md)] border px-3 text-xs font-medium transition-colors ${
                  selectedAutoTable
                    ? "bg-[#003e7e] text-white border-[#003e7e]"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {selectedAutoTable
                  ? (autoTables.find((t) => t.table === selectedAutoTable)
                      ?.label ?? selectedAutoTable)
                  : `更多表 (${autoTables.length})`}
                <svg
                  className="inline-block ml-1 w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {autoTableOpen && createPortal(
                <div
                  ref={autoTableDropdownRef}
                  style={{ position: "fixed", top: autoTablePos.top, left: autoTablePos.left, zIndex: 99999 }}
                  className="max-h-72 w-64 overflow-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-popover)]"
                >
                  {autoTables.map((t) => (
                    <button
                      key={t.table}
                      onClick={() => {
                        setSelectedAutoTable(t.table);
                        setAutoTableOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 transition ${
                        selectedAutoTable === t.table
                          ? "bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)] font-medium"
                          : "text-zinc-700"
                      }`}
                    >
                      <span className="font-medium">{t.label}</span>
                      <span className="ml-2 text-zinc-400 font-mono">
                        {t.table}
                      </span>
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
          )}

          {/* 全屏切换 */}
          <IconButton
            onClick={() => setIsFullscreen((v) => !v)}
            className="ml-1"
            variant="ghost"
            size="sm"
            label={isFullscreen ? "退出全屏" : "全屏"}
          >
            {isFullscreen ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )}
          </IconButton>

          {/* 数据备份 */}
          <IconButton
            onClick={() => setBackupOpen(true)}
            variant="ghost"
            size="sm"
            label="数据备份"
          >
            <Download size={14} />
          </IconButton>
        </div>
      </div>

      {/* 表格内容 - 已访问的 tab 保持挂载（避免切标签重复加载数据） */}
      <div className="flex-1 min-h-0 p-4 overflow-hidden w-full">
        {CORE_TABLE_CONFIGS.map((cfg, idx) => {
          const tabKey = (cfg as any).tabKey ?? cfg.table;
          if (!visitedTabs.has(idx)) return null;
          return (
            <div key={tabKey} style={{ display: activeTab === idx && !selectedAutoTable ? undefined : 'none', height: '100%' }}>
              <GridPanel config={cfg} dicts={dicts} onRefreshDicts={refreshDicts} />
            </div>
          );
        })}
        {selectedAutoTable && autoTables.filter(t => t.table === selectedAutoTable).map(t => (
          <div key={t.table} style={{ height: '100%' }}>
            <GridPanel config={t} dicts={dicts} />
          </div>
        ))}
      </div>

      {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} />}
    </div>
  );
}

// ─── 字典获取 ─────────────────────────────────────────────────────────────────

async function fetchBuildingDicts(): Promise<{
  buildings: Record<string, string>;
  building_submarkets: Record<string, string>;
  building_grades: Record<string, string>;
  active_building_ids: Record<string, string>;
  building_former_names: Record<string, string>;
}> {
  const { data } = await supabase
    .from("buildings")
    .select("id, name, submarket, grade, is_active, former_names")
    .limit(2000);
  const GRADE_LABELS: Record<string, string> = {
    A: "甲级",
    P: "甲级",
    B: "乙级",
    BP: "产业园",
  };
  const buildings: Record<string, string> = {};
  const building_submarkets: Record<string, string> = {};
  const building_grades: Record<string, string> = {};
  const active_building_ids: Record<string, string> = {};
  const building_former_names: Record<string, string> = {};
  if (data)
    for (const r of data) {
      buildings[r.id] = r.name;
      if (r.submarket) building_submarkets[r.id] = r.submarket;
      if (r.grade) building_grades[r.id] = GRADE_LABELS[r.grade] ?? r.grade;
      if (r.is_active) active_building_ids[r.id] = "1";
      // 构建曾用名 → building_id 的反向映射
      if (Array.isArray(r.former_names)) {
        for (const fn of r.former_names) {
          if (fn && !building_former_names[fn]) {
            building_former_names[fn] = r.id;
          }
        }
      }
    }
  return { buildings, building_submarkets, building_grades, active_building_ids, building_former_names };
}

async function fetchUserDict(): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("user_roles")
    .select("user_id, chinese_name, full_name")
    .limit(2000);
  const dict: Record<string, string> = {};
  if (data)
    for (const r of data)
      dict[r.user_id] = r.chinese_name || r.full_name || r.user_id;
  return dict;
}
