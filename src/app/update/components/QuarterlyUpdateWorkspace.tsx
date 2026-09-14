'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Database, RotateCcw, Save } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { useBuildings } from '@/src/hooks/useBuildings';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { handleDataFetchError } from '@/src/utils/errorHandler';
import { retryAsync } from '@/src/utils/retryAsync';
import { DataEntryToolbar } from '@/src/components/data-entry/DataEntryToolbar';
import { SaveStatus, type SaveState } from '@/src/components/data-entry/SaveStatus';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { AppHeader, Badge, Button, Dialog, EmptyState, ErrorState, LoadingState } from '@/src/components/ui';
import {
  canonicalDraftUserName,
  isDraftRevisionConflict,
  isSubmissionPeriodChanged,
  parseSubmissionPeriod,
  previousSubmissionPeriod,
} from '../quarterlyDraftLifecycle';
import {
  buildQuarterlySubmissionPayload,
  getQuarterlyRowIssues,
  isQuarterlyRowComplete,
  type QuarterlyDraftRow,
} from '../quarterlyDataEntry';

const SUBMARKET_ORDER: Record<string, string[]> = {
  GradeA: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  GradeB: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '其他'],
  BP: ['望京-酒仙桥', '丰台科技园', '上地', '亦庄', '北清路', '通惠河传媒走廊', '其他'],
};

const TAB_LABELS: Record<string, string> = {
  GradeA: '甲级',
  GradeB: '乙级',
  BP: '产业园',
};

function QuarterlyStateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--cd-color-canvas)]">
      <header className="shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader title="季度数据填报" homeHref="/" />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}

function getVal(item: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!item) return '';
  for (const key of keys) {
    if (item[key] !== undefined) return item[key];
  }
  const itemKeys = Object.keys(item);
  for (const key of keys) {
    const normalized = key.replace(/\s+/g, '').toLowerCase();
    const match = itemKeys.find((itemKey) => itemKey.replace(/\s+/g, '').toLowerCase() === normalized);
    if (match) return item[match];
  }
  return '';
}

function safeNum(value: unknown) {
  if (value === '' || value === undefined || value === null) return 0;
  if (String(value).includes('%')) return parseFloat(String(value)) / 100;
  return parseFloat(String(value)) || 0;
}

function categoryForGrade(grade: unknown) {
  const value = String(grade ?? '').trim().toUpperCase();
  if (value === 'BP' || value.includes('BP') || value === 'BUSINESS PARK') return 'BP';
  if (value === 'B' || value === 'B+' || (value.startsWith('B') && !value.startsWith('BP'))) return 'GradeB';
  return 'GradeA';
}

interface CompletionNotice {
  total: number;
  regular: number;
  future: number;
}

interface RowFieldProps {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  field: string;
  readOnly: boolean;
  issue?: string;
  type?: 'number' | 'text';
  step?: string;
  multiline?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}

function RowField({ value, onChange, field, readOnly, issue, type = 'text', step, multiline, onKeyDown }: RowFieldProps) {
  const className = `data-entry-cell w-full min-w-0 rounded-[4px] border px-1.5 py-1 text-[11px] leading-5 outline-none transition focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]/20 ${issue ? 'border-amber-400 bg-amber-50/60' : 'border-zinc-300 bg-white'} ${readOnly ? 'cursor-not-allowed bg-zinc-100 text-zinc-400' : 'text-zinc-800'}`;
  if (multiline) {
    return (
      <textarea
        rows={1}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        data-quarterly-field={field}
        aria-invalid={Boolean(issue)}
        title={issue}
        onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLTextAreaElement>}
        className={`${className} resize-none text-left`}
      />
    );
  }
  return (
    <input
      type={type}
      step={step}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      readOnly={readOnly}
      data-quarterly-field={field}
      aria-invalid={Boolean(issue)}
      title={issue}
      onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLInputElement>}
      className={`${className} text-right tabular-nums`}
    />
  );
}

export function QuarterlyUpdateWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const previewAsUserId = searchParams.get('as');
  const { isImpersonating } = useImpersonation();

  const [ready, setReady] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<any>(null);
  const [matchName, setMatchName] = React.useState('');
  const [draftOwnerUserId, setDraftOwnerUserId] = React.useState('');
  const [draftUserName, setDraftUserName] = React.useState('');
  const [isPreview, setIsPreview] = React.useState(false);
  const [previewUserName, setPreviewUserName] = React.useState('');
  const [currentTab, setCurrentTab] = React.useState('GradeA');
  const [draftData, setDraftData] = React.useState<Record<string, QuarterlyDraftRow>>({});
  const [futureSupplyDrafts, setFutureSupplyDrafts] = React.useState<Record<string, QuarterlyDraftRow>>({});
  const [futureSupplyAssignments, setFutureSupplyAssignments] = React.useState<any[]>([]);
  const [futureSupplyData, setFutureSupplyData] = React.useState<Record<string, any>>({});
  const [assignedBuildingIds, setAssignedBuildingIds] = React.useState<string[] | null>(null);
  const [metricsMap, setMetricsMap] = React.useState<Record<string, any[]>>({});
  const [assignmentsError, setAssignmentsError] = React.useState<string | null>(null);
  const [assignmentsRetryKey, setAssignmentsRetryKey] = React.useState(0);
  const [showIncompleteDialog, setShowIncompleteDialog] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = React.useState<CompletionNotice | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = React.useState('正在准备云端草稿');
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [draftReady, setDraftReady] = React.useState(false);
  const [draftLoadError, setDraftLoadError] = React.useState<string | null>(null);
  const [submitYear, setSubmitYear] = React.useState(0);
  const [submitQuarter, setSubmitQuarter] = React.useState(0);

  const draftRequestSeqRef = React.useRef(0);
  const serverRevisionRef = React.useRef(0);
  const localRevisionRef = React.useRef(0);
  const lastSyncedLocalRevisionRef = React.useRef(0);
  const latestDraftRef = React.useRef<Record<string, any>>({});
  const currentTabRef = React.useRef(currentTab);
  const saveStateRef = React.useRef<SaveState>(saveState);
  const draftReadyRef = React.useRef(draftReady);

  const lastSuccessfulBuildings = React.useRef<any[] | null>(null);
  const { buildings, error: buildingsError, mutate } = useBuildings({ revalidateOnMount: true });

  React.useEffect(() => {
    if (buildings !== undefined) lastSuccessfulBuildings.current = buildings;
  }, [buildings]);

  React.useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  React.useEffect(() => { saveStateRef.current = saveState; }, [saveState]);
  React.useEffect(() => { draftReadyRef.current = draftReady; }, [draftReady]);

  const protectedBuildings = buildings !== undefined ? buildings : lastSuccessfulBuildings.current ?? undefined;

  const myBuildings = React.useMemo(() => {
    if (!protectedBuildings || assignedBuildingIds === null) return [];
    const idSet = new Set(assignedBuildingIds);
    const result = protectedBuildings
      .filter((building: any) => idSet.has(building.id))
      .map((building: any) => {
        const copy: any = { ...building };
        const reference = (metricsMap[building.id] ?? [])[0] ?? null;
        copy._referenceData = reference;
        if (reference) {
          copy['上季度租金报价'] = reference.asking_rent;
          copy['上季度物业费'] = reference.management_fee;
          copy['上季度表面租金'] = reference.face_rent;
          copy['上季度免租期'] = reference.rent_free_period;
          copy['上季度净有效租金'] = reference.net_effective_rent;
          copy['上季度空置面积'] = reference.vacant_area;
          copy['上季度空置率'] = reference.vacancy_rate;
          copy['总面积'] = reference.total_area;
        }
        copy['写字楼名称'] = building.name;
        copy['子市场'] = building.submarket;
        copy['业主'] = building.owner ?? building.landlord ?? '';
        copy['物业'] = building.property_management ?? '';
        if (!copy['总面积']) copy['总面积'] = building.total_area ?? 0;
        copy._category = categoryForGrade(building.grade);
        copy._sort_order = building.sort_order ?? 0;
        return copy;
      });

    result.sort((left: any, right: any) => {
      if (left._category !== right._category) return 0;
      const order = SUBMARKET_ORDER[left._category] ?? [];
      const leftIndex = order.indexOf(left.submarket);
      const rightIndex = order.indexOf(right.submarket);
      const normalizedLeft = leftIndex >= 0 ? leftIndex : order.length;
      const normalizedRight = rightIndex >= 0 ? rightIndex : order.length;
      return normalizedLeft !== normalizedRight
        ? normalizedLeft - normalizedRight
        : (left._sort_order ?? 0) - (right._sort_order ?? 0);
    });

    for (const assignment of futureSupplyAssignments) {
      const supply = futureSupplyData[assignment.future_supply_id];
      if (!supply) continue;
      result.push({
        ...supply,
        _isFutureSupply: true,
        _assignmentId: assignment.id,
        _category: categoryForGrade(supply.grade),
        name: supply.name,
        total_area: supply.total_area || 0,
      });
    }
    return result;
  }, [protectedBuildings, assignedBuildingIds, metricsMap, futureSupplyAssignments, futureSupplyData]);

  React.useEffect(() => {
    let cancelled = false;
    setAssignmentsError(null);
    setReady(false);
    setAssignedBuildingIds(null);
    setFutureSupplyAssignments([]);
    setFutureSupplyData({});
    setMetricsMap({});

    void (async () => {
      try {
        const session = await getSessionFast();
        if (cancelled) return;
        if (!session?.user) {
          router.replace('/login');
          return;
        }

        const user = session.user;
        setCurrentUser(user);
        const name = (user.user_metadata?.full_name as string) || user.email?.split('@')[0] || '未知用户';
        setMatchName(name);

        const { data: roleRow, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .single();
        if (roleError) throw new Error(`读取用户权限失败：${roleError.message}`);
        if (roleRow?.role !== 'admin' && roleRow?.role !== 'editor') {
          router.replace('/');
          return;
        }

        const { data: settings, error: settingsError } = await supabase
          .from('app_settings')
          .select('key,value')
          .in('key', ['current_submission_year', 'current_submission_quarter']);
        if (settingsError) throw new Error(`读取当前填报季度失败：${settingsError.message}`);
        const period = parseSubmissionPeriod(settings);
        const previousPeriod = previousSubmissionPeriod(period);
        if (cancelled) return;
        setSubmitYear(period.year);
        setSubmitQuarter(period.quarter);

        let assignmentUserId = user.id;
        let canonicalName = canonicalDraftUserName(user.email, name);
        setIsPreview(false);
        setPreviewUserName('');

        if (previewAsUserId && roleRow?.role === 'admin') {
          const { data: previewUser, error: previewError } = await supabase
            .from('user_roles')
            .select('chinese_name, full_name, email')
            .eq('user_id', previewAsUserId)
            .single();
          if (previewError) throw new Error(`读取预览用户失败：${previewError.message}`);
          setIsPreview(true);
          assignmentUserId = previewAsUserId;
          setPreviewUserName(previewUser?.chinese_name || previewUser?.full_name || previewUser?.email || previewAsUserId);
          canonicalName = canonicalDraftUserName(previewUser?.email, previewUser?.full_name || previewAsUserId);
        }

        setDraftOwnerUserId(assignmentUserId);
        setDraftUserName(canonicalName);

        const assignments = await retryAsync(async () => {
          const result = await supabase.from('building_assignments').select('building_id').eq('user_id', assignmentUserId);
          if (result.error) throw result.error;
          return result.data ?? [];
        }, { attempts: 3, baseDelayMs: 250 });
        if (cancelled) return;
        const ids = assignments.map((assignment: any) => assignment.building_id as string);
        setAssignedBuildingIds(ids);

        if (ids.length > 0) {
          try {
            const metrics = await retryAsync(async () => {
              const result = await supabase
                .from('building_metrics')
                .select('building_id,record_year,record_quarter,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacancy_rate,vacant_area,total_area')
                .in('building_id', ids)
                .eq('record_year', previousPeriod.year)
                .eq('record_quarter', previousPeriod.quarter);
              if (result.error) throw result.error;
              return result.data ?? [];
            }, { attempts: 3, baseDelayMs: 250 });
            const grouped: Record<string, any[]> = {};
            for (const row of metrics) (grouped[row.building_id] ||= []).push(row);
            if (!cancelled) setMetricsMap(grouped);
          } catch (error) {
            console.warn('[QuarterlyUpdate] previous-quarter metrics unavailable; continuing without reference data', error);
          }
        }

        const { data: supplyAssignments, error: supplyError } = await supabase
          .from('future_supply_assignments')
          .select('id,future_supply_id,record_year,record_quarter')
          .eq('user_id', assignmentUserId)
          .eq('record_year', period.year)
          .eq('record_quarter', period.quarter);
        if (supplyError) throw new Error(`读取未来供应任务失败：${supplyError.message}`);
        if (cancelled) return;
        setFutureSupplyAssignments(supplyAssignments ?? []);
        if (supplyAssignments?.length) {
          const idsToLoad = supplyAssignments.map((assignment) => assignment.future_supply_id);
          const { data: supplies, error: suppliesError } = await supabase
            .from('future_supplies')
            .select('id,name,submarket,grade,owner,total_area,district')
            .in('id', idsToLoad);
          if (suppliesError) throw new Error(`读取未来供应项目失败：${suppliesError.message}`);
          const supplyMap: Record<string, any> = {};
          for (const supply of supplies ?? []) supplyMap[supply.id] = supply;
          setFutureSupplyData(supplyMap);
        }

        if (!cancelled) setReady(true);
      } catch (error: any) {
        console.error('[QuarterlyUpdate] initialization failed', error);
        if (!cancelled) {
          setAssignmentsError(error?.message ?? '季度填报初始化失败，请重试。');
          setAssignedBuildingIds((previous) => previous ?? []);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [assignmentsRetryKey, previewAsUserId, router]);

  const fetchDraftFromServer = React.useCallback(async (ownerUserId: string, tab: string, year: number, quarter: number) => {
    const requestId = ++draftRequestSeqRef.current;
    const localRevisionAtStart = localRevisionRef.current;
    setDraftReady(false);
    setDraftLoadError(null);
    setSaveState('saving');
    setSaveMessage('正在加载当前季度云端草稿');

    try {
      const { data, error } = await supabase
        .from('update_drafts')
        .select('draft_data,updated_at,revision')
        .eq('user_id', ownerUserId)
        .eq('record_year', year)
        .eq('record_quarter', quarter)
        .eq('tab', tab)
        .maybeSingle();

      if (requestId !== draftRequestSeqRef.current) return;
      if (error) throw error;

      if (localRevisionRef.current !== localRevisionAtStart) {
        setDraftReady(true);
        setSaveState('unsaved');
        setSaveMessage('检测到本地修改，未使用稍晚返回的云端数据覆盖');
        return;
      }

      if (data?.draft_data && typeof data.draft_data === 'object') {
        const { __futureSupply__, ...regular } = data.draft_data as Record<string, any>;
        setDraftData(regular);
        setFutureSupplyDrafts(__futureSupply__ && typeof __futureSupply__ === 'object' ? __futureSupply__ : {});
      } else {
        setDraftData({});
        setFutureSupplyDrafts({});
      }

      const revision = Number(data?.revision ?? 0);
      serverRevisionRef.current = Number.isFinite(revision) ? revision : 0;
      localRevisionRef.current = 0;
      lastSyncedLocalRevisionRef.current = 0;
      setLastSavedAt(data?.updated_at ? new Date(data.updated_at) : null);
      setSaveState(data ? 'saved' : 'idle');
      setSaveMessage(data ? '已加载当前季度云端草稿' : '当前季度暂无云端草稿');
      setDraftReady(true);
    } catch (error: any) {
      if (requestId !== draftRequestSeqRef.current) return;
      console.warn('[QuarterlyUpdate] draft read failed', error);
      setDraftLoadError(error?.message || '云端草稿读取失败');
      setSaveState('idle');
      setSaveMessage('云端草稿读取失败；当前页面不会自动清空本地修改');
      setDraftReady(true);
    }
  }, []);

  React.useEffect(() => {
    if (!ready || !draftOwnerUserId || submitYear <= 0 || submitQuarter <= 0) return;
    void fetchDraftFromServer(draftOwnerUserId, currentTab, submitYear, submitQuarter);
  }, [ready, draftOwnerUserId, currentTab, submitYear, submitQuarter, fetchDraftFromServer]);

  const mergedDraft = React.useCallback(
    () => ({ ...draftData, __futureSupply__: futureSupplyDrafts }),
    [draftData, futureSupplyDrafts],
  );

  React.useEffect(() => {
    latestDraftRef.current = mergedDraft();
  }, [mergedDraft]);

  const syncDraftToServer = React.useCallback(async (draft: Record<string, any>, tab: string) => {
    if (!currentUser?.id || !draftUserName || isPreview || isImpersonating || submitYear <= 0 || submitQuarter <= 0) return false;

    const localRevision = localRevisionRef.current;
    if (localRevision === lastSyncedLocalRevisionRef.current && serverRevisionRef.current > 0) {
      return true;
    }

    setSaveState('saving');
    setSaveMessage('正在同步当前季度云端草稿');
    try {
      const { data, error } = await supabase.rpc('save_quarterly_draft', {
        p_user_id: currentUser.id,
        p_user_name: draftUserName,
        p_year: submitYear,
        p_quarter: submitQuarter,
        p_tab: tab,
        p_draft_data: draft,
        p_expected_revision: serverRevisionRef.current,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const nextServerRevision = Number(row?.revision ?? serverRevisionRef.current + 1);
      serverRevisionRef.current = Number.isFinite(nextServerRevision) ? nextServerRevision : serverRevisionRef.current + 1;
      lastSyncedLocalRevisionRef.current = localRevision;
      const timestamp = row?.updated_at ? new Date(row.updated_at) : new Date();
      setLastSavedAt(timestamp);

      if (localRevisionRef.current === localRevision) {
        setSaveState('saved');
        setSaveMessage('更改已同步至当前季度云端草稿');
        return true;
      }

      setSaveState('unsaved');
      setSaveMessage('保存期间产生了新修改，最新修改仍待同步');
      return false;
    } catch (error: any) {
      console.error('[QuarterlyUpdate] draft sync failed', error);
      setSaveState('error');
      if (isDraftRevisionConflict(error)) {
        setSaveMessage('检测到另一窗口已更新云端草稿；本地修改未覆盖云端，请刷新后核对');
      } else if (isSubmissionPeriodChanged(error)) {
        setSaveMessage('当前开放填报季度已变化，请刷新页面后继续');
      } else {
        setSaveMessage(error?.message || '云端草稿保存失败；当前页面仍保留本地修改');
      }
      return false;
    }
  }, [currentUser?.id, draftUserName, isPreview, isImpersonating, submitYear, submitQuarter]);

  const manualSave = React.useCallback(async () => {
    await syncDraftToServer(latestDraftRef.current, currentTabRef.current);
  }, [syncDraftToServer]);

  React.useEffect(() => {
    if (!currentUser?.id || isPreview || isImpersonating) return;
    const timer = window.setInterval(() => {
      if (draftReadyRef.current && saveStateRef.current === 'unsaved') {
        void syncDraftToServer(latestDraftRef.current, currentTabRef.current);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [currentUser?.id, isPreview, isImpersonating, syncDraftToServer]);

  const switchTab = async (nextTab: string) => {
    if (nextTab === currentTab) return;
    if (saveStateRef.current === 'unsaved' || saveStateRef.current === 'error') {
      const saved = await syncDraftToServer(latestDraftRef.current, currentTab);
      if (!saved) return;
    }

    draftRequestSeqRef.current += 1;
    serverRevisionRef.current = 0;
    localRevisionRef.current = 0;
    lastSyncedLocalRevisionRef.current = 0;
    latestDraftRef.current = {};
    setDraftData({});
    setFutureSupplyDrafts({});
    setLastSavedAt(null);
    setDraftLoadError(null);
    setDraftReady(false);
    setCurrentTab(nextTab);
    setCompletionNotice(null);
    setSubmitError(null);
  };

  const markUnsaved = () => {
    if (isPreview || isImpersonating || !draftReadyRef.current || submitting) return;
    localRevisionRef.current += 1;
    setCompletionNotice(null);
    setSaveState('unsaved');
    setSaveMessage('当前修改尚未同步到当前季度云端草稿');
  };

  const updateRegularField = (buildingId: string, field: string, value: string) => {
    setDraftData((previous) => ({
      ...previous,
      [buildingId]: { ...(previous[buildingId] || {}), [field]: value },
    }));
    markUnsaved();
  };

  const updateFutureField = (assignmentId: string, field: string, value: string) => {
    setFutureSupplyDrafts((previous) => ({
      ...previous,
      [assignmentId]: { ...(previous[assignmentId] || {}), [field]: value },
    }));
    markUnsaved();
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.currentTarget.tagName === 'TEXTAREA') return;
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-quarterly-field]:not([readonly])'));
    const index = cells.indexOf(event.currentTarget);
    const nextCell = index >= 0 ? cells[index + 1] : undefined;
    if (nextCell) {
      event.preventDefault();
      nextCell.focus();
      if (nextCell instanceof HTMLInputElement) nextCell.select();
    }
  };

  const filteredBuildings = myBuildings.filter((building: any) => building._category === currentTab);
  const rowState = (building: any) => building._isFutureSupply
    ? futureSupplyDrafts[building._assignmentId] || {}
    : draftData[building.id] || {};
  const totalAreaFor = (building: any) => building._isFutureSupply
    ? safeNum(building.total_area) || 1
    : safeNum(getVal(building, ['总面积', 'Total Area'])) || 1;

  const completedCount = filteredBuildings.filter((building: any) => isQuarterlyRowComplete(rowState(building))).length;
  const exceptionCount = filteredBuildings.filter((building: any) => getQuarterlyRowIssues(rowState(building), totalAreaFor(building)).length > 0).length;
  const incompleteBuildings = filteredBuildings.filter((building: any) => !isQuarterlyRowComplete(rowState(building)));
  const accessReadOnly = isPreview || isImpersonating;
  const readOnly = accessReadOnly || !draftReady || submitting;

  const assertCurrentPeriod = React.useCallback(async () => {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key,value')
      .in('key', ['current_submission_year', 'current_submission_quarter']);
    if (error) throw new Error(`无法确认当前开放填报季度：${error.message}`);
    const current = parseSubmissionPeriod(data);
    if (current.year !== submitYear || current.quarter !== submitQuarter) {
      throw new Error(`当前开放填报季度已切换为 ${current.year} Q${current.quarter}，请刷新页面后继续。`);
    }
  }, [submitYear, submitQuarter]);

  const executeSubmit = async () => {
    setShowIncompleteDialog(false);
    setSubmitting(true);
    setSubmitError(null);
    setCompletionNotice(null);

    const regularRows: any[] = [];
    const futureRows: any[] = [];
    for (const building of filteredBuildings) {
      const draft = rowState(building);
      const hasData = draft.qQuote || draft.qProp || draft.qFace || draft.qFree || draft.qVacArea || draft.qOwner || draft.qPropMan || draft.qRemark;
      if (!hasData) continue;
      const payload = buildQuarterlySubmissionPayload(draft, {
        userId: currentUser?.id ?? null,
        userName: matchName,
        year: submitYear,
        quarter: submitQuarter,
        totalArea: totalAreaFor(building),
      });
      if (building._isFutureSupply) futureRows.push({ ...payload, future_supply_id: building.id });
      else regularRows.push({ ...payload, building_id: building.id });
    }

    const total = regularRows.length + futureRows.length;
    if (total === 0) {
      setSubmitError('当前分类下没有填写任何数据，无需提交。');
      setSubmitting(false);
      setSaveState(saveStateRef.current === 'saved' ? 'saved' : 'idle');
      return;
    }

    try {
      await assertCurrentPeriod();
      const saved = await syncDraftToServer(latestDraftRef.current, currentTab);
      if (!saved) throw new Error('最新修改尚未完整同步到云端草稿，请先完成草稿保存后再提交。');

      setSaveState('submitting');
      setSaveMessage('正在写入提交数据');
      if (regularRows.length) {
        const { error } = await supabase.from('quarterly_submissions').insert(regularRows);
        if (error) throw error;
      }
      if (futureRows.length) {
        const { error } = await supabase.from('future_supply_submissions').insert(futureRows);
        if (error) throw error;
      }
      logAction(currentUser?.email, 'SUBMIT_QUARTERLY_DATA', {
        count: total,
        regular: regularRows.length,
        future: futureRows.length,
        tab: currentTab,
        year: submitYear,
        quarter: submitQuarter,
      });
      setCompletionNotice({ total, regular: regularRows.length, future: futureRows.length });
      setSaveState('submitted');
      setLastSavedAt(new Date());
      setSaveMessage('提交成功；当前季度云端草稿已同步');
    } catch (error: any) {
      console.error('[QuarterlyUpdate] submit failed', error);
      setSubmitError(error?.message ? `提交失败：${error.message}` : '提交失败，请重试。');
      setSaveState('error');
      setSaveMessage('提交失败；本地内容仍保留，可核对后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const submitData = async () => {
    const saved = await syncDraftToServer(latestDraftRef.current, currentTab);
    if (!saved) {
      setSubmitError('草稿尚未完整同步，已阻止提交以避免数据状态不一致。请先重试保存。');
      return;
    }
    if (incompleteBuildings.length > 0) {
      setShowIncompleteDialog(true);
      return;
    }
    await executeSubmit();
  };

  if (buildingsError) {
    const info = handleDataFetchError(buildingsError);
    return (
      <QuarterlyStateShell>
        <ErrorState
          title="楼宇数据加载失败"
          description={info.message}
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              {info.retryable ? <Button onClick={() => mutate()}>{info.userAction}</Button> : null}
              <Link href="/" className="inline-flex h-[var(--cd-control-height-md)] items-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 text-[var(--cd-font-size-md)] font-medium text-[var(--cd-color-text-primary)] transition-colors hover:bg-[var(--cd-color-surface-alt)]">主页</Link>
            </div>
          )}
        />
      </QuarterlyStateShell>
    );
  }

  if (assignmentsError) {
    return (
      <QuarterlyStateShell>
        <ErrorState
          title="季度填报初始化失败"
          description={assignmentsError}
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => { setAssignedBuildingIds(null); setAssignmentsRetryKey((value) => value + 1); }}>重新加载</Button>
              <Link href="/" className="inline-flex h-[var(--cd-control-height-md)] items-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 text-[var(--cd-font-size-md)] font-medium text-[var(--cd-color-text-primary)] transition-colors hover:bg-[var(--cd-color-surface-alt)]">主页</Link>
            </div>
          )}
        />
      </QuarterlyStateShell>
    );
  }

  if (!ready || protectedBuildings === undefined || assignedBuildingIds === null || submitYear <= 0 || submitQuarter <= 0) {
    return <QuarterlyStateShell><LoadingState rows={0} label="正在确认当前填报季度并加载任务" /></QuarterlyStateShell>;
  }

  if (assignedBuildingIds.length === 0 && futureSupplyAssignments.length === 0) {
    return (
      <QuarterlyStateShell>
        <EmptyState title="暂无填报任务" description="目前没有分配给您的填报任务，请联系管理员。" />
      </QuarterlyStateShell>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f3f5f7] text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-white">
        <AppHeader
          title={<span className="flex items-center gap-2">季度数据填报<Badge tone="brand">{submitYear} Q{submitQuarter}</Badge>{accessReadOnly ? <Badge tone="warning">只读</Badge> : null}</span>}
          status={<span className="text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-secondary)]">{isPreview ? `管理员预览 · ${previewUserName}` : `${matchName} · ${TAB_LABELS[currentTab]}`}</span>}
          homeHref="/"
          actions={<SaveStatus state={saveState} message={saveMessage} savedAt={lastSavedAt} onRetry={() => { void manualSave(); }} />}
        />
        {isPreview && <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-700">管理员预览模式：正在查看 {previewUserName} 在 {submitYear} Q{submitQuarter} 的分配与草稿，不允许写入。</div>}
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 py-2 sm:px-5">
        {(['GradeA', 'GradeB', 'BP'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { void switchTab(tab); }}
            disabled={!draftReady || submitting}
            className={`rounded-[4px] border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${currentTab === tab ? 'border-[#003e7e] bg-[#003e7e] text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="ml-auto hidden items-center divide-x divide-zinc-200 text-[10px] text-zinc-500 md:flex">
          <span className="px-2">项目 <strong className="tabular-nums text-zinc-800">{filteredBuildings.length}</strong></span>
          <span className="px-2">完整 <strong className="tabular-nums text-emerald-700">{completedCount}</strong></span>
          <span className="pl-2">待检查 <strong className="tabular-nums text-amber-700">{exceptionCount}</strong></span>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-zinc-200 bg-white">
          {(completionNotice || submitError || draftLoadError) && (
            <div className="shrink-0 border-b border-zinc-200 p-2.5">
              {completionNotice ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <CheckCircle2 size={15} />
                  <strong>提交成功</strong>
                  <span>已写入 {completionNotice.total} 条（普通楼宇 {completionNotice.regular} / 未来供应 {completionNotice.future}）。当前季度云草稿已同步。</span>
                  <button onClick={() => setCompletionNotice(null)} className="ml-auto font-semibold underline underline-offset-2">继续录入</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <ValidationMessage severity="error">{submitError || `云端草稿读取失败：${draftLoadError}`}</ValidationMessage>
                  {submitError && <button onClick={() => { void executeSubmit(); }} className="rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">重试提交</button>}
                  {draftLoadError && !submitError && <button onClick={() => { void fetchDraftFromServer(draftOwnerUserId, currentTab, submitYear, submitQuarter); }} className="rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">重试读取</button>}
                </div>
              )}
            </div>
          )}

          <div className="hidden min-h-0 flex-1 overflow-auto md:block">
            <table className="w-full min-w-[1760px] border-collapse text-[11px]">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-zinc-200 text-[10px] text-zinc-500">
                  <th colSpan={5} className="border-r border-zinc-200 bg-zinc-50 px-2 py-1.5 text-left">项目概况</th>
                  <th colSpan={7} className="border-r border-zinc-200 bg-slate-50 px-2 py-1.5 text-left text-slate-600">上季度参考</th>
                  <th colSpan={10} className="bg-[#fffaf0] px-2 py-1.5 text-left text-amber-800">本季度填报</th>
                </tr>
                <tr className="border-b border-zinc-200 bg-white text-zinc-600">
                  {['序号','项目','子市场','业主 / 物业','总面积','报价','物业费','表面租金','免租期','净有效租金','空置面积','空置率','报价','物业费','表面租金','免租期','净有效租金','租金变化','空置面积','面积变化','空置率','备注'].map((label, index) => (
                    <th key={`${label}-${index}`} className={`whitespace-nowrap border-r border-zinc-100 px-2 py-2 font-semibold ${index === 1 ? 'sticky left-0 z-30 bg-white text-left' : index >= 12 ? 'bg-[#fffdf7]' : 'text-right'}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBuildings.length === 0 ? (
                  <tr><td colSpan={22} className="p-10 text-center text-sm text-zinc-400">当前分类没有需要填报的项目。</td></tr>
                ) : filteredBuildings.map((building: any, index: number) => {
                  const draft = rowState(building);
                  const totalArea = totalAreaFor(building);
                  const issues = getQuarterlyRowIssues(draft, totalArea);
                  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
                  const isFuture = building._isFutureSupply === true;
                  const name = isFuture ? building.name : getVal(building, ['写字楼名称', 'Project Name CN', 'name']) || '-';
                  const submarket = isFuture ? building.submarket || '-' : getVal(building, ['子市场', 'SUBMARKET']) || '-';
                  const lastQuote = isFuture ? 0 : safeNum(getVal(building, ['上季度租金报价', '报价', '租金报价']));
                  const lastMgmt = isFuture ? 0 : safeNum(getVal(building, ['上季度物业费', '物业费']));
                  const lastFace = isFuture ? 0 : safeNum(getVal(building, ['上季度表面租金', '表面租金', '表面']));
                  const lastFree = isFuture ? 0 : safeNum(getVal(building, ['上季度免租期', '免租期', '免租期（三年租约）']));
                  const lastNet = isFuture ? 0 : safeNum(getVal(building, ['上季度净有效租金', '净有效租金']));
                  const lastVacant = isFuture ? 0 : safeNum(getVal(building, ['上季度空置面积', '空置面积']));
                  const rawVacancy = isFuture ? '' : getVal(building, ['上季度空置率', '空置率']);
                  const lastVacancyPercent = rawVacancy === '' ? null : (String(rawVacancy).includes('%') ? parseFloat(String(rawVacancy)) : (safeNum(rawVacancy) > 1 ? safeNum(rawVacancy) : safeNum(rawVacancy) * 100));
                  const face = parseFloat(String(draft.qFace ?? '')) || 0;
                  const free = parseFloat(String(draft.qFree ?? '')) || 0;
                  const vacant = parseFloat(String(draft.qVacArea ?? '')) || 0;
                  const net = face > 0 ? face * (36 - free) / 36 : 0;
                  const rentDelta = !isFuture && net > 0 && lastNet > 0 ? ((net - lastNet) / lastNet) * 100 : null;
                  const areaDelta = draft.qVacArea !== undefined && draft.qVacArea !== '' && !isFuture ? Math.round(vacant - lastVacant) : null;
                  const vacancy = draft.qVacArea !== undefined && draft.qVacArea !== '' ? (vacant / totalArea) * 100 : null;
                  const change = (field: string, value: string) => isFuture ? updateFutureField(building._assignmentId, field, value) : updateRegularField(building.id, field, value);
                  const defaultOwner = isFuture ? '' : String(getVal(building, ['业主', 'Landlord']) || '');
                  const defaultPm = isFuture ? '' : String(getVal(building, ['物业', '物业公司', 'Property Management']) || '');

                  return (
                    <tr key={`${isFuture ? 'future' : 'building'}-${building.id}`} className={`border-b border-zinc-100 hover:bg-zinc-50/70 ${isFuture ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-2 py-1.5 text-center text-zinc-400">{index + 1}</td>
                      <td className={`sticky left-0 z-10 min-w-44 border-r border-zinc-200 px-2 py-1.5 font-semibold ${isFuture ? 'bg-amber-50 text-amber-800' : 'bg-white text-[#003e7e]'}`}><div className="truncate" title={String(name)}>{String(name)}</div>{issues.length > 0 && <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700"><AlertTriangle size={10} /> 待检查</span>}</td>
                      <td className="px-2 py-1.5 text-zinc-600">{String(submarket)}</td>
                      <td className="min-w-40 px-1 py-1"><div className="grid grid-cols-2 gap-1"><RowField value={draft.qOwner ?? defaultOwner} onChange={(value) => change('qOwner', value)} field="qOwner" readOnly={readOnly} multiline /><RowField value={draft.qPropMan ?? defaultPm} onChange={(value) => change('qPropMan', value)} field="qPropMan" readOnly={readOnly} multiline /></div></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{Math.round(totalArea).toLocaleString()}</td>
                      {[lastQuote,lastMgmt,lastFace,lastFree,lastNet,lastVacant].map((value, valueIndex) => <td key={valueIndex} className="bg-slate-50/70 px-2 py-1.5 text-right tabular-nums text-zinc-500">{value > 0 ? (valueIndex === 5 ? Math.round(value).toLocaleString() : Number(value).toFixed(valueIndex >= 2 ? 1 : 0)) : '-'}</td>)}
                      <td className="bg-slate-50/70 px-2 py-1.5 text-right tabular-nums text-zinc-500">{lastVacancyPercent !== null && Number.isFinite(lastVacancyPercent) ? `${lastVacancyPercent.toFixed(1)}%` : '-'}</td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qQuote} onChange={(value) => change('qQuote', value)} field="qQuote" readOnly={readOnly} issue={issueFor('qQuote')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qProp} onChange={(value) => change('qProp', value)} field="qProp" readOnly={readOnly} issue={issueFor('qProp')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qFace} onChange={(value) => change('qFace', value)} field="qFace" readOnly={readOnly} issue={issueFor('qFace')} type="number" step="0.01" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qFree} onChange={(value) => change('qFree', value)} field="qFree" readOnly={readOnly} issue={issueFor('qFree')} type="number" step="0.1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right font-semibold tabular-nums text-amber-800">{net > 0 ? net.toFixed(1) : '-'}</td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right tabular-nums">{rentDelta === null ? '-' : `${rentDelta > 0 ? '+' : ''}${rentDelta.toFixed(1)}%`}</td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qVacArea} onChange={(value) => change('qVacArea', value)} field="qVacArea" readOnly={readOnly} issue={issueFor('qVacArea')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right tabular-nums">{areaDelta === null ? '-' : `${areaDelta > 0 ? '+' : ''}${areaDelta.toLocaleString()}`}</td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right font-semibold tabular-nums text-[#003e7e]">{vacancy === null ? '-' : `${vacancy.toFixed(1)}%`}</td>
                      <td className="min-w-40 bg-[#fffdf7] px-1 py-1"><RowField value={draft.qRemark} onChange={(value) => change('qRemark', value)} field="qRemark" readOnly={readOnly} multiline /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
            {filteredBuildings.map((building: any, index: number) => {
              const draft = rowState(building);
              const totalArea = totalAreaFor(building);
              const issues = getQuarterlyRowIssues(draft, totalArea);
              const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
              const change = (field: string, value: string) => building._isFutureSupply ? updateFutureField(building._assignmentId, field, value) : updateRegularField(building.id, field, value);
              const name = building._isFutureSupply ? building.name : getVal(building, ['写字楼名称', 'name']) || '-';
              return (
                <section key={`${building.id}-${index}`} className="border-b border-zinc-200 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3"><div><div className="text-xs font-semibold text-[#003e7e]">{index + 1}. {String(name)}</div><div className="mt-0.5 text-[10px] text-zinc-400">{String(building.submarket || '')} · {Math.round(totalArea).toLocaleString()} ㎡</div></div>{isQuarterlyRowComplete(draft) ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertTriangle size={14} className="text-amber-600" />}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[['qQuote','报价','1'],['qProp','物业费','1'],['qFace','表面租金','0.01'],['qFree','免租期','0.1'],['qVacArea','空置面积','1']].map(([field,label,step]) => <label key={field} className={field === 'qVacArea' ? 'col-span-2' : ''}><span className="mb-1 block text-[10px] font-medium text-zinc-500">{label} *</span><RowField value={draft[field]} onChange={(value) => change(field, value)} field={field} readOnly={readOnly} issue={issueFor(field)} type="number" step={step} /></label>)}
                    <label className="col-span-2"><span className="mb-1 block text-[10px] font-medium text-zinc-500">备注</span><RowField value={draft.qRemark} onChange={(value) => change('qRemark', value)} field="qRemark" readOnly={readOnly} multiline /></label>
                  </div>
                  {issues.length > 0 && <div className="mt-2"><ValidationMessage severity="warning">{issues[0].message}{issues.length > 1 ? `（另有 ${issues.length - 1} 项待检查）` : ''}</ValidationMessage></div>}
                </section>
              );
            })}
          </div>

          <DataEntryToolbar leading={<div className="flex items-center gap-2 text-[10px] text-zinc-500"><Database size={12} /><span>每 30 秒检查未同步修改；草稿按用户 + 年份 + 季度 + 分类隔离保存。</span></div>}>
            {!accessReadOnly && <button type="button" onClick={() => { void manualSave(); }} disabled={!draftReady || saveState === 'saving' || submitting} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Save size={13} /> 保存草稿</button>}
            {!accessReadOnly && <button type="button" onClick={() => { void submitData(); }} disabled={!draftReady || submitting} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#003e7e] px-3.5 text-[11px] font-semibold text-white hover:bg-[#003566] disabled:opacity-50">{submitting ? <RotateCcw size={13} className="animate-spin" /> : null}{submitting ? '提交中…' : '提交当前分类'}</button>}
            {accessReadOnly && <span className="text-[11px] font-medium text-zinc-400">{isImpersonating ? '模拟模式不可写入' : '预览模式不可写入'}</span>}
          </DataEntryToolbar>
        </div>
      </main>

      <Dialog
        open={showIncompleteDialog}
        onOpenChange={setShowIncompleteDialog}
        title="存在未填完的项目"
        description="沿用现有业务规则：报价、物业费、表面租金、免租期、空置面积为必填；业主、物业和备注可留空。你仍可强行提交已填写的数据。"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowIncompleteDialog(false)}>去补充</Button>
            <Button onClick={() => { void executeSubmit(); }}>强行提交已填数据</Button>
          </>
        )}
      >
        <div className="max-h-44 overflow-y-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-2 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
          {incompleteBuildings.slice(0, 8).map((building: any, index: number) => <div key={building.id} className="py-1">{index + 1}. {String(getVal(building, ['写字楼名称', 'name']) || building.name || '-')}</div>)}
          {incompleteBuildings.length > 8 && <div className="py-1 text-[var(--cd-color-text-muted)]">另有 {incompleteBuildings.length - 8} 个项目…</div>}
        </div>
      </Dialog>
    </div>
  );
}
