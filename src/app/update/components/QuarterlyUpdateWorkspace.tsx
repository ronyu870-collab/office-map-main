'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, History, RotateCcw, Save } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { canWriteBusinessData } from '@/src/utils/accessControl';
import { useBuildings } from '@/src/hooks/useBuildings';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { handleDataFetchError } from '@/src/utils/errorHandler';
import { retryAsync } from '@/src/utils/retryAsync';
import { DataEntryToolbar } from '@/src/components/data-entry/DataEntryToolbar';
import { SaveStatus } from '@/src/components/data-entry/SaveStatus';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { AppHeader, Badge, Button, Dialog, EmptyState, ErrorState, LoadingState } from '@/src/components/ui';
import {
  buildQuarterlySubmissionPayload,
  getQuarterlyRowIssues,
  isQuarterlyRowComplete,
  type QuarterlyDraftRow,
} from '../quarterlyDataEntry';

import { quarterlyPresentation } from '../quarterlyPresentation';

import { QuarterlyDraftStore, packDraft, unpackDraft, hasConfirmedDraftPeriod, type DraftPayload, type DraftStorage } from '../quarterlyDraftStore';
import { inspectAccountRecovery } from '../quarterlyRecoveryCleanup';
import { legacyReferencePreferenceKey, readLegacyReferencePreference, writeLegacyReferencePreference, type LegacyReferenceDisposition } from '../quarterlyLegacyReferencePreference';
import { readQuarterlyPages } from '../quarterlyReadPages';
import { QuarterlySubmissionAttempt, type QuarterlyBatch, type SubmissionReceipt } from '../quarterlySubmissionAttempt';

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

interface QuarterlyEntryColumn {
  key: string;
  label: string;
  field?: string;
  reference?: string;
  step?: string;
  unit?: string;
}

// Desktop columns read left to right; mobile presents the same sequence top to bottom.
const QUARTERLY_ENTRY_COLUMNS: readonly QuarterlyEntryColumn[] = [
  { key: 'qQuote', label: '报价', field: 'qQuote', reference: 'asking_rent', step: '1' },
  { key: 'qProp', label: '物业费', field: 'qProp', reference: 'management_fee', step: '1' },
  { key: 'qFace', label: '表面租金', field: 'qFace', reference: 'face_rent', step: '0.01' },
  { key: 'qFree', label: '免租期', field: 'qFree', reference: 'rent_free_period', step: '0.1', unit: '个月' },
  { key: 'net', label: '净有效租金', reference: 'net_effective_rent' },
  { key: 'rentDelta', label: '租金变化' },
  { key: 'qVacArea', label: '空置面积', field: 'qVacArea', reference: 'vacant_area', step: '1', unit: '㎡' },
  { key: 'areaDelta', label: '面积变化' },
  { key: 'vacancy', label: '空置率', reference: 'vacancy_rate' },
  { key: 'qRemark', label: '备注', field: 'qRemark' },
];

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
  appearance?: 'compact' | 'mobile';
  issueSeverity?: 'error' | 'warning';
  describedBy?: string;
  labelledBy?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}

function RowField({ value, onChange, field, readOnly, issue, type = 'text', step, multiline, onKeyDown, appearance = 'compact', issueSeverity, describedBy, labelledBy }: RowFieldProps) {
  const mobile = appearance === 'mobile';
  const size = mobile ? 'min-h-11 rounded-md px-3 py-2 text-base leading-6' : 'rounded-[4px] px-1.5 py-1 text-[11px] leading-5';
  const tone = mobile
    ? (issueSeverity === 'error' ? 'border-rose-300 bg-rose-50/40' : 'border-slate-300 bg-white')
    : (issue ? 'border-amber-400 bg-amber-50/60' : 'border-zinc-300 bg-white');
  const focus = mobile ? 'focus:ring-2 focus:ring-[#003e7e]/10' : 'focus:ring-1 focus:ring-[#003e7e]/20';
  const className = `data-entry-cell w-full min-w-0 border ${size} outline-none transition focus:border-[#003e7e] ${focus} ${tone} ${readOnly ? 'cursor-not-allowed bg-zinc-100 text-zinc-400' : 'text-zinc-800'}`;
  if (multiline) {
    return (
      <textarea
        rows={1}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        data-quarterly-field={field}
        aria-invalid={Boolean(issue)}
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
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
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
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
  const [userRole, setUserRole] = React.useState('viewer');
  const [matchName, setMatchName] = React.useState('');
  const [draftUserName, setDraftUserName] = React.useState('');
  const [draftUserId, setDraftUserId] = React.useState('');
  const [isPreview, setIsPreview] = React.useState(false);
  const [previewUserName, setPreviewUserName] = React.useState('');
  const [currentTab, setCurrentTab] = React.useState('GradeA');
  const [mobileSelection, setMobileSelection] = React.useState<Record<string, string>>({});
  const mobileScrollRef = React.useRef<HTMLDivElement>(null);
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
  const [periodReady, setPeriodReady] = React.useState(false);
  const [resolvedPreviewQuery, setResolvedPreviewQuery] = React.useState<string | null | undefined>(undefined);
  const scopeReady = resolvedPreviewQuery === previewAsUserId;
  const [formalRows, setFormalRows] = React.useState<Array<Record<string, any>>>([]);
  const [formalError, setFormalError] = React.useState<string | null>(null);
  const [formalLoading, setFormalLoading] = React.useState(true);
  const [formalProvenance, setFormalProvenance] = React.useState<Record<string, string>>({});
  const [provenanceError, setProvenanceError] = React.useState<string | null>(null);
  const [formalRefresh, setFormalRefresh] = React.useState(0);
  const [showRecovery, setShowRecovery] = React.useState(false);
  const submissionLock = React.useRef(false);
  const tabSwitchLock = React.useRef(false);
  const stores = React.useRef(new Map<string, QuarterlyDraftStore>());

  const now = React.useMemo(() => new Date(), []);
  const [submitYear, setSubmitYear] = React.useState(now.getFullYear());
  const [submitQuarter, setSubmitQuarter] = React.useState(Math.ceil((now.getMonth() + 1) / 3));

  // Fetch only assigned projects after ownership resolves. Changing accounts or
  // preview targets must never expose a previous scope's fallback records.
  const buildingReadScope = React.useMemo(() => assignedBuildingIds === null ? null : JSON.stringify([
    currentUser?.id ?? '', draftUserId, userRole, isPreview, isImpersonating,
    [...assignedBuildingIds].sort(),
  ]), [assignedBuildingIds, currentUser?.id, draftUserId, userRole, isPreview, isImpersonating]);
  const { buildings, error: buildingsError, mutate } = useBuildings({
    buildingIds: assignedBuildingIds,
    cacheScope: buildingReadScope ?? undefined,
    revalidateOnMount: true,
  });
  const lastSuccessfulBuildings = React.useRef<{ scope: string; rows: any[] } | null>(null);
  React.useEffect(() => {
    if (buildings !== undefined && buildingReadScope !== null) {
      lastSuccessfulBuildings.current = { scope: buildingReadScope, rows: buildings };
    }
  }, [buildings, buildingReadScope]);
  const protectedBuildings = buildings !== undefined
    ? buildings
    : lastSuccessfulBuildings.current?.scope === buildingReadScope
      ? lastSuccessfulBuildings.current.rows
      : undefined;

  const myBuildings = React.useMemo(() => {
    if (!protectedBuildings || assignedBuildingIds === null) return [];
    const idSet = new Set(assignedBuildingIds);
    const result = protectedBuildings
      .filter((building: any) => idSet.has(building.id))
      .map((building: any) => {
        const copy: any = { ...building };
        const reference = (metricsMap[building.id] ?? []).find((metric: any) => (
          metric.record_year < submitYear
          || (metric.record_year === submitYear && metric.record_quarter < submitQuarter)
        )) ?? null;
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
  }, [protectedBuildings, assignedBuildingIds, metricsMap, futureSupplyAssignments, futureSupplyData, submitYear, submitQuarter]);

  React.useEffect(() => {
    let cancelled = false;
    setAssignmentsError(null);
    setPeriodReady(false);
    setResolvedPreviewQuery(undefined);
    setDraftUserId('');
    setDraftUserName('');
    setIsPreview(false);
    setPreviewUserName('');
    setAssignedBuildingIds(null);
    setMetricsMap({});
    setFutureSupplyAssignments([]);
    setFutureSupplyData({});
    setFormalRows([]);
    setFormalProvenance({});
    setCompletionNotice(null);
    setSubmitError(null);
    setShowRecovery(false);
    setShowIncompleteDialog(false);
    setReady(true);

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
        setDraftUserName(name);
        setDraftUserId(user.id);

        const { data: roleRow, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single();
        if (roleError) throw roleError;
        if (cancelled) return;
        const role = roleRow?.role ?? '';
        if (!['viewer', 'editor', 'admin'].includes(role)) {
          router.replace('/');
          return;
        }
        setUserRole(role);

        let assignmentUserId = user.id;
        if (previewAsUserId && roleRow?.role === 'admin') {
          setIsPreview(true);
          assignmentUserId = previewAsUserId;
          setDraftUserId(previewAsUserId);
          const { data: previewUser, error: previewError } = await supabase
            .from('user_roles')
            .select('chinese_name, full_name, email')
            .eq('user_id', previewAsUserId)
            .single();
          if (previewError) throw previewError;
          if (cancelled) return;
          setPreviewUserName(previewUser?.chinese_name || previewUser?.full_name || previewAsUserId);
          const previewDraftName = previewUser?.full_name || previewUser?.email?.split('@')[0] || '';
          if (previewDraftName) setDraftUserName(previewDraftName);
        }

        // Period/supply reads do not depend on building assignments or historical metrics.
        const periodReadyPromise = (async () => {
          try {
            const { data: settings, error: settingsError } = await supabase
              .from('app_settings')
              .select('key,value')
              .in('key', ['current_submission_year', 'current_submission_quarter']);
            const yearValue = settings?.find((row) => row.key === 'current_submission_year')?.value;
            const quarterValue = settings?.find((row) => row.key === 'current_submission_quarter')?.value;
            if (settingsError) throw settingsError;
            const effectiveYear = Number(yearValue);
            const effectiveQuarter = Number(quarterValue);
            if (!Number.isInteger(effectiveYear) || effectiveYear < 2020 || ![1, 2, 3, 4].includes(effectiveQuarter)) throw new Error('无法确认当前填报季度，请重试。');
            if (cancelled) return;
            setSubmitYear(effectiveYear);
            setSubmitQuarter(effectiveQuarter);

            const supplyAssignments = await readQuarterlyPages<Record<string, any>>((from, to) => supabase
              .from('future_supply_assignments')
              .select('id,future_supply_id,record_year,record_quarter')
              .eq('user_id', assignmentUserId)
              .eq('record_year', effectiveYear)
              .eq('record_quarter', effectiveQuarter).order('id').range(from, to));
            if (!cancelled) {
              setFutureSupplyAssignments(supplyAssignments ?? []);
              setFutureSupplyData({});
              if (supplyAssignments?.length) {
                const idsToLoad = supplyAssignments.map((assignment) => assignment.future_supply_id);
                const supplies: Record<string, any>[] = [];
                for (let start = 0; start < idsToLoad.length; start += 100) {
                  supplies.push(...await readQuarterlyPages<Record<string, any>>((from, to) => supabase
                    .from('future_supplies')
                    .select('id,name,submarket,grade,owner,total_area,district')
                    .in('id', idsToLoad.slice(start, start + 100))
                    .eq('is_entered_market', false).order('id').range(from, to)));
                }
                if (cancelled) return;
                const supplyMap: Record<string, any> = {};
                for (const supply of supplies ?? []) supplyMap[supply.id] = supply;
                setFutureSupplyData(supplyMap);
              }
            }
            return !cancelled;
          } catch (error) {
            if (!cancelled) setAssignmentsError('季度或未来供应任务读取失败，请重试，避免遗漏项目。');
            console.warn('[QuarterlyUpdate] period or future supply unavailable', error);
            return false;
          }
        })();

        const assignments = await retryAsync(async () => {
          return readQuarterlyPages((from, to) => supabase.from('building_assignments').select('building_id').eq('user_id', assignmentUserId).order('building_id').range(from, to));
        }, { attempts: 3, baseDelayMs: 250 });
        if (cancelled) return;
        const ids = assignments.map((assignment: any) => assignment.building_id as string);
        setAssignedBuildingIds(ids);

        if (ids.length > 0) {
          try {
            const metrics = await retryAsync(async () => {
              return readQuarterlyPages<Record<string, any>>((from, to) => supabase
                .from('building_metrics')
                .select('building_id,record_year,record_quarter,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacancy_rate,vacant_area,total_area')
                .in('building_id', ids)
                .order('record_year', { ascending: false })
                .order('record_quarter', { ascending: false }).order('building_id').range(from, to));
            }, { attempts: 3, baseDelayMs: 250 });
            const grouped: Record<string, any[]> = {};
            for (const row of metrics) (grouped[row.building_id] ||= []).push(row);
            if (!cancelled) setMetricsMap(grouped);
          } catch (error) {
            console.warn('[QuarterlyUpdate] building_metrics unavailable; continuing without prior-quarter reference', error);
          }
        }

        if (await periodReadyPromise && !cancelled) {
          setResolvedPreviewQuery(previewAsUserId);
          setPeriodReady(true);
        }
      } catch (error: any) {
        console.error('[QuarterlyUpdate] assignment load failed', error);
        if (!cancelled) {
          setAssignmentsError(`读取分配数据时发生异常：${error?.message ?? '未知错误'}`);
          setAssignedBuildingIds((previous) => previous ?? []);
        }
      }
    })();

    return () => { cancelled = true; };
  // Keep the original assignment lifecycle stable: explicit retry is the only refetch trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentsRetryKey, previewAsUserId, router]);

  React.useEffect(() => {
    const auth = supabase.auth;
    if (!auth?.onAuthStateChange) return;
    const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (currentUser?.id && session?.user?.id && session.user.id !== currentUser.id)) {
        // Keep scoped recovery copies, but stop exposing the previous account's form.
        setPeriodReady(false);
        setCurrentUser(null);
        setDraftUserId('');
        setAssignedBuildingIds(null);
        setFormalRows([]);
        setIsPreview(false);
        setAssignmentsRetryKey((value) => value + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, [currentUser?.id]);

  const storage = React.useMemo((): DraftStorage | null => {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
  }, []);
  const clientAckKey = draftUserId ? `quarterly-client-ack:20261008-v2:${encodeURIComponent(draftUserId)}` : '';
  const [acknowledgedEditorKey, setAcknowledgedEditorKey] = React.useState('');
  const storedAcknowledgement = React.useMemo(() => {
    try { return Boolean(clientAckKey && storage?.getItem(clientAckKey) === 'saved-closed-legacy-pages'); } catch { return false; }
  }, [clientAckKey, storage]);
  const editingAcknowledged = Boolean(clientAckKey && (storedAcknowledgement || acknowledgedEditorKey === clientAckKey));

  const draftStore = React.useMemo(() => {
    const identity = { userId: draftUserId, year: submitYear, quarter: submitQuarter, tab: currentTab };
    const key = JSON.stringify([identity, isPreview, isImpersonating, userRole, draftUserName]);
    const existing = stores.current.get(key);
    if (existing) return existing;
    const store = new QuarterlyDraftStore(identity, {
      read: async () => {
        const { data, error } = await supabase.from('update_drafts')
          .select('draft_data,updated_at,revision,record_year,record_quarter')
          .eq('user_id', identity.userId).eq('tab', identity.tab).maybeSingle();
        if (error) throw error;
        return data ? { payload: unpackDraft(data.draft_data), revision: Number(data.revision), updatedAt: data.updated_at, year: data.record_year, quarter: data.record_quarter, periodConfirmed: hasConfirmedDraftPeriod(data.draft_data, Number(data.revision), data.record_year, data.record_quarter) } : null;
      },
      save: async (payload, expectedRevision) => {
        if (!identity.userId || !canWriteBusinessData(userRole) || isPreview || isImpersonating) throw new Error('business_write_forbidden');
        const { data, error } = await supabase.rpc('save_quarterly_draft_v2', {
          p_user_id: identity.userId, p_user_name: draftUserName,
          p_year: identity.year, p_quarter: identity.quarter, p_tab: identity.tab,
          p_draft_data: packDraft(payload), p_expected_revision: expectedRevision,
        });
        if (error) throw error;
        const ack = Array.isArray(data) ? data[0] : data;
        return { revision: Number(ack?.revision), updatedAt: ack?.updated_at };
      },
    }, isPreview || isImpersonating || !draftUserId ? null : storage);
    stores.current.set(key, store);
    return store;
  }, [currentTab, draftUserId, draftUserName, isImpersonating, isPreview, storage, submitQuarter, submitYear, userRole]);
  const draftSnapshot = React.useSyncExternalStore(draftStore.subscribe, draftStore.getSnapshot, draftStore.getSnapshot);
  const legacyReference = draftSnapshot.quarantined ? null : draftSnapshot.historical;
  const referencePreferenceKey = legacyReference ? legacyReferencePreferenceKey(draftStore.identity, legacyReference) : null;
  // Ignoring a reference is a display choice, independent of the old-tab editing acknowledgement.
  const canRememberReferenceChoice = scopeReady && periodReady && currentUser?.id === draftUserId && canWriteBusinessData(userRole) && !isPreview && !isImpersonating;
  const referenceDisplayKey = referencePreferenceKey ? JSON.stringify([referencePreferenceKey, canRememberReferenceChoice]) : null;
  const [referenceChoices, setReferenceChoices] = React.useState<Record<string, LegacyReferenceDisposition>>({});
  const [referenceChoiceStorageFailed, setReferenceChoiceStorageFailed] = React.useState<Record<string, boolean>>({});
  const savedReferenceChoice = React.useMemo(() => canRememberReferenceChoice
    ? readLegacyReferencePreference(storage, referencePreferenceKey) : null, [canRememberReferenceChoice, referencePreferenceKey, storage]);
  const referenceChoice = referenceDisplayKey ? referenceChoices[referenceDisplayKey] ?? savedReferenceChoice : null;
  const rememberReferenceChoice = (disposition: LegacyReferenceDisposition) => {
    if (!scopeReady || !referenceDisplayKey || draftSnapshot.quarantined || submitting) return;
    setReferenceChoices((choices) => ({ ...choices, [referenceDisplayKey]: disposition }));
    const storageFailed = canRememberReferenceChoice && !writeLegacyReferencePreference(storage, referencePreferenceKey, disposition);
    setReferenceChoiceStorageFailed((failures) => ({ ...failures, [referenceDisplayKey]: storageFailed }));
    setShowRecovery(false);
  };
  const draftData = draftSnapshot.payload.regular;
  const futureSupplyDrafts = draftSnapshot.payload.future;
  const saveState = submitting ? 'submitting' : draftSnapshot.error ? 'error' : draftSnapshot.saving ? 'saving' : draftSnapshot.dirty ? 'unsaved' : draftSnapshot.updatedAt ? 'saved' : 'idle';
  const saveMessage = draftSnapshot.error ?? (draftSnapshot.dirty ? (draftSnapshot.localError ? '修改仍在本页，云端尚未确认' : '本机恢复副本已更新，等待云端确认') : draftSnapshot.loaded ? '云端版本已核验' : '正在读取云端草稿');
  const lastSavedAt = draftSnapshot.updatedAt;

  React.useEffect(() => {
    if (draftUserId && periodReady && scopeReady) void draftStore.load();
  }, [draftStore, draftUserId, periodReady, scopeReady]);

  const manualSave = React.useCallback(async () => {
    if (!scopeReady) return false;
    if (!periodReady || !editingAcknowledged || isPreview || isImpersonating || !canWriteBusinessData(userRole)) return false;
    return draftStore.flush();
  }, [draftStore, editingAcknowledged, isImpersonating, isPreview, periodReady, scopeReady, userRole]);

  React.useEffect(() => {
    if (!scopeReady || !periodReady || !editingAcknowledged || !draftUserId || isPreview || isImpersonating || !canWriteBusinessData(userRole)) return;
    let nextAttemptAt = Date.now() + 2_000;
    let stopped = false;
    const retry = async (online = false) => {
      const snapshot = draftStore.getSnapshot();
      if (stopped || navigator.onLine === false || snapshot.quarantined || snapshot.saving || snapshot.conflict || snapshot.remoteMissing || (!snapshot.dirty && !snapshot.error)) return;
      if (!online && Date.now() < nextAttemptAt) return;
      await manualSave();
      const failures = draftStore.getSnapshot().retryCount;
      nextAttemptAt = Date.now() + (failures ? Math.min(60_000, 2_000 * 2 ** Math.min(failures - 1, 5)) : 2_000);
    };
    // Stable cadence: typing must not keep postponing autosave indefinitely.
    const timer = window.setInterval(() => { void retry(); }, 1_000);
    const online = () => { void retry(true); };
    window.addEventListener('online', online);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('online', online); };
  }, [draftStore, draftUserId, editingAcknowledged, isImpersonating, isPreview, manualSave, periodReady, scopeReady, userRole]);

  React.useEffect(() => {
    const hasUnsaved = () => Array.from(stores.current.values()).some((store) => store.getSnapshot().dirty || store.getSnapshot().saving);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasUnsaved() || submissionLock.current) { event.preventDefault(); event.returnValue = ''; } };
    const guardLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      if (link && (hasUnsaved() || submissionLock.current) && !window.confirm('仍有未确认的云端保存或提交。离开前建议先保存；本机恢复副本会保留。确定离开？')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', guardLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', guardLink, true); };
  }, []);

  const switchTab = async (nextTab: string) => {
    if (nextTab === currentTab || tabSwitchLock.current || submissionLock.current) return;
    tabSwitchLock.current = true;
    try {
      // Read-only navigation must not require a write the user cannot perform.
      // Each category keeps its scoped controller and durable recovery copy.
      const canSave = periodReady && editingAcknowledged && !isPreview && !isImpersonating && canWriteBusinessData(userRole) && !draftSnapshot.quarantined;
      if (canSave && (draftStore.getSnapshot().dirty || draftStore.getSnapshot().saving) && !await manualSave()) return;
      setCurrentTab(nextTab);
      setCompletionNotice(null);
      setSubmitError(null);
    } finally { tabSwitchLock.current = false; }
  };

  const updateRegularField = (buildingId: string, field: string, value: string) => {
    if (readOnly || submissionLock.current) return;
    draftStore.edit('regular', buildingId, field, value);
    setCompletionNotice(null);
  };
  const updateFutureField = (futureSupplyId: string, legacyAssignmentId: string, field: string, value: string) => {
    if (readOnly || submissionLock.current) return;
    draftStore.edit('future', futureSupplyId, field, value, legacyAssignmentId);
    setCompletionNotice(null);
  };

  React.useEffect(() => {
    if (!draftUserId || !periodReady) return;
    let cancelled = false;
    setFormalRows([]);
    setFormalError(null);
    setFormalLoading(true);
    setFormalProvenance({});
    setProvenanceError(null);
    void (async () => {
      try {
        const [regular, future] = await Promise.all([
          readQuarterlyPages<Record<string, any>>((from, to) => supabase.from('quarterly_submissions').select('*').eq('user_id', draftUserId).eq('record_year', submitYear).eq('record_quarter', submitQuarter).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
          readQuarterlyPages<Record<string, any>>((from, to) => supabase.from('future_supply_submissions').select('*').eq('user_id', draftUserId).eq('record_year', submitYear).eq('record_quarter', submitQuarter).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
        ]);
        const seen = new Set<string>();
        const latest = [...regular, ...future].filter((row) => {
          const key = row.building_id ? `regular:${row.building_id}` : `future:${row.future_supply_id}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        if (!cancelled) setFormalRows(latest);
      } catch { if (!cancelled) setFormalError('本季度正式提交记录读取失败；不代表没有提交，草稿未受影响。'); }
      finally { if (!cancelled) setFormalLoading(false); }
    })();
    void readQuarterlyPages<Record<string, string>>((from, to) => supabase.from('quarterly_submission_provenance')
      .select('submission_id,entity_kind,source').eq('user_id', draftUserId).eq('record_year', submitYear).eq('record_quarter', submitQuarter).order('submission_id').range(from, to))
      .then((rows) => { if (!cancelled) setFormalProvenance(Object.fromEntries(rows.map((row) => [`${row.entity_kind}:${row.submission_id}`, row.source]))); })
      .catch(() => { if (!cancelled) setProvenanceError('提交来源暂不可读；不能据此判断记录是否经新流程确认。'); });
    return () => { cancelled = true; };
  }, [draftUserId, formalRefresh, periodReady, submitQuarter, submitYear]);

  const exportRecovery = () => {
    const localVersions: Record<string, unknown> = {};
    if (!isPreview && !isImpersonating) {
      try {
        const prefix = `quarterly-draft:v1:${encodeURIComponent(draftUserId)}:`;
        for (const key of Object.keys(window.localStorage)) if (key.startsWith(prefix)) {
          const raw = window.localStorage.getItem(key);
          try { localVersions[key] = raw ? JSON.parse(raw) : null; } catch { localVersions[key] = raw; }
        }
      } catch { /* Export the in-memory version even if storage is blocked. */ }
    }
    const content = { account: draftUserId, year: submitYear, quarter: submitQuarter, category: currentTab, local: draftStore.getSnapshot(), formal: formalRows, localVersions };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `quarterly-recovery-${submitYear}-Q${submitQuarter}-${currentTab}.json`; link.click(); URL.revokeObjectURL(url);
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
  const mobileScope = `${draftUserId}:${submitYear}:${submitQuarter}:${currentTab}`;
  const projectKey = (building: any) => building._isFutureSupply ? `future:${building._assignmentId ?? building.id}` : `building:${building.id}`;
  const selectedIndex = filteredBuildings.findIndex((building) => projectKey(building) === mobileSelection[mobileScope]);
  const mobileIndex = Math.max(0, selectedIndex);
  const mobileBuilding = filteredBuildings[mobileIndex];
  const mobileKey = mobileBuilding ? projectKey(mobileBuilding) : '';
  const selectMobileProject = (index: number) => {
    const building = filteredBuildings[index];
    if (building) setMobileSelection((selection) => ({ ...selection, [mobileScope]: projectKey(building) }));
  };
  React.useEffect(() => {
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
  }, [mobileScope, mobileKey]);
  const rowState = (building: any) => building._isFutureSupply
    ? futureSupplyDrafts[building.id] || futureSupplyDrafts[building._assignmentId] || {}
    : draftData[building.id] || {};
  const totalAreaFor = (building: any) => building._isFutureSupply
    ? safeNum(building.total_area)
    : safeNum(getVal(building, ['总面积', 'Total Area']));

  const completedCount = filteredBuildings.filter((building: any) => isQuarterlyRowComplete(rowState(building))).length;
  const exceptionCount = filteredBuildings.filter((building: any) => getQuarterlyRowIssues(rowState(building), totalAreaFor(building)).length > 0).length;
  const incompleteBuildings = filteredBuildings.filter((building: any) => !isQuarterlyRowComplete(rowState(building)));
  const readOnly = !canWriteBusinessData(userRole) || isPreview || isImpersonating || !periodReady || !editingAcknowledged || submitting || !scopeReady || Boolean(draftSnapshot.quarantined);

  const attemptState = React.useMemo(() => {
    try { return { attempt: new QuarterlySubmissionAttempt(draftStore.identity, isPreview || isImpersonating ? null : storage), error: null }; }
    catch (error) { return { attempt: null, error: error instanceof Error ? error.message : '提交恢复副本读取失败' }; }
  }, [draftStore, isImpersonating, isPreview, storage]);

  const executeSubmit = async () => {
    if (readOnly || submissionLock.current) return;
    submissionLock.current = true;
    setShowIncompleteDialog(false);
    setSubmitting(true);
    setSubmitError(null);
    setCompletionNotice(null);
    try {
      if (!currentUser?.id || currentUser.id !== draftUserId) throw new Error('当前登录身份已变化，请重新打开任务。');
      if (!attemptState.attempt) throw new Error(attemptState.error ?? '提交恢复不可用');
      if (!attemptState.attempt.hasPending() && filteredBuildings.some((building) => getQuarterlyRowIssues(rowState(building), totalAreaFor(building)).some((issue) => issue.severity === 'error'))) throw new Error('存在无效数字或超出计算范围的字段，请先修正。');
      if (!await manualSave()) throw new Error('草稿尚未获云端确认，已停止提交。请先处理保存失败或冲突。');
      const regularRows: Record<string, unknown>[] = [];
      const futureRows: Record<string, unknown>[] = [];
      const snapshot = draftStore.getSnapshot().payload;
      for (const building of filteredBuildings) {
        const draft = building._isFutureSupply ? snapshot.future[building.id] || snapshot.future[building._assignmentId] || {} : snapshot.regular[building.id] || {};
        if (!Object.values(draft).some((value) => value !== '' && value !== null && value !== undefined)) continue;
        const displayedDraft = building._isFutureSupply ? draft : { ...draft, qOwner: draft.qOwner ?? String(getVal(building, ['业主', 'Landlord']) || ''), qPropMan: draft.qPropMan ?? String(getVal(building, ['物业', '物业公司', 'Property Management']) || '') };
        const payload = buildQuarterlySubmissionPayload(displayedDraft, { userId: currentUser.id, userName: matchName, year: submitYear, quarter: submitQuarter, totalArea: totalAreaFor(building) });
        if (building._isFutureSupply) futureRows.push({ ...payload, future_supply_id: building.id });
        else regularRows.push({ ...payload, building_id: building.id });
      }
      if (!regularRows.length && !futureRows.length && !attemptState.attempt.hasPending()) throw new Error('当前分类尚未填写数据。历史草稿仅供参考，不会自动提交。');
      const batch: QuarterlyBatch = { p_user_id: currentUser.id, p_user_name: matchName, p_year: submitYear, p_quarter: submitQuarter, p_tab: currentTab, p_regular_rows: regularRows, p_future_rows: futureRows };
      const receipt = await attemptState.attempt.submit(batch, async (pendingBatch, requestId) => {
        const { data, error } = await supabase.rpc('submit_quarterly_batch_v2', { ...pendingBatch, p_request_id: requestId });
        if (error) throw error;
        return (Array.isArray(data) ? data[0] : data) as SubmissionReceipt;
      });
      const total = receipt.regular_count + receipt.future_count;
      logAction(currentUser.email, 'SUBMIT_QUARTERLY_DATA', { count: total, regular: receipt.regular_count, future: receipt.future_count, tab: currentTab, year: submitYear, quarter: submitQuarter, record_count: total, target_name: `${submitYear} Q${submitQuarter} · ${currentTab} 季度填报` });
      setCompletionNotice({ total, regular: receipt.regular_count, future: receipt.future_count });
      setFormalRefresh((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? '未知错误');
      setSubmitError(attemptState.attempt?.hasPending() ? `提交未确认：${message}。草稿已保留；重试会核验原请求，避免重复写入。` : `提交未完成：${message}。草稿已保留，请修正后重新提交。`);
    } finally { submissionLock.current = false; setSubmitting(false); }
  };

  const submitData = async () => {
    if (readOnly || submissionLock.current) return;
    if (!attemptState.attempt?.hasPending() && filteredBuildings.some((building) => getQuarterlyRowIssues(rowState(building), totalAreaFor(building)).some((issue) => issue.severity === 'error'))) { setSubmitError('存在无效数字或超出计算范围的字段，请修正后提交。未填字段仍可使用部分提交。'); return; }
    if (incompleteBuildings.length > 0 && !attemptState.attempt?.hasPending()) { setShowIncompleteDialog(true); return; }
    await executeSubmit();
  };

  const restoreLegacyDraft = () => {
    const original = draftStore.getSnapshot().historical;
    if (readOnly || !original || !window.confirm(`原草稿标记为 ${original.year} Q${original.quarter}，其来源仍待核实。载入后请逐项核对；不会自动提交，已有本地内容将另存恢复版本。继续？`)) return;
    if (!draftStore.replaceFromFormal(original.payload)) setSubmitError('恢复版本无法保存；请先导出当前草稿。');
    else rememberReferenceChoice('restored');
  };

  const restoreFormalRows = () => {
    if (readOnly || draftSnapshot.conflict || draftSnapshot.remoteMissing || !draftSnapshot.loaded) return;
    if (!window.confirm('将本分类正式提交记录载入编辑区。已有本地内容会另存恢复版本；请核对后再保存。继续？')) return;
    const payload: DraftPayload = { regular: { ...draftData }, future: { ...futureSupplyDrafts } };
    for (const building of filteredBuildings) {
      const row = formalRows.find((item) => building._isFutureSupply ? item.future_supply_id === building.id : item.building_id === building.id);
      if (!row) continue;
      const draft: QuarterlyDraftRow = {};
      for (const [field, column] of Object.entries({ qQuote: 'asking_rent', qProp: 'management_fee', qFace: 'face_rent', qFree: 'rent_free_period', qVacArea: 'vacant_area', qOwner: 'owner', qPropMan: 'property_management', qRemark: 'notes' })) draft[field] = row[column] == null ? '' : String(row[column]);
      payload[building._isFutureSupply ? 'future' : 'regular'][building.id] = draft;
    }
    if (!draftStore.replaceFromFormal(payload)) setSubmitError('本机恢复版本无法保存。请先导出草稿，再尝试载入正式记录。');
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
          title="填报任务加载失败"
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

  if (!ready || !periodReady || !scopeReady || protectedBuildings === undefined || assignedBuildingIds === null) {
    return <QuarterlyStateShell><LoadingState rows={0} label="正在加载季度填报任务" /></QuarterlyStateShell>;
  }

  if (assignedBuildingIds.length === 0 && futureSupplyAssignments.length === 0) {
    return (
      <QuarterlyStateShell>
        <EmptyState title="暂无填报任务" description="目前没有分配给您的填报任务，请联系管理员。" />
      </QuarterlyStateShell>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#f3f5f7] text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-white">
        <AppHeader
          title={<span className="flex items-center gap-2 max-sm:flex-wrap max-sm:gap-y-0">季度数据填报<Badge tone="brand">{submitYear} Q{submitQuarter}</Badge>{readOnly ? <Badge tone="warning">只读</Badge> : null}</span>}
          status={<span className="text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-secondary)]">{isPreview ? `管理员预览 · ${previewUserName}` : `${matchName} · ${TAB_LABELS[currentTab]}`}</span>}
          homeHref="/"
          actions={<SaveStatus state={saveState} message={saveMessage} savedAt={lastSavedAt} onRetry={() => { if (draftSnapshot.quarantined) void draftStore.load(); else void manualSave(); }} />}
        />
        {isPreview && <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-700">管理员预览模式：正在查看 {previewUserName} 的分配与草稿，不允许写入。</div>}
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 py-2 sm:px-5">
        {(['GradeA', 'GradeB', 'BP'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { void switchTab(tab); }}
            disabled={submitting}
            className={`rounded-[4px] border px-3 py-1.5 text-[11px] font-semibold transition ${currentTab === tab ? 'border-[#003e7e] bg-[#003e7e] text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="ml-auto hidden items-center divide-x divide-zinc-200 text-[10px] text-zinc-500 md:flex">
          <span className="px-2">项目 <strong className="tabular-nums text-zinc-800">{filteredBuildings.length}</strong></span>
          <span className="px-2">草稿完整 <strong className="tabular-nums text-emerald-700">{completedCount}</strong></span>
          <span className="pl-2">待检查 <strong className="tabular-nums text-amber-700">{exceptionCount}</strong></span>
        </div>
        <button type="button" className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded px-2 text-[11px] text-zinc-500 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-[#003e7e] md:ml-2" onClick={() => setShowRecovery(true)} aria-haspopup="dialog">
          <History size={14} aria-hidden="true" />历史记录
        </button>
      </div>

      {!editingAcknowledged && canWriteBusinessData(userRole) && !isPreview && !isImpersonating && <section className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 sm:px-5" aria-label="新版编辑安全确认">
        <p className="min-w-0 flex-1 basis-52 leading-relaxed">请先保存并关闭其他设备或标签页中的旧版填报页面。</p>
        <button type="button" className="min-h-9 shrink-0 rounded border border-amber-400 bg-white px-3 py-1.5 font-semibold" onClick={() => {
          if (!clientAckKey) return;
          try { storage?.setItem(clientAckKey, 'saved-closed-legacy-pages'); } catch { /* The current page can still record the explicit acknowledgement. */ }
          setAcknowledgedEditorKey(clientAckKey);
        }}>开始填写</button>
      </section>}

      {(draftSnapshot.error || (draftSnapshot.localError && !isPreview && !isImpersonating) || attemptState.error || attemptState.attempt?.hasPending()) && <section className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2 text-xs" aria-label="填报提示">
        {draftSnapshot.error && <div role="alert" className="mt-1 text-rose-700">{draftSnapshot.error}</div>}
        {draftSnapshot.localError && !isPreview && !isImpersonating && <div role="alert" className="mt-1 text-rose-700">{draftSnapshot.localError}</div>}
        {attemptState.error && <div role="alert" className="mt-1 text-rose-700">{attemptState.error}</div>}
        {attemptState.attempt?.hasPending() && <div role="alert" className="mt-1 text-amber-800">有一笔提交尚未确认，请重试提交。</div>}
      </section>}

      <Dialog open={showRecovery} onOpenChange={setShowRecovery} title="历史记录" size="xl" footer={<><Button variant="secondary" onClick={exportRecovery}>导出备份</Button><Button onClick={() => setShowRecovery(false)}>返回填写</Button></>}>
        <section className="text-xs" aria-label="季度记录与恢复">
        {submitError && <p role="alert" className="mb-2 text-rose-700">{submitError}</p>}
        {legacyReference && !referenceChoice && <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-zinc-700" role="status" aria-label="原草稿参考提示">
          <strong>历史草稿</strong> · {Object.keys(legacyReference.payload.regular).length + Object.keys(legacyReference.payload.future).length} 个项目
          <p className="mt-1">载入后请核对季度和数据，再保存或提交。</p>
          <div className="mt-1 text-[11px]">{[...Object.entries(legacyReference.payload.regular), ...Object.entries(legacyReference.payload.future)].slice(0, 3).map(([id, row]) => <div key={id}>{myBuildings.find((building) => building.id === id || building._assignmentId === id)?.name ?? id}：报价 {row.qQuote ?? '未填'}，表面租金 {row.qFace ?? '未填'}，空置面积 {row.qVacArea ?? '未填'}</div>)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">{!readOnly && <button type="button" className="min-h-9 rounded border border-zinc-300 bg-white px-3 py-1 font-semibold" onClick={restoreLegacyDraft}>载入草稿</button>}<button type="button" className="min-h-9 px-2 text-zinc-500" disabled={!referenceDisplayKey || submitting} onClick={() => rememberReferenceChoice('ignored')}>{canRememberReferenceChoice ? '暂不使用' : '收起提示'}</button></div>
          <p className="mt-1 text-[11px] text-zinc-500">暂不使用会保留草稿，当前填写不变。</p>
        </div>}
        <div className="mt-2">
          {referenceChoice && referenceDisplayKey && referenceChoiceStorageFailed[referenceDisplayKey] && <p role="status" className="mb-2 text-amber-800">仅在本页收起，浏览器未能记住选择</p>}
          <p className="mb-2">{submitYear} Q{submitQuarter} · {TAB_LABELS[currentTab]}。使用历史数据前请核对季度。</p>{provenanceError && <p role="alert" className="mb-2 text-amber-800">{provenanceError}</p>}
          {formalLoading && <p role="status" className="mb-2 text-zinc-500">正在加载记录…</p>}
          {formalError && <div role="alert" className="mb-2 text-rose-700">{formalError} <button type="button" className="underline" onClick={() => setFormalRefresh((value) => value + 1)}>重试</button></div>}
          {!readOnly && <button type="button" className="mb-2 min-h-9 rounded border px-3 py-1" disabled={!draftSnapshot.loaded || Boolean(draftSnapshot.conflict || draftSnapshot.remoteMissing) || !formalRows.length} onClick={restoreFormalRows}>载入已提交数据</button>}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <caption className="text-left font-semibold">本季度提交记录</caption>
            <thead><tr>{['项目', '报价', '物业费', '表面租金', '免租期', '空置面积', '备注', '记录时间', '来源'].map((label) => <th key={label} className="p-1">{label}</th>)}</tr></thead>
            <tbody>{formalRows.map((row) => <tr key={row.id ?? `${row.building_id ?? row.future_supply_id}-${row.created_at}`}>
              <td className="p-1">{myBuildings.find((building) => building.id === (row.building_id ?? row.future_supply_id))?.name ?? row.building_id ?? row.future_supply_id}</td>
              {['asking_rent', 'management_fee', 'face_rent', 'rent_free_period', 'vacant_area', 'notes', 'created_at'].map((field) => <td key={field} className="p-1">{row[field] ?? '未填'}</td>)}
              <td className="p-1">{formalProvenance[`${row.building_id ? 'regular' : 'future'}:${row.id}`] === 'user_confirmed_submission' ? '新流程用户提交（非独立核验）' : '来源未确认'}</td>
            </tr>)}</tbody>
          </table>
          </div>
          {draftSnapshot.quarantined && <details open className="mt-3"><summary>格式异常的原始草稿（已隔离，未覆盖）</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(draftSnapshot.quarantined.raw, null, 2)}</pre></details>}
          {draftSnapshot.historical && <details className="mt-3"><summary>原有草稿 {draftSnapshot.historical.year} Q{draftSnapshot.historical.quarter}（季度待核对）</summary><p className="my-1 break-words text-zinc-500">原稿保存时间：{draftSnapshot.historical.updatedAt}。保存时间不代表数据所属季度。</p>{referenceChoice && !readOnly && <button type="button" className="my-1 min-h-9 rounded border px-3 py-1" onClick={restoreLegacyDraft}>载入草稿</button>}{referenceChoice && canRememberReferenceChoice && <button type="button" className="ml-3 min-h-9 px-2 text-zinc-500" disabled={submitting || Boolean(draftSnapshot.quarantined)} onClick={() => rememberReferenceChoice('ignored')}>暂不使用</button>}<pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(packDraft(draftSnapshot.historical.payload), null, 2)}</pre></details>}
          {!isPreview && !isImpersonating && <p className="mt-3 text-zinc-500">清理本机备份前，请先保存草稿或导出备份。</p>}
          {!readOnly && <button type="button" className="mt-2 underline" disabled={draftSnapshot.dirty || draftSnapshot.saving || Boolean(draftSnapshot.conflict || draftSnapshot.remoteMissing)} onClick={() => {
            if (window.confirm('仅清除此分类已同步的本机当前副本；云端草稿与恢复历史不受影响。继续？')) draftStore.clearAcknowledgedLocalCopy();
          }}>清除已同步的本机当前副本</button>}
          {!readOnly && <button type="button" className="ml-3 mt-2 underline" onClick={() => {
            if (Array.from(stores.current.values()).some((store) => store.getSnapshot().dirty || store.getSnapshot().saving)) { setSubmitError('仍有未同步修改，请先保存或导出，不能清除恢复副本。'); return; }
            try {
              const inspection = inspectAccountRecovery(window.localStorage, draftUserId);
              if (inspection.status === 'invalid') { setSubmitError('无法确认本机恢复副本状态，未执行清除。请先导出并检查异常副本。'); return; }
              if (inspection.status === 'pending') { setSubmitError('有其他季度/分类的未同步修改或未确认提交，请先导出并处理，不能清除。'); return; }
              const keys = inspection.keys;
              if (!window.confirm('将删除此账号在本机的当前副本及全部冲突恢复历史（不可撤销）。云端记录不受影响。请先导出，确定清除？')) return;
              // A different window can create a pending request while confirmation is open.
              const confirmed = inspectAccountRecovery(window.localStorage, draftUserId);
              if (confirmed.status !== 'safe') { setSubmitError('本机恢复副本状态已变化，未执行清除；请重新检查并导出。'); return; }
              keys.filter((key) => confirmed.keys.includes(key)).forEach((key) => window.localStorage.removeItem(key));
            } catch { setSubmitError('无法确认本机恢复副本状态，未执行清除。'); }
          }}>清除此账号本机恢复历史</button>}
        </div>
        </section>
      </Dialog>

      <main className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-zinc-200 bg-white">
          {(completionNotice || (!showRecovery && submitError)) && (
            <div className="shrink-0 border-b border-zinc-200 p-2.5">
              {completionNotice ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <CheckCircle2 size={15} />
                  <strong>提交成功</strong>
                  <span>已写入 {completionNotice.total} 条（普通楼宇 {completionNotice.regular} / 未来供应 {completionNotice.future}）。云草稿已保留。</span>
                  <button onClick={() => setCompletionNotice(null)} className="ml-auto font-semibold underline underline-offset-2">继续录入</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <ValidationMessage severity="error">{submitError}</ValidationMessage>
                  <button onClick={() => { void executeSubmit(); }} className="rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">重试提交</button>
                </div>
              )}
            </div>
          )}

          <div className="hidden min-h-0 flex-1 overflow-auto md:block">
            <table className="w-full min-w-[1760px] border-collapse text-[11px]">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-zinc-200 text-[10px] text-zinc-500">
                  <th colSpan={5} className="border-r border-zinc-200 bg-zinc-50 px-2 py-1.5 text-left">项目概况</th>
                  <th colSpan={7} className="border-r border-zinc-200 bg-slate-50 px-2 py-1.5 text-left text-slate-600">历史参考</th>
                  <th colSpan={10} className="bg-[#fffaf0] px-2 py-1.5 text-left text-amber-800">本季度填报</th>
                </tr>
                <tr className="border-b border-zinc-200 bg-white text-zinc-600">
                  {['序号','项目','子市场','业主 / 物业','总面积','报价','物业费','表面租金','免租期','净有效租金','空置面积','空置率', ...QUARTERLY_ENTRY_COLUMNS.map((column) => column.label)].map((label, index) => (
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
                  const presentation = quarterlyPresentation(draft, totalArea, building._referenceData, isFuture);
                  const change = (field: string, value: string) => isFuture ? updateFutureField(building.id, building._assignmentId, field, value) : updateRegularField(building.id, field, value);
                  const defaultOwner = isFuture ? '' : String(getVal(building, ['业主', 'Landlord']) || '');
                  const defaultPm = isFuture ? '' : String(getVal(building, ['物业', '物业公司', 'Property Management']) || '');

                  return (
                    <tr key={`${isFuture ? 'future' : 'building'}-${building.id}`} className={`border-b border-zinc-100 hover:bg-zinc-50/70 ${isFuture ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-2 py-1.5 text-center text-zinc-400">{index + 1}</td>
                      <td className={`sticky left-0 z-10 min-w-44 border-r border-zinc-200 px-2 py-1.5 font-semibold ${isFuture ? 'bg-amber-50 text-amber-800' : 'bg-white text-[#003e7e]'}`}><div className="truncate" title={String(name)}>{String(name)}</div>{building._referenceData && <span className="block text-[10px] font-normal text-zinc-500">参考期 {building._referenceData.record_year} Q{building._referenceData.record_quarter}</span>}{issues.length > 0 && <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700"><AlertTriangle size={10} /> 待检查</span>}</td>
                      <td className="px-2 py-1.5 text-zinc-600">{String(submarket)}</td>
                      <td className="min-w-40 px-1 py-1"><div className="grid grid-cols-2 gap-1"><RowField value={draft.qOwner ?? defaultOwner} onChange={(value) => change('qOwner', value)} field="qOwner" readOnly={readOnly} multiline /><RowField value={draft.qPropMan ?? defaultPm} onChange={(value) => change('qPropMan', value)} field="qPropMan" readOnly={readOnly} multiline /></div></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{totalArea > 0 ? Math.round(totalArea).toLocaleString() : '未知'}</td>
                      {Object.entries(presentation.historical).map(([field, value]) => <td key={field} className="bg-slate-50/70 px-2 py-1.5 text-right tabular-nums text-zinc-500">{value}</td>)}
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qQuote} onChange={(value) => change('qQuote', value)} field="qQuote" readOnly={readOnly} issue={issueFor('qQuote')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qProp} onChange={(value) => change('qProp', value)} field="qProp" readOnly={readOnly} issue={issueFor('qProp')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qFace} onChange={(value) => change('qFace', value)} field="qFace" readOnly={readOnly} issue={issueFor('qFace')} type="number" step="0.01" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qFree} onChange={(value) => change('qFree', value)} field="qFree" readOnly={readOnly} issue={issueFor('qFree')} type="number" step="0.1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right font-semibold tabular-nums text-amber-800">{presentation.current.net}</td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right tabular-nums">{presentation.current.rentDelta}</td>
                      <td className="bg-[#fffdf7] px-1 py-1"><RowField value={draft.qVacArea} onChange={(value) => change('qVacArea', value)} field="qVacArea" readOnly={readOnly} issue={issueFor('qVacArea')} type="number" step="1" onKeyDown={handleGridKeyDown} /></td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right tabular-nums">{presentation.current.areaDelta}</td>
                      <td className="bg-[#fffaf0] px-2 py-1.5 text-right font-semibold tabular-nums text-[#003e7e]">{presentation.current.vacancy}</td>
                      <td className="min-w-40 bg-[#fffdf7] px-1 py-1"><RowField value={draft.qRemark} onChange={(value) => change('qRemark', value)} field="qRemark" readOnly={readOnly} multiline /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:hidden">
            {mobileBuilding && <nav className="shrink-0 border-b border-slate-200 bg-white px-3 pt-2" aria-label="手机项目切换">
              <div className="relative">
                <label htmlFor="mobile-project-picker" className="sr-only">选择项目</label>
                <select id="mobile-project-picker" value={mobileKey} onChange={(event) => {
                  const index = filteredBuildings.findIndex((building) => projectKey(building) === event.target.value);
                  selectMobileProject(index);
                }} className="min-h-11 w-full min-w-0 appearance-none truncate rounded-md border border-slate-200 bg-white py-2 pl-3 pr-9 text-base font-semibold text-[#003e7e] outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10">
                  {filteredBuildings.map((building: any) => <option key={projectKey(building)} value={projectKey(building)}>{String(building._isFutureSupply ? building.name : getVal(building, ['写字楼名称', 'name']) || '-')}</option>)}
                </select>
                <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => selectMobileProject(mobileIndex - 1)} disabled={mobileIndex === 0} className="inline-flex min-h-11 items-center gap-1 pr-3 text-xs font-medium text-[#003e7e] disabled:text-slate-300"><ChevronLeft size={14} aria-hidden="true" />上一个</button>
                <span className="text-[11px] tabular-nums text-slate-500" aria-label="项目序号">{mobileIndex + 1} / {filteredBuildings.length}</span>
                <button type="button" onClick={() => selectMobileProject(mobileIndex + 1)} disabled={mobileIndex === filteredBuildings.length - 1} className="inline-flex min-h-11 items-center gap-1 pl-3 text-xs font-medium text-[#003e7e] disabled:text-slate-300">下一个<ChevronRight size={14} aria-hidden="true" /></button>
              </div>
            </nav>}
            <div ref={mobileScrollRef} className="min-h-0 flex-1 overflow-y-auto" aria-label="手机项目填写区">
            {filteredBuildings.length === 0 && <p className="p-10 text-center text-sm text-zinc-400">当前分类没有需要填报的项目。</p>}
            {mobileBuilding && [mobileBuilding].map((building: any) => {
              const draft = rowState(building);
              const totalArea = totalAreaFor(building);
              const issues = getQuarterlyRowIssues(draft, totalArea);
              const issueFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error') ?? issues.find((issue) => issue.field === field);
              const change = (field: string, value: string) => building._isFutureSupply ? updateFutureField(building.id, building._assignmentId, field, value) : updateRegularField(building.id, field, value);
              const name = building._isFutureSupply ? building.name : getVal(building, ['写字楼名称', 'name']) || '-';
              const reference = building._referenceData;
              const presentation = quarterlyPresentation(draft, totalArea, reference, building._isFutureSupply === true);
              const missing = issues.filter((issue) => issue.severity === 'warning').length;
              const error = issues.find((issue) => issue.severity === 'error');
              return (
                <section key={projectKey(building)} className="px-3 py-3" aria-label={`${String(name)}填报`}>
                  <p className="mb-2 text-[11px] leading-4 text-slate-500">{String(building.submarket || '')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1 block text-[11px] font-medium text-slate-500">业主</span><RowField value={draft.qOwner ?? (building._isFutureSupply ? '' : String(getVal(building, ['业主', 'Landlord']) || ''))} onChange={(value) => change('qOwner', value)} field="qOwner" readOnly={readOnly} multiline appearance="mobile" /></label>
                    <label><span className="mb-1 block text-[11px] font-medium text-slate-500">物业</span><RowField value={draft.qPropMan ?? (building._isFutureSupply ? '' : String(getVal(building, ['物业', '物业公司', 'Property Management']) || ''))} onChange={(value) => change('qPropMan', value)} field="qPropMan" readOnly={readOnly} multiline appearance="mobile" /></label>
                  </div>
                  <div className="my-2 flex items-center justify-between text-[11px] leading-5 text-slate-500"><span>总面积</span><span className="tabular-nums">{totalArea > 0 ? `${Math.round(totalArea).toLocaleString()} ㎡` : '未知'}</span></div>
                  <table className="w-full table-fixed border-collapse text-xs" aria-label={`${String(name)}季度指标对照`}>
                    <caption className="sr-only">指标按电脑端表格顺序排列，历史参考在左，本季填写在右。</caption>
                    <colgroup><col className="w-[30%]" /><col className="w-[27%]" /><col className="w-[43%]" /></colgroup>
                    <thead>
                      <tr className="border-y border-slate-200 text-left">
                        <th scope="col" className="py-2 text-[11px] font-medium text-slate-500">指标</th>
                        <th scope="col" className="bg-slate-50 px-2 py-2 text-right font-normal"><span className="block text-[10px] leading-4 text-slate-500">历史参考</span><span className="block text-[11px] leading-4 tabular-nums text-slate-600">{reference ? `${reference.record_year} Q${reference.record_quarter}` : '暂无历史数据'}</span></th>
                        <th scope="col" className="pl-3 py-2 text-right"><span className="block text-[10px] font-medium leading-4 text-[#003e7e]">本季填写</span><span className="block text-[11px] font-medium leading-4 tabular-nums text-[#003e7e]">{submitYear} Q{submitQuarter}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {QUARTERLY_ENTRY_COLUMNS.map((column) => {
                        const labelId = `mobile-label-${building.id}-${column.key}`;
                        const historyId = `mobile-history-${building.id}-${column.key}`;
                        const historical = column.reference
                          ? presentation.historical[column.reference as keyof typeof presentation.historical]
                          : '—';
                        const historicalWithUnit = historical !== '—' && column.unit ? `${historical} ${column.unit}` : historical;
                        const issue = column.field ? issueFor(column.field) : undefined;
                        return (
                          <tr key={column.key} className="h-12 border-b border-slate-100" aria-label={`${column.label}对照`}>
                            <th scope="row" id={labelId} className="pr-1 text-left text-xs font-medium leading-4 text-slate-700">{column.label}{column.field && column.key !== 'qRemark' ? <> <span className="text-slate-400">*</span></> : null}</th>
                            {column.key === 'qRemark' ? <td colSpan={2} className="py-2 pl-2"><RowField value={draft.qRemark} onChange={(value) => change('qRemark', value)} field="qRemark" readOnly={readOnly} multiline appearance="mobile" labelledBy={labelId} /></td> : <>
                              <td className="bg-slate-50/70 px-2 py-0.5 text-right align-middle"><p id={historyId} className="text-[12px] leading-4 tabular-nums text-slate-500" aria-label={`${column.label}历史参考：${historicalWithUnit}`}><span className="sr-only">历史</span>{historicalWithUnit}</p></td>
                              <td className="py-0.5 pl-3 text-right align-middle">{column.field ? <RowField value={draft[column.field]} onChange={(value) => change(column.field!, value)} field={column.field} readOnly={readOnly} issue={issue?.message} issueSeverity={issue?.severity === 'error' ? 'error' : 'warning'} type="number" step={column.step} appearance="mobile" describedBy={historyId} labelledBy={labelId} /> : <output className="inline-flex min-h-11 items-center justify-end text-sm font-semibold tabular-nums text-[#003e7e]" aria-labelledby={labelId}>{presentation.current[column.key as keyof typeof presentation.current]}{column.key === 'areaDelta' && presentation.current.areaDelta !== '—' ? ' ㎡' : ''}</output>}</td>
                            </>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {error ? <div className="mt-3"><ValidationMessage severity="error">{error.message}</ValidationMessage></div> : missing > 0 ? <p className="mt-2 text-[11px] leading-4 text-slate-500">还有 {missing} 项待填写</p> : issues.length > 0 ? <div className="mt-3"><ValidationMessage severity="info">{issues[0].message}</ValidationMessage></div> : null}
                </section>
              );
            })}
            </div>
          </div>

          <DataEntryToolbar className="shrink-0" leading={<span className="hidden text-[10px] text-zinc-500 md:inline">草稿自动保存</span>}>
            {!readOnly && <button type="button" onClick={() => { void manualSave(); }} disabled={saveState === 'saving' || submitting} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Save size={13} /> 保存草稿</button>}
            {!readOnly && <button type="button" onClick={() => { void submitData(); }} disabled={submitting} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#003e7e] px-3.5 text-[11px] font-semibold text-white hover:bg-[#003566] disabled:opacity-50">{submitting ? <RotateCcw size={13} className="animate-spin" /> : null}{submitting ? '提交中…' : '提交当前分类'}</button>}
            {readOnly && <span className="text-[11px] font-medium text-zinc-400">{userRole === 'viewer' ? '只读模式' : isImpersonating ? '模拟模式' : isPreview ? '预览模式' : !editingAcknowledged ? '点击“开始填写”后可编辑' : '暂时无法编辑'}</span>}
          </DataEntryToolbar>
        </div>
      </main>

      <Dialog
        open={Boolean(draftSnapshot.conflict || draftSnapshot.remoteMissing)}
        onOpenChange={() => {}}
        title="草稿版本冲突"
        description="本地修改和云端新版本都已保留。请先比较或导出，再选择；不会自动覆盖。"
        footer={<>
          <Button variant="secondary" onClick={exportRecovery}>导出两份版本</Button>
          {!readOnly && <Button variant="secondary" onClick={() => { void draftStore.resolveConflict('remote'); }}>使用云端版本</Button>}
          {!readOnly && <Button onClick={() => { void draftStore.resolveConflict('local'); }}>保留本地版本待保存</Button>}
        </>}
      >
        <div className="grid max-h-72 gap-3 overflow-auto sm:grid-cols-2">
          <div><strong>本地修改</strong><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(packDraft(draftSnapshot.payload), null, 2)}</pre></div>
          <div><strong>云端版本 {draftSnapshot.conflict?.revision}</strong><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(draftSnapshot.conflict && packDraft(draftSnapshot.conflict.payload), null, 2)}</pre></div>
        </div>
      </Dialog>

      <Dialog
        open={showIncompleteDialog}
        onOpenChange={setShowIncompleteDialog}
        title="存在未填完的项目"
        description="报价、物业费、表面租金、免租期、空置面积用于完整填报；可提交尚未填齐的记录。无效数字和超出范围的数值需先修正。净有效租金按36个月租约计算，免租期需在0至36个月内。"
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



