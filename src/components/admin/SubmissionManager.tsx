"use client";

import * as React from "react";
import { supabase } from "@/src/services/supabaseClient";
import { GenericTablePanel } from "./GenericTablePanel";
import { ASSIGNMENTS_CONFIG, FUTURE_SUPPLY_ASSIGNMENTS_CONFIG } from "./tableConfigs";
import { BuildingSortManager } from "./BuildingSortManager";
import { MaskedText } from "@/src/components/demo";
import { SubmissionGrid, DateRenderer } from "./SubmissionGrid";
import type { TableConfig, DictBundle } from "./types";
import type { ColDef as AgColDef } from 'ag-grid-community';
import { Button } from '@/src/components/ui';
import { fetchAllSubmissionPages, submissionPageResult, draftEntries, draftProjectLabel, summarizeAdminDraft } from './submissionReliability';
import { useSubmissionRead, useSubmissionPeriod } from './useSubmissionRead';
import { logAction } from '@/src/utils/audit';
import { QuarterlyReportPanel } from './quarterly-report/QuarterlyReportPanel';

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

function ReadError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="my-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">读取失败：{message} <button type="button" className="underline" onClick={retry}>重试</button></div>;
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

function SubmissionProgressSection({ dicts, period }: { dicts: DictBundle; period: ReturnType<typeof useSubmissionPeriod> }) {
  const dq = getCurrentQuarter();
  const { year, quarter, setYear, setQuarter, configured } = period;
  const [cfgYear, setCfgYear] = React.useState(dq.year);
  const [cfgQuarter, setCfgQuarter] = React.useState(dq.quarter);
  const [saving, setSaving] = React.useState(false);
  const [expandedUser, setExpandedUser] = React.useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = React.useState<
    UploadSession[]
  >([]);
  const [expandedLoading, setExpandedLoading] = React.useState(false);

  React.useEffect(() => {
    if (configured.data) { setCfgYear(configured.data.year); setCfgQuarter(configured.data.quarter); }
  }, [configured.data]);

  const rollout = useSubmissionRead('quarterly-rollout-status', async () => {
    const { data, error } = await supabase.rpc('get_quarterly_rollout_status');
    if (error) throw error;
    const status = Array.isArray(data) ? data[0] : data;
    if (typeof status?.quarter_configuration_frozen !== 'boolean') throw new Error('无法确认季度切换是否开放');
    return status as { quarter_configuration_frozen: boolean };
  });
  const quarterChangesBlocked = rollout.loading || Boolean(rollout.error) || rollout.data?.quarter_configuration_frozen !== false;

  async function handleSaveConfig() {
    if (quarterChangesBlocked) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_current_submission_period_v2', {
        p_year: cfgYear,
        p_quarter: cfgQuarter,
      });
      if (error) throw error;
      logAction(undefined, 'CONFIG_CHANGE', {
        config_area: 'quarterly_submission_period',
        config_name: '当前季度填报周期',
        year: cfgYear,
        quarter: cfgQuarter,
        target_name: `${cfgYear} Q${cfgQuarter} 季度填报周期`,
      });
      setYear(cfgYear);
      setQuarter(cfgQuarter);
      configured.reload();
    } catch (error: any) {
      console.error('[SubmissionManager] failed to update submission period', error);
      if (error?.message?.includes('quarter_configuration_frozen')) rollout.reload();
      alert(error?.message?.includes('quarter_configuration_frozen')
        ? '版本切换保护期间，季度配置暂时冻结。草稿保存和提交不受影响。'
        : error?.message?.includes('submission_period_cannot_move_backward')
        ? '为避免误覆盖草稿，当前填报周期不允许直接向过去回退。'
        : `切换填报周期失败：${error?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  const progressKey = `${year}:Q${quarter}`;
  const progress = useSubmissionRead(progressKey, fetchData);
  const { totalBuildings = 0, totalAssigned = 0, totalSubmitted = 0, futureTotal = 0, futureAssigned = 0, futureSubmitted = 0, stats = [] } = progress.data || {};
  const loading = progress.loading;
  const sessionRequest = React.useRef(0);
  const [expandedKey, setExpandedKey] = React.useState('');
  const [expandedError, setExpandedError] = React.useState('');
  const [downloading, setDownloading] = React.useState(false);
  React.useEffect(() => { sessionRequest.current += 1; setExpandedUser(null); setExpandedSessions([]); setExpandedError(''); return () => { sessionRequest.current += 1; }; }, [year, quarter]);

  function previewUserSubmission(stat: UserStat) {
    logAction(undefined, 'VIEW_USER_SUBMISSION', {
      subject_user_id: stat.user_id,
      subject_user_name: stat.user_name,
      year: configured.data?.year ?? null,
      quarter: configured.data?.quarter ?? null,
      selected_statistics_year: year,
      selected_statistics_quarter: quarter,
      target_name: stat.user_name || stat.user_id,
    });
    window.open(`/update?as=${stat.user_id}`, "_blank", "noopener,noreferrer");
  }

  async function fetchData() {
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
      submissionPageResult((from, to) => supabase.from('buildings').select('id').eq('is_active', true).eq('tracking_scope', 'tracked').eq('project_type', 'stock').order('id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('future_supplies').select('id').eq('is_entered_market', false).eq('launch_year', String(year)).eq('launch_quarter', `Q${quarter}`).order('id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('building_assignments').select('building_id').neq('user_id', '').order('id').range(from, to)),
      submissionPageResult((from, to) => supabase.rpc('get_quarterly_submission_summary', { p_year: year, p_quarter: quarter }).order('building_id').order('user_id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('future_supply_assignments').select('future_supply_id').eq('record_year', year).eq('record_quarter', quarter).order('id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('future_supply_submissions').select('future_supply_id').eq('record_year', year).eq('record_quarter', quarter).order('id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('user_roles').select('user_id, chinese_name, full_name').order('user_id').range(from, to)),
      submissionPageResult((from, to) => supabase.from('building_assignments').select('user_id, building_id').neq('user_id', '').order('id').range(from, to)),
    ]);

    const activeBuildingIds = new Set(buildingsCount.data.map(row => row.id));
    const activeFutureSupplyIds = new Set<string>((futureSuppliesCount.data || []).map((row) => row.id));

    // 存量楼宇分配去重
    const assignedSet = new Set<string>();
    for (const r of assignsData.data || []) { if (activeBuildingIds.has(r.building_id)) assignedSet.add(r.building_id); }


    // 未来供应分配去重：只统计尚未进入存量市场的项目。
    const futureAssignedSet = new Set<string>();
    for (const r of futureAssignsData.data || []) {
      if (activeFutureSupplyIds.has(r.future_supply_id))
        futureAssignedSet.add(r.future_supply_id);
    }


    // 存量楼宇填报去重（RPC 已在数据库端去重，直接读取）
    const submittedSet = new Set<string>();
    const subsRpcData = (subsRpc.data || []) as { user_id: string; building_id: string; created_at: string }[];
    for (const r of subsRpcData) if (assignedSet.has(r.building_id)) submittedSet.add(r.building_id);


    // 未来供应填报去重：已转存量项目仅保留历史，不计入当前未来供应进度。
    const futureSubmittedSet = new Set<string>();
    for (const r of futureSubsData.data || []) {
      if (futureAssignedSet.has(r.future_supply_id))
        futureSubmittedSet.add(r.future_supply_id);
    }


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
      if (entry && activeBuildingIds.has(a.building_id)) entry.assigned.add(a.building_id);
    }
    for (const s of subsRpcData) {
      const entry = userMap.get(s.user_id);
      if (entry && entry.assigned.has(s.building_id)) {
        entry.submitted.add(s.building_id);
        if (!entry.last || s.created_at > entry.last) entry.last = s.created_at;
      }
    }

    const stats: UserStat[] = Array.from(userMap.entries())
        .map(([uid, s]) => ({
          user_id: uid,
          user_name: s.name,
          total_submissions: s.submitted.size,
          last_submission: s.last,
          assigned_buildings: s.assigned.size,
        }))
        .filter((s) => s.assigned_buildings > 0)
        .sort((a, b) => a.user_name.localeCompare(b.user_name));
    return { totalBuildings: buildingsCount.count, futureTotal: futureSuppliesCount.count, totalAssigned: assignedSet.size, futureAssigned: futureAssignedSet.size, totalSubmitted: submittedSet.size, futureSubmitted: futureSubmittedSet.size, stats };
  }

  async function handleExpandUser(userId: string, force = false) {
    const request = ++sessionRequest.current;
    if (!force && expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    setExpandedKey(progressKey);
    setExpandedSessions([]);
    setExpandedError('');
    setExpandedLoading(true);
    try {
      const data = await fetchAllSubmissionPages<any>((from, to) => supabase.from('quarterly_submissions').select('created_at, building_id').eq('record_year', year).eq('record_quarter', quarter).eq('user_id', userId).order('created_at', { ascending: false }).order('id').range(from, to));
      if (request !== sessionRequest.current) return;

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
    } catch (error) {
      if (request === sessionRequest.current) setExpandedError(error instanceof Error ? error.message : '上传记录读取失败');
    } finally { if (request === sessionRequest.current) setExpandedLoading(false); }
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
    const request = sessionRequest.current;
    if (downloading || expandedKey !== progressKey || expandedUser !== userId) return;
    setDownloading(true);
    try {
    const data = await fetchAllSubmissionPages<any>((from, to) => supabase.from('quarterly_submissions').select('*').eq('record_year', year).eq('record_quarter', quarter).eq('user_id', userId).in('created_at', session.timestamps).order('created_at').order('id').range(from, to));
    if (request !== sessionRequest.current) return;
    if (!data.length) throw new Error('该批次无可下载记录，请重新加载上传记录');
    const filtered = data;

    // 同一 session 内按 building_id 去重（保留最后一条）
    const deduped = new Map<string, typeof filtered[0]>();
    for (const r of filtered) {
      deduped.set(r.building_id, r);
    }
    const uniqueRows = Array.from(deduped.values());

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

    const XLSX = await import('xlsx');
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
    const safeUserName = userName.replace(/[\/\\:*?"<>|]/g, "_");
    const filename = `${year}Q${quarter}_${dateNum}_${safeUserName}_第${session.session_index}次_${timeNum}${gradePart}.xlsx`;
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
    } catch (error) { if (request === sessionRequest.current) alert(`下载失败：${error instanceof Error ? error.message : '未知错误'}`); }
    finally { setDownloading(false); }
  }

  const completionRate =
    totalAssigned > 0 ? Math.round((totalSubmitted / totalAssigned) * 100) : 0;
  const pending = Math.max(0, totalAssigned - totalSubmitted);
  const unassigned = Math.max(0, totalBuildings - totalAssigned);
  const years = [...new Set([...Array.from({ length: 5 }, (_, i) => dq.year - 2 + i), year, configured.data?.year ?? year])].sort();

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto">
      {configured.error && <ReadError message={`默认季度加载失败：${configured.error}；当前使用所选季度`} retry={configured.reload} />}
      {rollout.error && <ReadError message={`季度切换状态读取失败，暂不允许切换：${rollout.error}`} retry={rollout.reload} />}
      {rollout.data?.quarter_configuration_frozen && <div role="status" className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">版本切换保护中：季度配置暂时冻结，普通草稿保存和提交不受此冻结影响。<button type="button" className="ml-2 underline" onClick={rollout.reload}>重新读取切换状态</button></div>}
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
          {[...new Set([dq.year - 1, dq.year, dq.year + 1, cfgYear])].sort().map((y) => (
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
        <Button size="sm" onClick={handleSaveConfig} disabled={saving || configured.loading || !!configured.error || quarterChangesBlocked}>
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

      {progress.error ? <ReadError message={progress.error} retry={progress.reload} /> : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">按当前分配责任统计全部用户（含管理员）；历史季度不代表当时分配。概览按楼宇统计任意提交者的记录，用户明细仅统计该用户当前负责楼宇上的本人记录。记录覆盖率仅表示存在季度记录，不等于字段完整、有效或本季度重新填写；原始多版本保留为提交历史。旧记录未提供可靠录入来源，无法据此区分导入、沿用或本季新填。</p>
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
                {year}Q{quarter} 有记录
              </p>
              <p className="text-2xl font-bold text-emerald-700">
                {totalSubmitted}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs text-amber-600 mb-1">
                {year}Q{quarter} 无记录
              </p>
              <p className="text-2xl font-bold text-amber-700">{pending}</p>
            </div>
            <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
              <p className="mb-1 text-xs text-[var(--cd-color-text-secondary)]">记录覆盖率</p>
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
                  {year}Q{quarter} 有记录{" "}
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
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">记录覆盖率</th>
                  <th className="bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">最近正式提交</th>
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
                  const isExpanded = expandedUser === s.user_id && expandedKey === progressKey;
                  return (
                    <React.Fragment key={s.user_id}>
                      <tr className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            aria-label={`查看 ${s.user_name} 的上传记录`}
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
                            预览当前填报页
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-gradient-to-r from-zinc-50 to-zinc-100/50 px-6 py-4 border-t border-zinc-200">
                            {expandedError ? <ReadError message={expandedError} retry={() => void handleExpandUser(s.user_id, true)} /> : expandedLoading ? (
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
                                      disabled={downloading}
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

function SubmissionDataSection({ dicts, period }: { dicts: DictBundle; period: ReturnType<typeof useSubmissionPeriod> }) {
  const dq = getCurrentQuarter();
  const { year, quarter, setYear, setQuarter, configured } = period;
  const [userId, setUserId] = React.useState("all");
  const [showLog, setShowLog] = React.useState(false);
  const requestKey = `${year}:Q${quarter}:${userId}`;
  const result = useSubmissionRead(requestKey, () => fetchAllSubmissionPages<any>((from, to) => {
    let query = supabase.from('quarterly_submissions').select('*').eq('record_year', year).eq('record_quarter', quarter).order('created_at', { ascending: false }).order('id');
    if (userId !== 'all') query = query.eq('user_id', userId);
    return query.range(from, to);
  }));
  const rows = result.data || [];
  const loading = result.loading;
  const logs = useSubmissionRead(requestKey, () => fetchAllSubmissionPages<any>((from, to) => {
    let query = supabase.from('audit_logs').select('*').eq('action_type', 'SUBMIT_QUARTERLY_DATA').eq('details->>year', String(year)).eq('details->>quarter', String(quarter)).order('occurred_at', { ascending: false }).order('id');
    if (userId !== 'all') query = query.eq('user_id', userId);
    return query.range(from, to);
  }), showLog);
  const logRows = logs.data || [];
  const logLoading = logs.loading;

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

  const years = [...new Set([...Array.from({ length: 5 }, (_, i) => dq.year - 2 + i), year, configured.data?.year ?? year])].sort();
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
          {loading ? "加载中…" : result.error ? "记录数量未知" : `${rows.length} 条记录`}
        </span>


        <button
          onClick={() => setShowLog(value => !value)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition ${showLog ? "bg-zinc-100 border-zinc-400 text-zinc-700" : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"}`}
        >
          {showLog ? "收起操作日志" : "操作日志"}
        </button>
      </div>

      {configured.error && <ReadError message={`默认季度加载失败：${configured.error}；当前使用所选季度`} retry={configured.reload} />}
      {result.error && <ReadError message={result.error} retry={result.reload} />}
      <p className="mb-2 text-xs text-zinc-500">以下为全部历史提交版本，并非去重项目数；记录本身不证明本季度重新填写或字段有效。</p>
      {/* 数据表 - AG Grid */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)]">
        <SubmissionGrid
          columns={dataColumns}
          data={rows}
          loading={loading}
          emptyMessage={result.error ? "数据读取失败，不能判断是否存在提交记录" : "当前筛选条件下没有提交记录"}
        />
      </div>

      {/* 操作日志（可折叠） */}
      {showLog && (
        <div className="shrink-0 mt-3 rounded-lg border border-zinc-200 bg-zinc-50/50 overflow-hidden">
          <div className="px-4 py-2.5 bg-zinc-100 text-xs font-semibold text-zinc-600 border-b border-zinc-200">
            当前提交操作日志（{year}Q{quarter}；已应用用户筛选）
          </div>
          <div className="max-h-60 overflow-auto">
            {logs.error ? <ReadError message={logs.error} retry={logs.reload} /> : logLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
              </div>
            ) : logRows.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-400">
                暂无当前提交操作记录（不包含旧版 quarterly_updates；日志缺失不代表未提交）
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
                    const payload = r.details || {};
                    const summary = `提交 ${payload.record_count ?? payload.count ?? '-'} 项 · ${payload.tab ?? '-'} · ${r.action_type}`;
                    return (
                      <tr key={r.id || i} className="hover:bg-zinc-50">
                        <td className="px-3 py-1.5 text-zinc-500">
                          {new Date(r.occurred_at).toLocaleString("zh-CN", {
                            hour12: false,
                          })}
                        </td>
                        <td className="px-3 py-1.5">{dicts.user_roles?.[r.user_id] || r.user_name || r.user_id || "-"}</td>
                        <td className="px-3 py-1.5">{payload.target_name || "批次事件"}</td>
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
  id: string;
  user_id?: string;
  record_year?: number;
  record_quarter?: number;
  revision?: number;
  user_name: string;
  tab: string;
  draft_data: unknown;
  updated_at: string;
}

function DraftSection({ dicts }: { dicts: DictBundle }) {
  const drafts = useSubmissionRead('drafts', () => fetchAllSubmissionPages<DraftRow>((from, to) => supabase.from('update_drafts').select('*').order('updated_at', { ascending: false }).order('id').range(from, to)));
  const rows = drafts.data || [];
  const loading = drafts.loading;
  const [tabFilter, setTabFilter] = React.useState('all');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const summarizeDraft = summarizeAdminDraft;

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
          {loading ? "加载中…" : drafts.error ? "草稿数量未知" : `${nonEmpty.length} 条有数据 / ${empty.length} 条为空`}
        </span>
        <button
          onClick={drafts.reload}
          className="text-xs border border-zinc-200 text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-50"
        >
          刷新
        </button>
      </div>

      {drafts.error && <ReadError message={drafts.error} retry={drafts.reload} />}
      {/* 有数据的草稿 */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          </div>
        ) : drafts.error ? <p className="p-4 text-sm text-red-700">无法判断草稿状态，请重试</p> : filtered.length === 0 ? (
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
                      <td className="px-4 py-2 font-medium">{dicts.user_roles?.[r.user_id || ""] || r.user_name || r.user_id || "未知用户"}</td>
                      <td className="px-4 py-2">
                        <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--cd-color-text-secondary)]">
                          {TAB_LABELS[r.tab] || r.tab} · {r.record_year ?? "未知年份"} Q{r.record_quarter ?? "?"} · 版本 {r.revision ?? "未知"}
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
                                  项目（存量 / 未来供应）
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
                              {draftEntries(r.draft_data).map((entry) => {
                                const v = entry.values;
                                return (
                                  <tr key={`${entry.kind}:${entry.id}`} className="hover:bg-zinc-50">
                                    <td className="px-3 py-1.5 text-zinc-400">
                                      {draftProjectLabel(entry, dicts.buildings, dicts.future_supplies)}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qQuote ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qProp ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qFace ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qFree ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qVacArea ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qOwner ?? "-")}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {String(v.qPropMan ?? "-")}
                                    </td>
                                    <td
                                      className="px-3 py-1.5 max-w-[120px] truncate"
                                      title={String(v.qRemark ?? "")}
                                    >
                                      {String(v.qRemark ?? "-")}
                                    </td>
                                  </tr>
                                ); })}
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
                              {dicts.user_roles?.[r.user_id || ""] || r.user_name || r.user_id || "未知用户"}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] rounded bg-zinc-100 text-zinc-500">
                              {TAB_LABELS[r.tab] || r.tab} · {r.record_year ?? "未知年份"} Q{r.record_quarter ?? "?"} · 版本 {r.revision ?? "未知"}
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

function FutureSupplySubmissionsSection({ dicts, period }: { dicts: DictBundle; period: ReturnType<typeof useSubmissionPeriod> }) {
  const dq = getCurrentQuarter();
  const { year, quarter, setYear, setQuarter, configured } = period;
  const result = useSubmissionRead(`${year}:Q${quarter}`, () => fetchAllSubmissionPages<any>((from, to) => supabase.from('future_supply_submissions').select('*').eq('record_year', year).eq('record_quarter', quarter).order('created_at', { ascending: false }).order('id').range(from, to)));
  const rows = result.data || [];
  const loading = result.loading;

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

  const years = [...new Set([...Array.from({ length: 5 }, (_, i) => dq.year - 2 + i), year, configured.data?.year ?? year])].sort();

  async function handleExport() {
    if (loading || result.error || rows.length === 0) return;
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
    const XLSX = await import('xlsx');
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
        <span className="text-xs text-zinc-400">{loading ? "加载中…" : result.error ? "记录数量未知" : `${rows.length} 条记录`}</span>
        {!loading && !result.error && rows.length > 0 && (
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

      {configured.error && <ReadError message={`默认季度加载失败：${configured.error}；当前使用所选季度`} retry={configured.reload} />}
      {result.error && <ReadError message={result.error} retry={result.reload} />}
      {/* 数据表 */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          </div>
        ) : result.error ? <p className="p-4 text-sm text-red-700">无法判断提交状态，请重试</p> : rows.length === 0 ? (
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
  const period = useSubmissionPeriod();
  const [subTab, setSubTab] = React.useState<
    "assign" | "future-supply" | "progress" | "data" | "drafts" | "sort"
  >("assign");
  const [refreshKey] = React.useState(0);
  const dictionaries = useSubmissionRead<DictBundle>('submission-dictionaries', async () => {
      const [buildings, users, futureSupplies] = await Promise.all([
        submissionPageResult((from, to) => supabase.from('buildings').select('id, name, grade, submarket, sort_order').order('id').range(from, to)),
        submissionPageResult((from, to) => supabase.from('user_roles').select('user_id, chinese_name, full_name').order('user_id').range(from, to)),
        submissionPageResult((from, to) => supabase.from('future_supplies').select('id, name').order('id').range(from, to)),
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
      return {
        buildings: buildingDict,
        user_roles: userDict,
        building_grades: gradeDict,
        building_submarkets: submarketDict,
        building_sort_orders: sortOrderDict,
        future_supplies: futureSupplyDict,
      };
  });
  const dicts = dictionaries.data || {};

  const assignmentConfig: TableConfig = {
    ...ASSIGNMENTS_CONFIG,
    hideAdd: true,
    customFetch: async () => {
      const [buildingsRes, assignsRes] = await Promise.all([
        submissionPageResult((from, to) => supabase.from("buildings").select("id, name, grade, submarket").eq("is_active", true).eq("tracking_scope", "tracked").eq("project_type", "stock").order("id").range(from, to)),
        submissionPageResult((from, to) => supabase.from("building_assignments").select("*").order("id").range(from, to)),
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
    customFetch: () => fetchAllSubmissionPages((from, to) => supabase.from("future_supply_assignments").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
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

      {dictionaries.error && <ReadError message={`名称字典加载失败：${dictionaries.error}`} retry={dictionaries.reload} />}
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
              <FutureSupplySubmissionsSection dicts={dicts} period={period} />
            </div>
          </div>
        )}
        {subTab === "progress" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
            <SubmissionProgressSection dicts={dicts} period={period} />
          </div>
        )}
        {subTab === "data" && (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
            <QuarterlyReportPanel period={period} history={<SubmissionDataSection dicts={dicts} period={period} />} />
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

