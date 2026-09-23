"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/src/services/supabaseClient";
import { GenericTablePanel } from "./GenericTablePanel";
import { ASSIGNMENTS_CONFIG, FUTURE_SUPPLY_ASSIGNMENTS_CONFIG } from "./tableConfigs";
import { BuildingSortManager } from "./BuildingSortManager";
import { MaskedText } from "@/src/components/demo";
import { SubmissionGrid, ProgressRenderer, DateRenderer } from "./SubmissionGrid";
import type { TableConfig, DictBundle } from "./types";
import type { ColDef as AgColDef } from 'ag-grid-community';
import { Button } from '@/src/components/ui';
import { logAction } from '@/src/utils/audit';

const compactSelectClassName = 'h-[var(--cd-control-height-sm)] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-xs outline-none transition-colors focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]';

// 子市场排序配置（与 BuildingSortManager 保持一致，键名用数据库 grade 值）
const SUBMARKET_ORDER: Record<string, string[]> = {
  A: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  P: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  B: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '其他'],
  BP: ['望京-酒仙桥', '丰台科技园', '上地', '亦庄', '北清路', '通惠河传媒走廊', '其他'],
};

// 等级分组顺序：P(超甲) → A(甲级) → B(乙级) → BP(产业园)
const GRADE_GROUP_ORDER = ['P', 'A', 'B', 'BP'];
const GRADE_LABELS: Record<string, string> = { P: '超甲级', A: '甲级', B: '乙级', BP: '产业园' };
// dicts.building_grades 存原始 grade code（A/B/P/BP），resolveGradeCode 兼容旧的中文标签
const GRADE_LABEL_TO_CODE: Record<string, string> = { '甲级': 'A', '乙级': 'B', '产业园': 'BP', '超甲级': 'P', '超甲级(Premium)': 'P' };
function resolveGradeCode(raw: string): string {
  return GRADE_LABEL_TO_CODE[raw] ?? raw;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function getCurrentQuarter() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    quarter: Math.ceil((now.getMonth() + 1) / 3),
  };
}

// ─── 填报进度（进度概览 + 用户明细 + 上传记录，按季度筛选）───────────────────

interface UserStat {
  user_id: string;
  user_name: string;
  total_submissions: number;
  last_submission: string | null;
  assigned_buildings: number;
}

interface UploadSession {
  date: string;
  time_range: string;
  building_count: number;
  session_index: number;
  timestamps: string[];
  gradeSummary: string;
}

function SubmissionProgressSection({ dicts }: { dicts: DictBundle }) {
  const dq = getCurrentQuarter();
  const [year, setYear] = React.useState(dq.year);
  const [quarter, setQuarter] = React.useState(dq.quarter);
  const [totalBuildings, setTotalBuildings] = React.useState(0);
  const [totalAssigned, setTotalAssigned] = React.useState(0);
  const [totalSubmitted, setTotalSubmitted] = React.useState(0);
  const [futureTotal, setFutureTotal] = React.useState(0);
  const [futureAssigned, setFutureAssigned] = React.useState(0);
  const [futureSubmitted, setFutureSubmitted] = React.useState(0);
  const [stats, setStats] = React.useState<UserStat[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [cfgYear, setCfgYear] = React.useState(dq.year);
  const [cfgQuarter, setCfgQuarter] = React.useState(dq.quarter);
  const [saving, setSaving] = React.useState(false);
  const [expandedUser, setExpandedUser] = React.useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = React.useState<
    UploadSession[]
  >([]);
  const [expandedLoading, setExpandedLoading] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["current_submission_year", "current_submission_quarter"]);
      if (data) {
        for (const row of data) {
          if (row.key === "current_submission_year")
            setCfgYear(Number(row.value));
          if (row.key === "current_submission_quarter")
            setCfgQuarter(Number(row.value));
        }
      }
    })();
  }, []);

  async function handleSaveConfig() {
    setSaving(true);
    const results = await Promise.all([
      supabase
        .from("app_settings")
        .upsert(
          { key: "current_submission_year", value: String(cfgYear) },
          { onConflict: "key" },
        ),
      supabase
        .from("app_settings")
        .upsert(
          { key: "current_submission_quarter", value: String(cfgQuarter) },
          { onConflict: "key" },
        ),
    ]);
    const saveError = results.find(result => result.error)?.error;
    if (!saveError) {
      logAction(undefined, 'CONFIG_CHANGE', {
        config_area: 'quarterly_submission_period',
        config_name: '当前季度填报周期',
        year: cfgYear,
        quarter: cfgQuarter,
        target_name: `${cfgYear} Q${cfgQuarter} 季度填报周期`,
      });
    }
    setSaving(false);
  }

  React.useEffect(() => {
    void fetchData();
  }, [year, quarter]);

  function previewUserSubmission(stat: UserStat) {
    logAction(undefined, 'VIEW_USER_SUBMISSION', {
      subject_user_id: stat.user_id,
      subject_user_name: stat.user_name,
      year,
      quarter,
      target_name: stat.user_name || stat.user_id,
    });
    window.open(`/update?as=${stat.user_id}`, "_blank", "noopener,noreferrer");
  }

  async function fetchData() {
    setLoading(true);
    const [
      buildingsCount,
      futureSuppliesCount,
      assignsData,
      subsRpc,
      futureAssignsData,
      futureSubsData,
      usersRes,
      allAssignsRes,
    ] = await Promise.all([
      supabase
        .from("buildings")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("tracking_scope", "tracked")
        .eq("project_type", "stock"),
      supabase
        .from("future_supplies")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("building_assignments")
        .select("building_id")
        .neq("user_id", ""),
      // 数据库端去重，避免 1106 行被 PostgREST 1000 行上限截断
      supabase.rpc("get_quarterly_submission_summary", {
        p_year: year,
        p_quarter: quarter,
      }),
      supabase
        .from("future_supply_assignments")
        .select("future_supply_id"),
      supabase
        .from("future_supply_submissions")
        .select("future_supply_id")
        .eq("record_year", year)
        .eq("record_quarter", quarter),
      supabase.from("user_roles").select("user_id, chinese_name, full_name"),
      supabase
        .from("building_assignments")
        .select("user_id, building_id")
        .neq("user_id", ""),
    ]);

    setTotalBuildings(buildingsCount.count || 0);
    setFutureTotal(futureSuppliesCount.count || 0);

    // 存量楼宇分配去重
    const assignedSet = new Set<string>();
    for (const r of assignsData.data || []) assignedSet.add(r.building_id);
    setTotalAssigned(assignedSet.size);

    // 未来供应分配去重
    const futureAssignedSet = new Set<string>();
    for (const r of futureAssignsData.data || [])
      futureAssignedSet.add(r.future_supply_id);
    setFutureAssigned(futureAssignedSet.size);

    // 存量楼宇填报去重（RPC 已在数据库端去重，直接读取）
    const submittedSet = new Set<string>();
    const subsRpcData = (subsRpc.data || []) as { user_id: string; building_id: string; created_at: string }[];
    for (const r of subsRpcData) submittedSet.add(r.building_id);
    setTotalSubmitted(submittedSet.size);

    // 未来供应填报去重
    const futureSubmittedSet = new Set<string>();
    for (const r of futureSubsData.data || [])
      futureSubmittedSet.add(r.future_supply_id);
    setFutureSubmitted(futureSubmittedSet.size);

    const users = usersRes.data || [];
    const assigns = allAssignsRes.data || [];

    const userMap = new Map<
      string,
      {
        name: string;
        submitted: Set<string>;
        last: string | null;
        assigned: Set<string>;
      }
    >();
    for (const u of users) {
      userMap.set(u.user_id, {
        name: u.chinese_name || u.full_name || u.user_id,
        submitted: new Set(),
        last: null,
        assigned: new Set(),
      });
    }
    for (const a of assigns) {
      const entry = userMap.get(a.user_id);
      if (entry) entry.assigned.add(a.building_id);
    }
    for (const s of subsRpcData) {
      const entry = userMap.get(s.user_id);
      if (entry) {
        entry.submitted.add(s.building_id);
        if (!entry.last || s.created_at > entry.last) entry.last = s.created_at;
      }
    }

    setStats(
      Array.from(userMap.entries())
        .map(([uid, s]) => ({
          user_id: uid,
          user_name: s.name,
          total_submissions: s.submitted.size,
          last_submission: s.last,
          assigned_buildings: s.assigned.size,
        }))
        .filter((s) => s.assigned_buildings > 0)
        .sort((a, b) => a.user_name.localeCompare(b.user_name)),
    );
    setLoading(false);
  }

  async function handleExpandUser(userId: string) {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    setExpandedLoading(true);
    const { data } = await supabase
      .from("quarterly_submissions")
      .select("created_at, building_id")
      .eq("record_year", year)
      .eq("record_quarter", quarter)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // 按精确时间戳分组 —— 同一批提交的楼宇共享同一个 created_at
    const tsMap = new Map<string, Set<string>>();
    for (const row of data || []) {
      if (!tsMap.has(row.created_at)) tsMap.set(row.created_at, new Set());
      tsMap.get(row.created_at)!.add(row.building_id);
    }
    const batches: { timestamps: string[]; buildingIds: Set<string> }[] = [];
    for (const [ts, buildingIds] of tsMap) {
      batches.push({ timestamps: [ts], buildingIds });
    }
    // 按时间降序排列（最新的在前）
    batches.sort((a, b) => new Date(b.timestamps[0]).getTime() - new Date(a.timestamps[0]).getTime());

    // 最新的批次编号最大（第N次），最旧的编号最小（第1次）
    const totalCount = batches.length;
    const sessions: UploadSession[] = batches.map((batch, i) => {
      // 计算等级组成
      const gradeSet = new Set<string>();
      for (const bid of batch.buildingIds) {
        const code = resolveGradeCode(dicts.building_grades?.[bid] ?? '');
        if (code.includes('BP')) gradeSet.add('产业园');
        else if (code === 'A' || code === 'P') gradeSet.add('甲级');
        else if (code === 'B') gradeSet.add('乙级');
      }
      const gradeOrder = ['甲级', '乙级', '产业园'];
      const gradeSummary = gradeSet.size > 0
        ? '含' + gradeOrder.filter(g => gradeSet.has(g)).join('')
        : '';
      return buildSession(batch.timestamps, totalCount - i, batch.buildingIds.size, gradeSummary);
    });

    setExpandedSessions(sessions);
    setExpandedLoading(false);
  }

  function buildSession(
    timestamps: string[],
    sessionIndex: number,
    uniqueBuildingCount: number,
    gradeSummary: string,
  ): UploadSession {
    const first = new Date(timestamps[0]);
    const last = new Date(timestamps[timestamps.length - 1]);
    const dateStr = first.toLocaleDateString("zh-CN").replace(/\//g, "-");
    const timeStr =
      timestamps.length === 1
        ? first.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : `${first.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}~${last.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    return {
      date: dateStr,
      time_range: timeStr,
      building_count: uniqueBuildingCount,
      session_index: sessionIndex,
      timestamps,
      gradeSummary,
    };
  }

  async function handleDownloadSession(
    userId: string,
    userName: string,
    session: UploadSession,
  ) {
    const { data } = await supabase
      .from("quarterly_submissions")
      .select("*")
      .eq("record_year", year)
      .eq("record_quarter", quarter)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!data || data.length === 0) {
      alert("无数据");
      return;
    }

    // 用 session 的 timestamps 精确过滤（不按日期，避免同一天多次提交混淆）
    const tsSet = new Set(session.timestamps);
    const tsMin = Math.min(...session.timestamps.map(t => new Date(t).getTime()));
    const tsMax = Math.max(...session.timestamps.map(t => new Date(t).getTime()));

    // 先精确匹配 timestamps，如果匹配不到则回退到时间范围（处理毫秒精度差异）
    let filtered = data.filter(r => tsSet.has(r.created_at));
    if (filtered.length === 0) {
      filtered = data.filter(r => {
        const t = new Date(r.created_at).getTime();
        return t >= tsMin - 1000 && t <= tsMax + 1000;
      });
    }

    // 同一 session 内按 building_id 去重（保留最后一条）
    const deduped = new Map<string, typeof filtered[0]>();
    for (const r of filtered) {
      deduped.set(r.building_id, r);
    }
    const uniqueRows = Array.from(deduped.values());

    // 调试：打印排序前的字典状态
    console.group('🔽 下载排序调试');
    console.log('dicts.building_grades 条数:', Object.keys(dicts.building_grades || {}).length);
    console.log('dicts.building_submarkets 条数:', Object.keys(dicts.building_submarkets || {}).length);
    console.log('dicts.building_sort_orders 条数:', Object.keys(dicts.building_sort_orders || {}).length);
    for (const r of uniqueRows) {
      const g = dicts.building_grades?.[r.building_id];
      const sm = dicts.building_submarkets?.[r.building_id];
      const so = dicts.building_sort_orders?.[r.building_id];
      const name = dicts.buildings?.[r.building_id] || r.building_id;
      console.log(`  ${name}: grade=${g ?? '❌MISSING'} → code=${resolveGradeCode(g ?? '')}, submarket=${sm ?? '❌MISSING'}, sort_order=${so ?? '❌MISSING'}`);
    }
    console.groupEnd();

    // 按等级分组 → 子市场顺序 → sort_order 排序
    // P(超甲) 合并进 A(甲级)，按相同规则排序
    uniqueRows.sort((a, b) => {
      const rawA = resolveGradeCode(dicts.building_grades?.[a.building_id] ?? '');
      const rawB = resolveGradeCode(dicts.building_grades?.[b.building_id] ?? '');
      const gA = rawA === 'P' ? 'A' : rawA;
      const gB = rawB === 'P' ? 'A' : rawB;
      // 1. 先按等级分组
      const gIdxA = GRADE_GROUP_ORDER.indexOf(gA);
      const gIdxB = GRADE_GROUP_ORDER.indexOf(gB);
      const gPosA = gIdxA >= 0 ? gIdxA : GRADE_GROUP_ORDER.length;
      const gPosB = gIdxB >= 0 ? gIdxB : GRADE_GROUP_ORDER.length;
      if (gPosA !== gPosB) return gPosA - gPosB;
      // 2. 同等级内按子市场顺序（P 和 A 共享同一套 SUBMARKET_ORDER）
      const order = SUBMARKET_ORDER[rawA] ?? SUBMARKET_ORDER[gA] ?? [];
      const smA = dicts.building_submarkets?.[a.building_id] ?? '';
      const smB = dicts.building_submarkets?.[b.building_id] ?? '';
      const idxA = order.indexOf(smA);
      const idxB = order.indexOf(smB);
      const posA = idxA >= 0 ? idxA : order.length;
      const posB = idxB >= 0 ? idxB : order.length;
      if (posA !== posB) return posA - posB;
      // 3. 同子市场内按 sort_order
      const soA = Number(dicts.building_sort_orders?.[a.building_id] ?? 0);
      const soB = Number(dicts.building_sort_orders?.[b.building_id] ?? 0);
      return soA - soB;
    });

    // 调试：打印排序后的顺序
    console.log('🔽 排序后顺序:', uniqueRows.map((r, i) => {
      const name = dicts.buildings?.[r.building_id] || r.building_id;
      const g = resolveGradeCode(dicts.building_grades?.[r.building_id] ?? '');
      const sm = dicts.building_submarkets?.[r.building_id] ?? '';
      const so = dicts.building_sort_orders?.[r.building_id] ?? '';
      return `${i + 1}. ${name} [${g}/${sm}/${so}]`;
    }));

    // 构建 Excel 行：按等级分组，组间插入分隔行
    const excelRows: Record<string, any>[] = [];
    const COL_HEADERS = ['项目名称', '年份', '季度', '总面积', '报价租金', '物业费', '表面租金', '免租期', '净有效租金', '空置率', '空置面积', '业主', '物业', '备注', '提交时间'];

    // 按等级分组：P(超甲) 合并进 A(甲级)，不单独分组
    const groups = new Map<string, typeof uniqueRows>();
    for (const r of uniqueRows) {
      const raw = resolveGradeCode(dicts.building_grades?.[r.building_id] ?? '');
      const g = raw === 'P' ? 'A' : raw;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }

    for (const [grade, rows] of groups) {
      // 如果有多个等级分组，插入分隔行
      if (groups.size > 1) {
        const label = GRADE_LABELS[grade] ?? grade;
        const sepRow: Record<string, any> = {};
        sepRow['项目名称'] = `━━ ${label} ━━`;
        for (const col of COL_HEADERS) {
          if (col !== '项目名称') sepRow[col] = '';
        }
        excelRows.push(sepRow);
      }

      for (const r of rows) {
        excelRows.push({
          项目名称: dicts.buildings?.[r.building_id] || r.building_id,
          年份: r.record_year,
          季度: r.record_quarter,
          总面积: r.total_area,
          报价租金: r.asking_rent,
          物业费: r.management_fee,
          表面租金: r.face_rent,
          免租期: r.rent_free_period,
          净有效租金: r.net_effective_rent,
          空置率: r.vacancy_rate,
          空置面积: r.vacant_area,
          业主: r.owner,
          物业: r.property_management,
          备注: r.notes,
          提交时间: new Date(r.created_at).toLocaleString("zh-CN", { hour12: false }),
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(excelRows);

    // 设置列宽
    ws['!cols'] = [
      { wch: 24 }, // 项目名称
      { wch: 6 },  // 年份
      { wch: 6 },  // 季度
      { wch: 10 }, // 总面积
      { wch: 10 }, // 报价租金
      { wch: 8 },  // 物业费
      { wch: 10 }, // 表面租金
      { wch: 10 }, // 免租期
      { wch: 12 }, // 净有效租金
      { wch: 8 },  // 空置率
      { wch: 10 }, // 空置面积
      { wch: 20 }, // 业主
      { wch: 16 }, // 物业
      { wch: 30 }, // 备注
      { wch: 20 }, // 提交时间
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "填报数据");
    const firstTs = new Date(session.timestamps[session.timestamps.length - 1]);
    const dateNum = `${firstTs.getFullYear()}${String(firstTs.getMonth() + 1).padStart(2, '0')}${String(firstTs.getDate()).padStart(2, '0')}`;
    const timeNum = `${String(firstTs.getHours()).padStart(2, '0')}${String(firstTs.getMinutes()).padStart(2, '0')}`;
    const gradePart = session.gradeSummary ? `_${session.gradeSummary}` : '';
    const filename = `${dateNum}_${userName}_第${session.session_index}次_${timeNum}${gradePart}.xlsx`;
    XLSX.writeFile(wb, filename);
    logAction(undefined, 'EXPORT_DATA', {
      export_type: 'quarterly_submission_session',
      record_count: uniqueRows.length,
      file_name: filename,
      subject_user_id: userId,
      subject_user_name: userName,
      year,
      quarter,
      session_index: session.session_index,
      target_name: filename,
    });
  }

  const completionRate =
    totalAssigned > 0 ? Math.round((totalSubmitted / totalAssigned) * 100) : 0;
  const pending = Math.max(0, totalAssigned - totalSubmitted);
  const unassigned = Math.max(0, totalBuildings - totalAssigned);
  const years = Array.from({ length: 5 }, (_, i) => dq.year - 2 + i);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto">
      {/* 当前填报季度设置 */}
      <div className="mb-4 flex shrink-0 items-center gap-3 rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] p-3">
        <span className="text-xs font-semibold text-[var(--cd-color-brand)]">
          当前填报季度
        </span>
        <select
          value={cfgYear}
          onChange={(e) => setCfgYear(Number(e.target.value))}
          className={compactSelectClassName}
        >
          {[dq.year - 1, dq.year, dq.year + 1].map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={cfgQuarter}
          onChange={(e) => setCfgQuarter(Number(e.target.value))}
          className={compactSelectClassName}
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={handleSaveConfig} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
        <span className="ml-2 text-xs text-[var(--cd-color-text-secondary)]">
          填报页面将显示此季度
        </span>
      </div>

      {/* 季度选择器 */}
      <div className="shrink-0 flex items-center gap-3 mb-4">
        <span className="text-xs text-zinc-500">查看季度</span>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={compactSelectClassName}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className={compactSelectClassName}
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        </div>
      ) : (
        <>
          {/* 进度卡片 */}
          <div className="shrink-0 grid grid-cols-5 gap-4 mb-6">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="text-xs text-zinc-500 mb-1">已分配楼宇（去重）</p>
              <p className="text-2xl font-bold text-zinc-800">
                {totalAssigned}
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs text-rose-600 mb-1">未分配楼宇</p>
              <p className="text-2xl font-bold text-rose-700">{unassigned}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs text-emerald-600 mb-1">
                {year}Q{quarter} 已填报
              </p>
              <p className="text-2xl font-bold text-emerald-700">
                {totalSubmitted}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs text-amber-600 mb-1">
                {year}Q{quarter} 未填报
              </p>
              <p className="text-2xl font-bold text-amber-700">{pending}</p>
            </div>
            <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
              <p className="mb-1 text-xs text-[var(--cd-color-text-secondary)]">完成率</p>
              <p className="text-2xl font-bold text-[var(--cd-color-brand)]">
                {completionRate}%
              </p>
            </div>
          </div>

          {/* 未来供应项目迷你看板 */}
          {futureTotal > 0 && (
            <div className="mb-4 shrink-0 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-3">
              <span className="text-xs font-medium text-[var(--cd-color-text-secondary)]">
                未来供应项目
              </span>
              <div className="mt-1.5 flex gap-4 text-xs text-[var(--cd-color-text-secondary)]">
                <span>
                  共{" "}
                  <b className="text-[var(--cd-color-text-primary)]">{futureTotal}</b> 个
                </span>
                <span>
                  已分配{" "}
                  <b className="text-[var(--cd-color-text-primary)]">{futureAssigned}</b>
                </span>
                <span>
                  {year}Q{quarter} 已填报{" "}
                  <b className="text-[var(--cd-color-text-primary)]">{futureSubmitted}</b>
                </span>
              </div>
            </div>
          )}

          {/* 用户明细表（可展开查看上传记录） */}
          <div className="min-h-0 flex-1 overflow-auto rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)]">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b-2 border-zinc-200">
                  <th className="w-8 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500"></th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">用户</th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">分配楼宇</th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">
                    {year}Q{quarter} 已提交
                  </th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">完成率</th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">最近提交</th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {stats.map((s) => {
                  const rate =
                    s.assigned_buildings > 0
                      ? Math.round(
                          (s.total_submissions / s.assigned_buildings) * 100,
                        )
                      : 0;
                  const isExpanded = expandedUser === s.user_id;
                  return (
                    <React.Fragment key={s.user_id}>
                      <tr className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => void handleExpandUser(s.user_id)}
                            className="text-zinc-400 hover:text-zinc-600 transition-transform"
                            style={{
                              transform: isExpanded ? "rotate(90deg)" : "none",
                            }}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-zinc-800">
                          <MaskedText>{s.user_name}</MaskedText>
                        </td>
                        <td className="px-4 py-3 text-zinc-600">{s.assigned_buildings}</td>
                        <td className="px-4 py-3 text-zinc-600">{s.total_submissions}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden max-w-[80px]">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min(100, rate)}%`,
                                  backgroundColor: rate >= 100 ? '#10b981' : rate > 0 ? '#f59e0b' : '#e5e7eb',
                                }}
                              />
                            </div>
                            <span
                              className={`text-xs font-semibold ${rate >= 100 ? "text-emerald-600" : rate > 0 ? "text-amber-600" : "text-zinc-400"}`}
                            >
                              {rate}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500">
                          {s.last_submission
                            ? new Date(s.last_submission).toLocaleString(
                                "zh-CN",
                                { hour12: false },
                              )
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => previewUserSubmission(s)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-[#003e7e] text-white hover:bg-[#002d5e] transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            预览
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-gradient-to-r from-zinc-50 to-zinc-100/50 px-6 py-4 border-t border-zinc-200">
                            {expandedLoading ? (
                              <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-500" />
                                加载中...
                              </div>
                            ) : expandedSessions.length === 0 ? (
                              <div className="text-xs text-zinc-400 py-2 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                                本季度暂无提交记录
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs font-medium text-zinc-500 mb-2">上传记录（点击下载）</p>
                                <div className="flex flex-wrap gap-2">
                                  {expandedSessions.map((ses, idx) => (
                                    <button
                                      key={idx}
                                      onClick={() =>
                                        void handleDownloadSession(
                                          s.user_id,
                                          s.user_name,
                                          ses,
                                        )
                                      }
                                      className="inline-flex items-center gap-2 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 text-xs transition-colors hover:border-[var(--cd-color-brand)] hover:bg-[var(--cd-color-brand-soft)]"
                                    >
                                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#003e7e] text-white text-[10px] font-bold">
                                        {ses.session_index}
                                      </span>
                                      <div className="flex flex-col items-start">
                                        <span className="text-zinc-800 font-medium">
                                          {(() => { const d = new Date(ses.timestamps[ses.timestamps.length - 1]); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()}
                                        </span>
                                        <span className="text-zinc-400 text-[10px]">
                                          {new Date(ses.timestamps[ses.timestamps.length - 1]).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                                          {ses.gradeSummary && ` · ${ses.gradeSummary}`}
                                          {` · ${ses.building_count}项`}
                                        </span>
                                      </div>
                                      <svg className="w-4 h-4 text-zinc-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 填报数据（提交数据 + 操作日志，按季度/用户筛选）──────────────────────────

function SubmissionDataSection({ dicts }: { dicts: DictBundle }) {
  const dq = getCurrentQuarter();
  const [year, setYear] = React.useState(dq.year);
  const [quarter, setQuarter] = React.useState(dq.quarter);
  const [userId, setUserId] = React.useState("all");
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showLog, setShowLog] = React.useState(false);
  const [logRows, setLogRows] = React.useState<any[]>([]);
  const [logLoading, setLogLoading] = React.useState(false);

  // AG Grid 列定义
  const dataColumns = React.useMemo<AgColDef[]>(() => [
    { headerName: '#', field: 'index', width: 60, valueGetter: (params: any) => (params.node?.rowIndex ?? 0) + 1 },
    { headerName: '项目名称', field: 'building_id', width: 180, valueFormatter: (params: any) => dicts.buildings?.[params.value] || params.value?.slice(0, 8) || '-' },
    { headerName: '填写人', field: 'user_id', width: 120, valueFormatter: (params: any) => dicts.user_roles?.[params.value] || params.data?.user_name || '-' },
    { headerName: '总面积', field: 'total_area', width: 100, type: 'numericColumn', valueFormatter: (params: any) => params.value?.toLocaleString() ?? '-' },
    { headerName: '报价租金', field: 'asking_rent', width: 100, type: 'numericColumn', valueFormatter: (params: any) => params.value?.toLocaleString() ?? '-' },
    { headerName: '物业费', field: 'management_fee', width: 90, type: 'numericColumn', valueFormatter: (params: any) => params.value?.toLocaleString() ?? '-' },
    { headerName: '表面租金', field: 'face_rent', width: 100, type: 'numericColumn' },
    { headerName: '免租期', field: 'rent_free_period', width: 90, type: 'numericColumn' },
    { headerName: '净有效租金', field: 'net_effective_rent', width: 110, type: 'numericColumn', cellStyle: { fontWeight: 'bold', color: '#003e7e' }, valueFormatter: (params: any) => params.value?.toFixed(1) ?? '-' },
    { headerName: '空置率', field: 'vacancy_rate', width: 90, type: 'numericColumn', valueFormatter: (params: any) => params.value != null ? `${params.value}%` : '-' },
    { headerName: '空置面积', field: 'vacant_area', width: 100, type: 'numericColumn', valueFormatter: (params: any) => params.value?.toLocaleString() ?? '-' },
    { headerName: '业主', field: 'owner', width: 120 },
    { headerName: '物业', field: 'property_management', width: 120 },
    { headerName: '备注', field: 'notes', width: 150 },
    { headerName: '提交时间', field: 'created_at', width: 160, cellRenderer: DateRenderer },
  ], [dicts]);

  React.useEffect(() => {
    void fetchData();
  }, [year, quarter, userId]);

  async function fetchData() {
    setLoading(true);
    let q = supabase
      .from("quarterly_submissions")
      .select("*")
      .eq("record_year", year)
      .eq("record_quarter", quarter)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (userId !== "all") q = q.eq("user_id", userId);
    const { data } = await q;
    setRows(data || []);
    setLoading(false);
  }

  async function fetchLog() {
    if (showLog) {
      setShowLog(false);
      return;
    }
    setShowLog(true);
    if (logRows.length > 0) return;
    setLogLoading(true);
    let q = supabase
      .from("quarterly_updates")
      .select("*")
      .eq("tab", `${year}Q${quarter}`)
      .order("created_at", { ascending: false })
      .limit(500);
    const { data } = await q;
    setLogRows(data || []);
    setLogLoading(false);
  }

  function handleExport() {
    if (rows.length === 0) {
      alert("当前筛选无数据");
      return;
    }
    // 调试
    console.group('🔽 导出排序调试');
    for (const r of rows) {
      const name = dicts.buildings?.[r.building_id] || r.building_id;
      const g = dicts.building_grades?.[r.building_id];
      const sm = dicts.building_submarkets?.[r.building_id];
      const so = dicts.building_sort_orders?.[r.building_id];
      console.log(`  ${name}: grade=${g ?? '❌'} sm=${sm ?? '❌'} so=${so ?? '❌'}`);
    }
    console.groupEnd();

    // 按等级分组 → 子市场顺序 → sort_order 排序
    const sorted = [...rows].sort((a, b) => {
      const gA = resolveGradeCode(dicts.building_grades?.[a.building_id] ?? '');
      const gB = resolveGradeCode(dicts.building_grades?.[b.building_id] ?? '');
      const gIdxA = GRADE_GROUP_ORDER.indexOf(gA);
      const gIdxB = GRADE_GROUP_ORDER.indexOf(gB);
      const gPosA = gIdxA >= 0 ? gIdxA : GRADE_GROUP_ORDER.length;
      const gPosB = gIdxB >= 0 ? gIdxB : GRADE_GROUP_ORDER.length;
      if (gPosA !== gPosB) return gPosA - gPosB;
      const order = SUBMARKET_ORDER[gA] ?? [];
      const smA = dicts.building_submarkets?.[a.building_id] ?? '';
      const smB = dicts.building_submarkets?.[b.building_id] ?? '';
      const idxA = order.indexOf(smA);
      const idxB = order.indexOf(smB);
      const posA = idxA >= 0 ? idxA : order.length;
      const posB = idxB >= 0 ? idxB : order.length;
      if (posA !== posB) return posA - posB;
      const soA = Number(dicts.building_sort_orders?.[a.building_id] ?? 0);
      const soB = Number(dicts.building_sort_orders?.[b.building_id] ?? 0);
      return soA - soB;
    });
    const exportRows = sorted.map((r) => ({
      项目名称: dicts.buildings?.[r.building_id] || r.building_id,
      填写人: dicts.user_roles?.[r.user_id] || r.user_name || r.user_id,
      年份: r.record_year,
      季度: r.record_quarter,
      总面积: r.total_area,
      报价租金: r.asking_rent,
      物业费: r.management_fee,
      表面租金: r.face_rent,
      免租期: r.rent_free_period,
      净有效租金: r.net_effective_rent,
      空置率: r.vacancy_rate,
      空置面积: r.vacant_area,
      业主: r.owner,
      物业: r.property_management,
      备注: r.notes,
      提交时间: r.created_at
        ? new Date(r.created_at).toLocaleString("zh-CN", { hour12: false })
        : "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "填报数据");
    const userLabel =
      userId === "all"
        ? "全部"
        : (dicts.user_roles?.[userId] || userId).replace(/[\/\\:*?"<>|]/g, "_");
    const filename = `填报数据_${userLabel}_${year}Q${quarter}.xlsx`;
    XLSX.writeFile(wb, filename);
    logAction(undefined, 'EXPORT_DATA', {
      export_type: 'quarterly_submissions',
      record_count: exportRows.length,
      file_name: filename,
      subject_user_id: userId === 'all' ? null : userId,
      year,
      quarter,
      target_name: filename,
    });
  }

  const years = Array.from({ length: 5 }, (_, i) => dq.year - 2 + i);
  const userOptions = React.useMemo(() => {
    const list = Object.entries(dicts.user_roles || {}).map(([id, name]) => ({
      id,
      name,
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [dicts.user_roles]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* 筛选栏 */}
      <div className="shrink-0 flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium">季度</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={compactSelectClassName}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className={compactSelectClassName}
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium">用户</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={`${compactSelectClassName} min-w-[120px]`}
          >
            <option value="all">全部用户</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <span className="ml-auto text-xs text-zinc-400">
          {rows.length} 条记录
        </span>

        <Button size="sm" variant="secondary" onClick={handleExport}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出 Excel
        </Button>

        <button
          onClick={() => void fetchLog()}
          className={`text-xs px-3 py-1.5 rounded-lg border transition ${showLog ? "bg-zinc-100 border-zinc-400 text-zinc-700" : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"}`}
        >
          {showLog ? "收起操作日志" : "操作日志"}
        </button>
      </div>

      {/* 数据表 - AG Grid */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)]">
        <SubmissionGrid
          columns={dataColumns}
          data={rows}
          loading={loading}
          emptyMessage="当前筛选条件下没有提交记录"
        />
      </div>

      {/* 操作日志（可折叠） */}
      {showLog && (
        <div className="shrink-0 mt-3 rounded-lg border border-zinc-200 bg-zinc-50/50 overflow-hidden">
          <div className="px-4 py-2.5 bg-zinc-100 text-xs font-semibold text-zinc-600 border-b border-zinc-200">
            操作日志（{year}Q{quarter}）
          </div>
          <div className="max-h-60 overflow-auto">
            {logLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
              </div>
            ) : logRows.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-400">
                暂无操作记录
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-zinc-50">
                  <tr>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">用户</th>
                    <th className="px-3 py-2 font-medium">项目</th>
                    <th className="px-3 py-2 font-medium">数据摘要</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {logRows.map((r, i) => {
                    const payload = r.payload || {};
                    const summary =
                      [
                        payload.qQuote && `报价:${payload.qQuote}`,
                        payload.qFace && `面租:${payload.qFace}`,
                        payload.qFree && `免租:${payload.qFree}`,
                        payload.qVacArea && `空置:${payload.qVacArea}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "-";
                    return (
                      <tr key={r.id || i} className="hover:bg-zinc-50">
                        <td className="px-3 py-1.5 text-zinc-500">
                          {new Date(r.created_at).toLocaleString("zh-CN", {
                            hour12: false,
                          })}
                        </td>
                        <td className="px-3 py-1.5">{r.user_name || "-"}</td>
                        <td className="px-3 py-1.5">{r.project_name || "-"}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 草稿管理（自定义视图）───────────────────────────────────────────────────

const TAB_LABELS: Record<string, string> = {
  GradeA: "甲级",
  GradeB: "乙级",
  BP: "产业园",
};

interface DraftRow {
  id: number;
  user_name: string;
  tab: string;
  draft_data: Record<string, Record<string, string>>;
  updated_at: string;
}

function DraftSection({ dicts }: { dicts: DictBundle }) {
  const [rows, setRows] = React.useState<DraftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tabFilter, setTabFilter] = React.useState("all");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  React.useEffect(() => {
    void fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase
      .from("update_drafts")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    setRows((data || []) as DraftRow[]);
    setLoading(false);
  }

  function summarizeDraft(draft: Record<string, Record<string, string>>): {
    buildings: number;
    fields: string;
  } {
    if (!draft || typeof draft !== "object")
      return { buildings: 0, fields: "-" };
    const entries = Object.entries(draft).filter(
      ([, v]) =>
        v &&
        typeof v === "object" &&
        Object.values(v).some((val) => val && val !== ""),
    );
    if (entries.length === 0) return { buildings: 0, fields: "-" };
    const FIELD_LABELS: Record<string, string> = {
      qQuote: "报价",
      qProp: "物业费",
      qFace: "面租",
      qFree: "免租期",
      qVacArea: "空置面积",
      qOwner: "业主",
      qPropMan: "物业",
      qRemark: "备注",
    };
    const allFields = new Set<string>();
    for (const [, v] of entries) {
      for (const [k, val] of Object.entries(v)) {
        if (val && val !== "") allFields.add(FIELD_LABELS[k] || k);
      }
    }
    return {
      buildings: entries.length,
      fields: Array.from(allFields).join("、"),
    };
  }

  const filtered =
    tabFilter === "all" ? rows : rows.filter((r) => r.tab === tabFilter);
  const nonEmpty = filtered.filter(
    (r) => summarizeDraft(r.draft_data).buildings > 0,
  );
  const empty = filtered.filter(
    (r) => summarizeDraft(r.draft_data).buildings === 0,
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* 筛选栏 */}
      <div className="shrink-0 flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-xs text-zinc-500">分类</span>
        {["all", "GradeA", "GradeB", "BP"].map((t) => (
          <button
            key={t}
            onClick={() => setTabFilter(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              tabFilter === t
                ? "bg-[#003e7e] text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t === "all" ? "全部" : TAB_LABELS[t] || t}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-400">
          {nonEmpty.length} 条有数据 / {empty.length} 条为空
        </span>
        <button
          onClick={() => void fetchData()}
          className="text-xs border border-zinc-200 text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-50"
        >
          刷新
        </button>
      </div>

      {/* 有数据的草稿 */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-zinc-400">
            暂无草稿
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr>
                <th className="px-4 py-2.5 font-medium w-8"></th>
                <th className="px-4 py-2.5 font-medium">用户</th>
                <th className="px-4 py-2.5 font-medium">分类</th>
                <th className="px-4 py-2.5 font-medium">草稿状态</th>
                <th className="px-4 py-2.5 font-medium">已填字段</th>
                <th className="px-4 py-2.5 font-medium">最后更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {/* 有数据的排前面 */}
              {nonEmpty.map((r) => {
                const summary = summarizeDraft(r.draft_data);
                const isExpanded = expandedId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="hover:bg-zinc-50/80">
                      <td className="px-4 py-2">
                        <button
                          onClick={() =>
                            setExpandedId(isExpanded ? null : r.id)
                          }
                          className="text-zinc-400 hover:text-zinc-600 transition-transform"
                          style={{
                            transform: isExpanded ? "rotate(90deg)" : "none",
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="9 6 15 12 9 18" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-4 py-2 font-medium">{r.user_name}</td>
                      <td className="px-4 py-2">
                        <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--cd-color-text-secondary)]">
                          {r.tab}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-medium text-amber-600">
                          {summary.buildings} 栋有草稿
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500 max-w-[240px] truncate">
                        {summary.fields}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">
                        {new Date(r.updated_at).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-zinc-50/50 px-6 py-3">
                          <div className="text-xs text-zinc-500 mb-2 font-semibold">
                            草稿详情
                          </div>
                          <table className="w-full text-xs border border-zinc-200 rounded">
                            <thead className="bg-zinc-50">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  楼宇序号
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  报价
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  物业费
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  面租
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  免租期
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  空置面积
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  业主
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  物业
                                </th>
                                <th className="px-3 py-1.5 text-left font-medium">
                                  备注
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {Object.entries(r.draft_data)
                                .filter(
                                  ([, v]) =>
                                    v &&
                                    typeof v === "object" &&
                                    Object.values(v).some(
                                      (val) => val && val !== "",
                                    ),
                                )
                                .map(([idx, v]) => (
                                  <tr key={idx} className="hover:bg-zinc-50">
                                    <td className="px-3 py-1.5 text-zinc-400">
                                      #{Number(idx) + 1}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qQuote || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qProp || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qFace || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qFree || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qVacArea || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qOwner || "-"}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {v.qPropMan || "-"}
                                    </td>
                                    <td
                                      className="px-3 py-1.5 max-w-[120px] truncate"
                                      title={v.qRemark || ""}
                                    >
                                      {v.qRemark || "-"}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {/* 空草稿折叠显示 */}
              {empty.length > 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-3 text-xs text-zinc-400 bg-zinc-50/30"
                  >
                    <details>
                      <summary className="cursor-pointer hover:text-zinc-600">
                        空草稿（{empty.length} 条）
                      </summary>
                      <div className="mt-2 space-y-1">
                        {empty.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center gap-4 py-1"
                          >
                            <span className="font-medium text-zinc-600">
                              {dicts.user_roles?.[r.user_name] || r.user_name}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] rounded bg-zinc-100 text-zinc-500">
                              {TAB_LABELS[r.tab] || r.tab}
                            </span>
                            <span className="text-zinc-400">
                              {new Date(r.updated_at).toLocaleString("zh-CN", {
                                hour12: false,
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── 未来供应提交数据 ────────────────────────────────────────────────────────

function FutureSupplySubmissionsSection({ dicts }: { dicts: DictBundle }) {
  const dq = getCurrentQuarter();
  const [year, setYear] = React.useState(dq.year);
  const [quarter, setQuarter] = React.useState(dq.quarter);
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  // AG Grid 列定义
  const futureSupplyColumns = React.useMemo<AgColDef[]>(() => [
    { headerName: '#', field: 'index', width: 60, valueGetter: (params: any) => (params.node?.rowIndex ?? 0) + 1 },
    { headerName: '项目名称', field: 'future_supply_id', width: 180, valueFormatter: (params: any) => dicts.future_supplies?.[params.value] || params.value || '-' },
    { headerName: '提交人', field: 'user_id', width: 120, valueFormatter: (params: any) => dicts.user_roles?.[params.value] || params.data?.user_name || '-' },
    { headerName: '报价租金', field: 'asking_rent', width: 100, type: 'numericColumn' },
    { headerName: '物业费', field: 'management_fee', width: 90, type: 'numericColumn' },
    { headerName: '表面租金', field: 'face_rent', width: 100, type: 'numericColumn' },
    { headerName: '免租期', field: 'rent_free_period', width: 90, type: 'numericColumn' },
    { headerName: '净有效租金', field: 'net_effective_rent', width: 110, type: 'numericColumn', cellStyle: { fontWeight: 'bold', color: '#003e7e' } },
    { headerName: '空置面积', field: 'vacant_area', width: 100, type: 'numericColumn' },
    { headerName: '业主', field: 'owner', width: 120 },
    { headerName: '物业', field: 'property_management', width: 120 },
    { headerName: '备注', field: 'notes', width: 150 },
    { headerName: '提交时间', field: 'created_at', width: 160, cellRenderer: DateRenderer },
  ], [dicts]);

  React.useEffect(() => {
    void fetchData();
  }, [year, quarter]);

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase
      .from("future_supply_submissions")
      .select("*")
      .eq("record_year", year)
      .eq("record_quarter", quarter)
      .order("created_at", { ascending: false })
      .limit(500);
    setRows(data || []);
    setLoading(false);
  }

  const years = Array.from({ length: 5 }, (_, i) => dq.year - 2 + i);

  function handleExport() {
    if (rows.length === 0) return;
    const exportRows = rows.map((r) => ({
      项目名称: dicts.future_supplies?.[r.future_supply_id] || r.future_supply_id,
      提交人: dicts.user_roles?.[r.user_id] || r.user_name || "-",
      报价租金: r.asking_rent ?? "",
      物业费: r.management_fee ?? "",
      表面租金: r.face_rent ?? "",
      免租期: r.rent_free_period ?? "",
      净有效租金: r.net_effective_rent ?? "",
      空置面积: r.vacant_area ?? "",
      业主: r.owner || "",
      物业: r.property_management || "",
      备注: r.notes || "",
      提交时间: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN", { hour12: false }) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [
      { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "未来供应数据");
    const filename = `未来供应_${year}Q${quarter}.xlsx`;
    XLSX.writeFile(wb, filename);
    logAction(undefined, 'EXPORT_DATA', {
      export_type: 'future_supply_submissions',
      record_count: exportRows.length,
      file_name: filename,
      year,
      quarter,
      target_name: filename,
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 筛选栏 */}
      <div className="shrink-0 flex items-center gap-3 mb-4">
        <h3 className="text-sm font-semibold text-zinc-900">未来供应提交数据</h3>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-zinc-300 px-2 py-1 text-xs">
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} className="rounded border border-zinc-300 px-2 py-1 text-xs">
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </select>
        <span className="text-xs text-zinc-400">{rows.length} 条记录</span>
        {rows.length > 0 && (
          <button onClick={handleExport} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 bg-white text-xs font-medium hover:bg-zinc-50 hover:border-[#003e7e] transition">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            导出 Excel
          </button>
        )}
      </div>

      {/* 数据表 */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-sm">暂无未来供应提交数据</p>
          </div>
        ) : (
          <SubmissionGrid
            columns={futureSupplyColumns}
            data={rows}
            emptyMessage="暂无未来供应提交数据"
          />
        )}
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function SubmissionManager() {
  const [subTab, setSubTab] = React.useState<
    "assign" | "future-supply" | "progress" | "data" | "drafts" | "sort"
  >("assign");
  const [dicts, setDicts] = React.useState<DictBundle>({});
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    void (async () => {
      const [buildings, users, futureSupplies] = await Promise.all([
        supabase
          .from("buildings")
          .select("id, name, grade, submarket, sort_order")
          .eq("is_active", true)
          .eq("tracking_scope", "tracked")
          .limit(2000),
        supabase
          .from("user_roles")
          .select("user_id, chinese_name, full_name")
          .limit(2000),
        supabase
          .from("future_supplies")
          .select("id, name")
          .limit(2000),
      ]);
      const buildingDict: Record<string, string> = {};
      const gradeDict: Record<string, string> = {};
      const submarketDict: Record<string, string> = {};
      const sortOrderDict: Record<string, string> = {};
      if (buildings.data)
        for (const r of buildings.data) {
          buildingDict[r.id] = r.name;
          // 存原始 grade code（A/B/P/BP），不转中文——排序和逻辑判断依赖原始值
          if (r.grade) gradeDict[r.id] = r.grade;
          if (r.submarket) submarketDict[r.id] = r.submarket;
          sortOrderDict[r.id] = String(r.sort_order ?? 0);
        }
      const userDict: Record<string, string> = {};
      if (users.data)
        for (const r of users.data)
          userDict[r.user_id] = r.chinese_name || r.full_name || r.user_id;
      const futureSupplyDict: Record<string, string> = {};
      if (futureSupplies.data)
        for (const r of futureSupplies.data)
          futureSupplyDict[r.id] = r.name;
      setDicts({
        buildings: buildingDict,
        user_roles: userDict,
        building_grades: gradeDict,
        building_submarkets: submarketDict,
        building_sort_orders: sortOrderDict,
        future_supplies: futureSupplyDict,
      });
    })();
  }, []);

  const assignmentConfig: TableConfig = {
    ...ASSIGNMENTS_CONFIG,
    hideAdd: true,
    customFetch: async () => {
      const [buildingsRes, assignsRes] = await Promise.all([
        supabase.from("buildings").select("id, name, grade, submarket").eq("is_active", true).eq("tracking_scope", "tracked").limit(2000),
        supabase.from("building_assignments").select("*").limit(2000),
      ]);
      const assignMap = new Map<string, any>();
      for (const a of assignsRes.data || []) assignMap.set(a.building_id, a);
      const GRADE_LABELS: Record<string, string> = { A: "甲级", P: "甲级", B: "乙级", BP: "产业园" };
      const rows: Record<string, any>[] = [];
      for (const b of buildingsRes.data || []) {
        const assign = assignMap.get(b.id);
        if (assign) {
          rows.push(assign);
        } else {
          rows.push({
            id: `virtual-${b.id}`,
            _virtual: true,
            building_id: b.id,
            project_name: b.name,
            grade: GRADE_LABELS[b.grade] ?? b.grade ?? null,
            submarket: b.submarket ?? null,
            user_id: "",
            user_name: "",
          });
        }
      }
      return rows;
    },
    beforeSave: (row) => ({
      ...row,
      project_name: dicts.buildings?.[row.building_id] || row.project_name,
      grade: dicts.building_grades?.[row.building_id] || row.grade || null,
      submarket:
        dicts.building_submarkets?.[row.building_id] || row.submarket || null,
      user_name: dicts.user_roles?.[row.user_id] || row.user_name,
    }),
  };

  const futureSupplyAssignmentConfig: TableConfig = {
    ...FUTURE_SUPPLY_ASSIGNMENTS_CONFIG,
    beforeSave: (row) => ({
      ...row,
      user_name: dicts.user_roles?.[row.user_id] || row.user_name,
    }),
  };

  const tabs = [
    { key: "assign" as const, label: "任务分配" },
    { key: "progress" as const, label: "填报进度" },
    { key: "data" as const, label: "填报数据" },
    { key: "drafts" as const, label: "草稿管理" },
    { key: "future-supply" as const, label: "未来供应分配" },
    { key: "sort" as const, label: "楼宇排序" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden w-full bg-zinc-50">
      {/* Tab 栏 */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex w-fit items-center gap-1 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`rounded-[var(--cd-radius-md)] px-4 py-2 text-xs font-medium transition-colors ${
                subTab === t.key
                  ? "bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 p-4 overflow-hidden w-full">
        {subTab === "assign" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
            <GenericTablePanel
              key={refreshKey}
              config={assignmentConfig}
              dicts={dicts}
            />
          </div>
        )}
        {subTab === "future-supply" && (
          <div className="flex flex-col gap-4 h-full min-h-0 overflow-auto">
            <div className="shrink-0 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
              <GenericTablePanel
                key={refreshKey}
                config={futureSupplyAssignmentConfig}
                dicts={dicts}
              />
            </div>
            <div className="min-h-[400px] overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
              <FutureSupplySubmissionsSection dicts={dicts} />
            </div>
          </div>
        )}
        {subTab === "progress" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
            <SubmissionProgressSection dicts={dicts} />
          </div>
        )}
        {subTab === "data" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
            <SubmissionDataSection dicts={dicts} />
          </div>
        )}
        {subTab === "drafts" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
            <DraftSection dicts={dicts} />
          </div>
        )}
        {subTab === "sort" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
            <BuildingSortManager />
          </div>
        )}
      </div>
    </div>
  );
}
