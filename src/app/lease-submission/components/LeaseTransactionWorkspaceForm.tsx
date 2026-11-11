'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react';

import { leaseTransactionSchema, type LeaseTransactionFormData } from '../schemas/leaseTransactionSchema';
import { dbGradeToFormGrade, getAvailableLeasePeriods, mapLeaseRecordToFormDefaults } from '../leaseEntryModel';
import { buildLeaseTransactionChanges, type LeaseFieldChange } from '../leaseTransactionChangeHistory';
import { FormField } from './FormField';
import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import { SaveStatus, type SaveState } from '@/src/components/data-entry/SaveStatus';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { DataEntryToolbar } from '@/src/components/data-entry/DataEntryToolbar';
import { checkFuzzyDuplicate, getAllBrokers, submitTransaction, updateTransaction } from '@/src/services/leaseTransactionSubmitService';
import {
  deleteLeaseTransactionDraft,
  getLeaseTransactionDraft,
  saveLeaseTransactionDraft,
  type LeaseTransactionDraftSnapshot,
} from '@/src/services/leaseTransactionDraftService';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useBuildings } from '@/src/hooks/useBuildings';
import { logAction } from '@/src/utils/audit';
import { supabase } from '@/src/services/supabaseClient';
import type { DuplicateCheckResult, LeaseTransaction } from '@/src/types/lease-transaction';
import { Button, Dialog } from '@/src/components/ui';

interface LeaseTransactionFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  userId: string;
  userName: string;
  mode?: 'create' | 'edit';
  initialData?: LeaseTransaction;
}

interface SectionProps {
  index: string;
  title: string;
  children: React.ReactNode;
}

function Section({ index, title, children }: SectionProps) {
  return (
    <section className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[var(--cd-font-size-xs)] font-semibold tabular-nums text-[var(--cd-color-brand)]">{index}</span>
        <h3 className="text-[var(--cd-font-size-sm)] font-semibold text-[var(--cd-color-text-primary)]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

interface DuplicateDialogProps {
  duplicates: LeaseTransaction[];
  onCancel: () => void;
  onConfirm: () => void;
}

function DuplicateDialog({ duplicates, onCancel, onConfirm }: DuplicateDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-600" />发现疑似重复记录</span>}
      description="沿用现有规则：不同顾问可以提交相似记录，只要确认并非同一笔交易即可继续。"
      size="lg"
      footer={<><Button variant="secondary" onClick={onCancel}>返回检查</Button><Button onClick={onConfirm}>确认不是同一笔并提交</Button></>}
    >
        <div className="max-h-[45vh] overflow-auto">
          <table className="w-full min-w-[700px] text-[11px]">
            <thead className="sticky top-0 bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)]"><tr>{['提交人','企业','楼宇','面积','成交年份','成交季度','提交时间'].map((label) => <th key={label} className="border-b border-[var(--cd-color-border)] px-3 py-2 text-left font-semibold">{label}</th>)}</tr></thead>
            <tbody>{duplicates.map((item, index) => <tr key={item.id ?? index} className="border-b border-[var(--cd-color-border)]"><td className="px-3 py-2 font-medium text-[var(--cd-color-brand)]">{item.submitter_name || '-'}</td><td className="px-3 py-2">{item.company || '-'}</td><td className="px-3 py-2">{item.new_building || '-'}</td><td className="px-3 py-2 tabular-nums">{item.area_sqm?.toLocaleString('zh-CN') || '-'}</td><td className="px-3 py-2 tabular-nums">{item.transaction_year || '-'}</td><td className="px-3 py-2">{item.transaction_quarter || '-'}</td><td className="px-3 py-2 text-[var(--cd-color-text-muted)]">{item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-'}</td></tr>)}</tbody>
          </table>
        </div>
    </Dialog>
  );
}

interface EditConfirmationDialogProps {
  recordLabel: string;
  changes: LeaseFieldChange[];
  onCancel: () => void;
  onConfirm: () => void;
}

function EditConfirmationDialog({ recordLabel, changes, onCancel, onConfirm }: EditConfirmationDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="确认更新成交记录"
      size="lg"
      footer={<><Button variant="secondary" onClick={onCancel}>返回修改</Button><Button onClick={onConfirm}>确认更新</Button></>}
    >
      <p className="mb-3 text-xs text-zinc-500">{recordLabel} · 仅展示本次实际发生变化的字段。</p>
      <div className="max-h-[48vh] overflow-auto rounded-md border border-zinc-200 bg-white">
        <div className="grid grid-cols-[minmax(100px,.8fr)_1fr_1fr] border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[10px] font-semibold text-zinc-400">
          <span>字段</span><span>修改前</span><span>修改后</span>
        </div>
        {changes.map((change) => (
          <div key={change.key} className="grid grid-cols-[minmax(100px,.8fr)_1fr_1fr] border-b border-zinc-100 px-3 py-2.5 text-xs last:border-b-0">
            <span className="font-medium text-zinc-600">{change.label}</span>
            <span className="break-words pr-3 text-zinc-500">{change.beforeText}</span>
            <span className="break-words font-semibold text-zinc-900">{change.afterText}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">本次共修改 {changes.length} 项。确认后将写入数据库，并自动生成不可覆盖的变更记录。</p>
    </Dialog>
  );
}

const DEFAULTS: Partial<LeaseTransactionFormData> = {
  is_manual_building: false,
  is_manual_old_building: false,
  is_face_rent_estimated: false,
  is_effective_rent_estimated: false,
  floor_info: '',
  floor: '',
};

function monthlyRent(value: number | undefined, unit: 'monthly' | 'daily') {
  const amount = value ?? 0;
  return unit === 'daily' ? amount * 365 / 12 : amount;
}

export function LeaseTransactionForm({ isOpen, onClose, onSubmitSuccess, userId, userName, mode = 'create', initialData }: LeaseTransactionFormProps) {
  const { buildings, isLoading: buildingsLoading } = useBuildings({ revalidateOnMount: true });
  const [industryMap, setIndustryMap] = React.useState<Record<string, string[]>>({});
  const [isCustomSubIndustry, setIsCustomSubIndustry] = React.useState(false);
  const [customSubIndustryText, setCustomSubIndustryText] = React.useState('');
  const [brokers, setBrokers] = React.useState<Array<{ user_id: string; name: string }>>([]);
  const [isOnBehalf, setIsOnBehalf] = React.useState(false);
  const [behalfUserId, setBehalfUserId] = React.useState('');
  const [manualBuilding, setManualBuilding] = React.useState(false);
  const [manualOldBuilding, setManualOldBuilding] = React.useState(false);
  const [buildingLocked, setBuildingLocked] = React.useState(false);
  const [oldBuildingLocked, setOldBuildingLocked] = React.useState(false);
  const [faceRentUnit, setFaceRentUnit] = React.useState<'monthly' | 'daily'>('monthly');
  const [effectiveRentUnit, setEffectiveRentUnit] = React.useState<'monthly' | 'daily'>('monthly');
  const [floorInfoUnknown, setFloorInfoUnknown] = React.useState(false);
  const [floorUnknown, setFloorUnknown] = React.useState(false);
  const [oldAddressUnknown, setOldAddressUnknown] = React.useState(false);
  const [oldSubmarketUnknown, setOldSubmarketUnknown] = React.useState(false);
  const [oldDistrictUnknown, setOldDistrictUnknown] = React.useState(false);
  const [oldGradeUnknown, setOldGradeUnknown] = React.useState(false);
  const [recentBuildings, setRecentBuildings] = React.useState<string[]>([]);
  const [duplicates, setDuplicates] = React.useState<LeaseTransaction[]>([]);
  const [showDuplicate, setShowDuplicate] = React.useState(false);
  const [pendingEdit, setPendingEdit] = React.useState<{
    data: LeaseTransactionFormData;
    payload: LeaseTransaction;
    changes: LeaseFieldChange[];
  } | null>(null);
  const [forceSubmit, setForceSubmit] = React.useState(false);
  const forceSubmitRef = React.useRef(false);
  const [submitState, setSubmitState] = React.useState<SaveState>('idle');
  const [submitMessage, setSubmitMessage] = React.useState('带 * 的字段为必填项');
  const [submitError, setSubmitErrorMessage] = React.useState<string | null>(null);
  const [submittedRecord, setSubmittedRecord] = React.useState<LeaseTransaction | null>(null);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = React.useState(mode !== 'create');
  const [draftUiBaseline, setDraftUiBaseline] = React.useState('');
  const createInitializedRef = React.useRef(false);
  const editInitializedRef = React.useRef<string | null>(null);
  const draftLoadTokenRef = React.useRef(0);
  const savedDraftSignatureRef = React.useRef<string | null>(null);
  const operationRef = React.useRef<'saving' | 'submitting' | null>(null);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = React.useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
    reset,
    watch,
    setValue,
    getValues,
    setError,
    clearErrors,
  } = useForm<LeaseTransactionFormData>({
    resolver: zodResolver(leaseTransactionSchema) as Resolver<LeaseTransactionFormData>,
    mode: 'onTouched',
    defaultValues: DEFAULTS,
  });

  const demandType = watch('demand_type');
  const selectedYear = watch('transaction_year');
  const selectedIndustry = watch('industry');
  const selectedBuilding = watch('new_building');
  const selectedOldBuilding = watch('old_address');
  const { years: availableYears, quarters: availableQuarters } = React.useMemo(() => getAvailableLeasePeriods(new Date(), selectedYear), [selectedYear]);
  const allBuildingNames = React.useMemo(() => (buildings ?? []).map((building) => building.name).filter(Boolean).sort(), [buildings]);
  const submarkets = React.useMemo(() => Array.from(new Set((buildings ?? []).map((building) => building.submarket).filter((value): value is string => Boolean(value)))).sort(), [buildings]);
  const industryOptions = React.useMemo(() => Object.keys(industryMap).sort(), [industryMap]);
  const subIndustryOptions = selectedIndustry ? industryMap[selectedIndustry] ?? [] : [];
  const errorCount = Object.keys(errors).length;
  const dirtyCount = Object.keys(dirtyFields).length;

  const currentDraftUi = React.useMemo(() => ({
    isCustomSubIndustry,
    customSubIndustryText,
    isOnBehalf,
    behalfUserId,
    manualBuilding,
    manualOldBuilding,
    buildingLocked,
    oldBuildingLocked,
    faceRentUnit,
    effectiveRentUnit,
    floorInfoUnknown,
    floorUnknown,
    oldAddressUnknown,
    oldSubmarketUnknown,
    oldDistrictUnknown,
    oldGradeUnknown,
  }), [
    isCustomSubIndustry,
    customSubIndustryText,
    isOnBehalf,
    behalfUserId,
    manualBuilding,
    manualOldBuilding,
    buildingLocked,
    oldBuildingLocked,
    faceRentUnit,
    effectiveRentUnit,
    floorInfoUnknown,
    floorUnknown,
    oldAddressUnknown,
    oldSubmarketUnknown,
    oldDistrictUnknown,
    oldGradeUnknown,
  ]);
  const currentDraftUiSignature = React.useMemo(() => JSON.stringify(currentDraftUi), [currentDraftUi]);
  const currentDraftUiRef = React.useRef(currentDraftUi);
  currentDraftUiRef.current = currentDraftUi;
  useBodyScrollLock(isOpen);
  const busy = isSubmitting || submitState === 'saving' || submitState === 'submitting';
  const hasUnsavedChanges = React.useCallback(() => {
    if (submittedRecord) return false;
    if (mode === 'create' && savedDraftSignatureRef.current) {
      return JSON.stringify({ version: 1, values: getValues(), ui: currentDraftUiRef.current }) !== savedDraftSignatureRef.current;
    }
    return dirtyCount > 0 || Boolean(draftUiBaseline && JSON.stringify(currentDraftUiRef.current) !== draftUiBaseline);
  }, [dirtyCount, draftUiBaseline, getValues, mode, submittedRecord]);
  const requestClose = React.useCallback(() => {
    if (busy || operationRef.current || showLeaveConfirmation || showDuplicate || pendingEdit) return;
    if (hasUnsavedChanges()) setShowLeaveConfirmation(true);
    else onClose();
  }, [busy, hasUnsavedChanges, onClose, pendingEdit, showDuplicate, showLeaveConfirmation]);

  React.useEffect(() => {
    if (!isOpen) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!busy && !operationRef.current && !hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy, hasUnsavedChanges, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, requestClose]);

  React.useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem('lease-recent-buildings') || '[]');
      if (Array.isArray(stored)) setRecentBuildings(stored.filter((value): value is string => typeof value === 'string').slice(0, 5));
    } catch { setRecentBuildings([]); }

    void supabase.from('industry_classification').select('industry_level1,sub_industry').then(({ data }) => {
      if (!data) return;
      const map: Record<string, Set<string>> = {};
      for (const row of data) {
        if (!row.industry_level1 || !row.sub_industry) continue;
        (map[row.industry_level1] ||= new Set()).add(row.sub_industry);
      }
      const normalized: Record<string, string[]> = {};
      for (const [key, values] of Object.entries(map)) normalized[key] = Array.from(values).sort();
      setIndustryMap(normalized);
    });

    if (mode === 'create' && brokers.length === 0) {
      void getAllBrokers().then((list) => setBrokers(list.filter((broker) => broker.user_id !== userId))).catch((error) => console.error('获取业务员列表失败', error));
    }
  }, [isOpen, mode, brokers.length, userId]);

  React.useEffect(() => {
    if (!isOpen) {
      createInitializedRef.current = false;
      editInitializedRef.current = null;
      savedDraftSignatureRef.current = null;
      setShowLeaveConfirmation(false);
      setDraftHydrated(mode !== 'create');
      return;
    }

    if (mode === 'edit' && initialData) {
      const editKey = `${userId}:${initialData.id}`;
      // Option requests can finish after the user has started editing.
      if (editInitializedRef.current === editKey) return;
      editInitializedRef.current = editKey;
      savedDraftSignatureRef.current = null;
      setShowLeaveConfirmation(false);
      setSubmittedRecord(null);
      setSubmitErrorMessage(null);
      setSubmitState('idle');
      setSubmitMessage('已载入现有成交记录');
      setForceSubmit(false);
      forceSubmitRef.current = false;
      setShowDuplicate(false);
      setPendingEdit(null);
      setDraftHydrated(true);
      reset(mapLeaseRecordToFormDefaults(initialData));
      const standardSubIndustries = initialData.industry ? industryMap[initialData.industry] ?? [] : [];
      const customSubIndustry = Boolean(initialData.sub_industry && standardSubIndustries.length > 0 && !standardSubIndustries.includes(initialData.sub_industry));
      setIsCustomSubIndustry(customSubIndustry);
      setCustomSubIndustryText(customSubIndustry ? initialData.sub_industry || '' : '');
      setFaceRentUnit(Number(initialData.face_rent) > 0 && Number(initialData.face_rent) < 30 ? 'daily' : 'monthly');
      setEffectiveRentUnit(Number(initialData.effective_rent) > 0 && Number(initialData.effective_rent) < 30 ? 'daily' : 'monthly');
      setFloorInfoUnknown(initialData.floor_info === '未知');
      setFloorUnknown(initialData.floor === '未知');
      setOldAddressUnknown(initialData.old_address === '未知');
      setOldSubmarketUnknown(initialData.old_sub_market === '未知');
      setOldDistrictUnknown(initialData.old_district === '未知');
      setOldGradeUnknown(initialData.old_building_grade === '未知');
      const buildingMatch = (buildings ?? []).some((building) => building.name === initialData.new_building);
      setBuildingLocked(buildingMatch && !initialData.is_manual_building);
      setManualBuilding(Boolean(initialData.is_manual_building) || !buildingMatch);
      const oldMatch = initialData.old_address ? (buildings ?? []).some((building) => building.name === initialData.old_address) : false;
      setOldBuildingLocked(oldMatch && !initialData.is_manual_old_building);
      setManualOldBuilding(Boolean(initialData.is_manual_old_building) || Boolean(initialData.old_address && !oldMatch && initialData.old_address !== '未知'));
      setDraftUiBaseline(JSON.stringify({
        ...currentDraftUiRef.current,
        isCustomSubIndustry: customSubIndustry,
        customSubIndustryText: customSubIndustry ? initialData.sub_industry || '' : '',
        faceRentUnit: Number(initialData.face_rent) > 0 && Number(initialData.face_rent) < 30 ? 'daily' : 'monthly',
        effectiveRentUnit: Number(initialData.effective_rent) > 0 && Number(initialData.effective_rent) < 30 ? 'daily' : 'monthly',
        floorInfoUnknown: initialData.floor_info === '未知', floorUnknown: initialData.floor === '未知',
        oldAddressUnknown: initialData.old_address === '未知', oldSubmarketUnknown: initialData.old_sub_market === '未知',
        oldDistrictUnknown: initialData.old_district === '未知', oldGradeUnknown: initialData.old_building_grade === '未知',
        buildingLocked: buildingMatch && !initialData.is_manual_building,
        manualBuilding: Boolean(initialData.is_manual_building) || !buildingMatch,
        oldBuildingLocked: oldMatch && !initialData.is_manual_old_building,
        manualOldBuilding: Boolean(initialData.is_manual_old_building) || Boolean(initialData.old_address && !oldMatch && initialData.old_address !== '未知'),
      }));
      return;
    }

    if (mode === 'create' && !createInitializedRef.current) {
      createInitializedRef.current = true;
      savedDraftSignatureRef.current = null;
      setShowLeaveConfirmation(false);
      setSubmittedRecord(null);
      setSubmitErrorMessage(null);
      setSubmitState('idle');
      setSubmitMessage('正在读取云端草稿…');
      setForceSubmit(false);
      forceSubmitRef.current = false;
      setShowDuplicate(false);
      setPendingEdit(null);
      setDraftSavedAt(null);
      setDraftHydrated(false);
      setDraftUiBaseline('');
      reset(DEFAULTS);
      setFaceRentUnit('monthly');
      setEffectiveRentUnit('monthly');
      setFloorInfoUnknown(false);
      setFloorUnknown(false);
      setOldAddressUnknown(false);
      setOldSubmarketUnknown(false);
      setOldDistrictUnknown(false);
      setOldGradeUnknown(false);
      setManualBuilding(false);
      setManualOldBuilding(false);
      setBuildingLocked(false);
      setOldBuildingLocked(false);
      setIsOnBehalf(false);
      setBehalfUserId('');
      setIsCustomSubIndustry(false);
      setCustomSubIndustryText('');
    }
  }, [isOpen, mode, initialData, reset, buildings, industryMap, userId]);

  React.useEffect(() => {
    if (!isOpen || mode !== 'create' || !userId || draftHydrated) return;
    const token = ++draftLoadTokenRef.current;

    void (async () => {
      try {
        const record = await getLeaseTransactionDraft(userId);
        if (token !== draftLoadTokenRef.current) return;

        if (record) {
          reset({ ...DEFAULTS, ...(record.draft.values as Partial<LeaseTransactionFormData>) });
          const ui = record.draft.ui;
          setIsCustomSubIndustry(ui.isCustomSubIndustry);
          setCustomSubIndustryText(ui.customSubIndustryText || '');
          setIsOnBehalf(ui.isOnBehalf);
          setBehalfUserId(ui.behalfUserId || '');
          setManualBuilding(ui.manualBuilding);
          setManualOldBuilding(ui.manualOldBuilding);
          setBuildingLocked(ui.buildingLocked);
          setOldBuildingLocked(ui.oldBuildingLocked);
          setFaceRentUnit(ui.faceRentUnit);
          setEffectiveRentUnit(ui.effectiveRentUnit);
          setFloorInfoUnknown(ui.floorInfoUnknown);
          setFloorUnknown(ui.floorUnknown);
          setOldAddressUnknown(ui.oldAddressUnknown);
          setOldSubmarketUnknown(ui.oldSubmarketUnknown);
          setOldDistrictUnknown(ui.oldDistrictUnknown);
          setOldGradeUnknown(ui.oldGradeUnknown);
          setDraftSavedAt(record.updatedAt);
          setDraftUiBaseline(JSON.stringify(ui));
          setSubmitState('saved');
          setSubmitMessage('已恢复上次云端草稿');
        } else {
          setSubmitState('idle');
          setSubmitMessage('带 * 的字段为必填项');
          setDraftUiBaseline(currentDraftUiSignature);
        }
      } catch (error) {
        console.error('Lease draft restore failed', error);
        setSubmitState('error');
        setSubmitMessage('草稿读取失败，可继续填写并稍后重试保存');
      } finally {
        if (token === draftLoadTokenRef.current) setDraftHydrated(true);
      }
    })();

    return () => { draftLoadTokenRef.current += 1; };
  }, [isOpen, mode, userId, draftHydrated, reset, currentDraftUiSignature]);

  React.useEffect(() => {
    if (!isOpen || mode !== 'create' || !draftHydrated) return;
    const subscription = watch((_values, info) => {
      if (!info.name) return;
      setSubmitState((state) => state === 'saving' || state === 'submitting' || state === 'submitted' ? state : 'unsaved');
      setSubmitMessage('有未保存的草稿修改');
    });
    return () => subscription.unsubscribe();
  }, [isOpen, mode, draftHydrated, watch]);

  React.useEffect(() => {
    if (!isOpen || mode !== 'create' || !draftHydrated || !draftUiBaseline) return;
    if (currentDraftUiSignature === draftUiBaseline) return;
    setSubmitState((state) => state === 'saving' || state === 'submitting' || state === 'submitted' ? state : 'unsaved');
    setSubmitMessage('有未保存的草稿修改');
  }, [isOpen, mode, draftHydrated, draftUiBaseline, currentDraftUiSignature]);

  React.useEffect(() => {
    if (!selectedYear || availableQuarters.length === 0) return;
    const currentQuarter = getValues('transaction_quarter');
    if (!currentQuarter || !availableQuarters.includes(currentQuarter)) {
      setValue('transaction_quarter', availableQuarters[availableQuarters.length - 1], { shouldDirty: true });
    }
  }, [selectedYear, availableQuarters, getValues, setValue]);

  React.useEffect(() => {
    if (dirtyCount > 0 && submitState === 'idle') setSubmitMessage(`已修改 ${dirtyCount} 个字段`);
  }, [dirtyCount, submitState]);

  const saveDraft = React.useCallback(async () => {
    if (mode !== 'create' || !draftHydrated || !userId || operationRef.current) return false;
    const snapshot: LeaseTransactionDraftSnapshot = {
      version: 1,
      values: getValues() as unknown as Record<string, unknown>,
      ui: currentDraftUi,
    };

    operationRef.current = 'saving';
    setSubmitErrorMessage(null);
    setSubmitState('saving');
    setSubmitMessage('正在保存云端草稿');
    try {
      const savedAt = await saveLeaseTransactionDraft(userId, userName, snapshot);
      setDraftSavedAt(savedAt);
      setDraftUiBaseline(JSON.stringify(snapshot.ui));
      savedDraftSignatureRef.current = JSON.stringify(snapshot);
      const savedCurrentInput = JSON.stringify({ version: 1, values: getValues(), ui: currentDraftUiRef.current }) === savedDraftSignatureRef.current;
      setSubmitState(savedCurrentInput ? 'saved' : 'unsaved');
      setSubmitMessage(savedCurrentInput ? '草稿已保存到云端' : '草稿已保存，仍有新的未保存修改');
      return savedCurrentInput;
    } catch (error) {
      console.error('Lease draft save failed', error);
      const message = error instanceof Error ? error.message : '草稿保存失败';
      setSubmitState('error');
      setSubmitMessage(message);
      setSubmitErrorMessage('草稿保存失败，请检查网络后重试。当前表单内容仍保留在本页。');
      return false;
    } finally {
      operationRef.current = null;
    }
  }, [mode, draftHydrated, userId, userName, getValues, currentDraftUi]);

  const selectBuilding = (buildingName: string, old = false) => {
    const building = (buildings ?? []).find((item) => item.name === buildingName);
    if (!building) return;
    if (old) {
      setValue('old_address', buildingName, { shouldDirty: true });
      setValue('old_sub_market', building.submarket || '', { shouldDirty: true });
      setValue('old_district', building.district || '', { shouldDirty: true });
      setValue('old_building_grade', dbGradeToFormGrade(building.grade), { shouldDirty: true });
      setValue('is_manual_old_building', false);
      setManualOldBuilding(false);
      setOldBuildingLocked(true);
      clearErrors(['old_address', 'old_sub_market', 'old_district', 'old_building_grade']);
    } else {
      setValue('new_building', buildingName, { shouldDirty: true });
      setValue('sub_market', building.submarket || '', { shouldDirty: true });
      setValue('district', building.district || '', { shouldDirty: true });
      setValue('building_grade', dbGradeToFormGrade(building.grade), { shouldDirty: true });
      setValue('is_manual_building', false);
      setManualBuilding(false);
      setBuildingLocked(true);
      clearErrors(['new_building', 'sub_market', 'district', 'building_grade']);
    }
  };

  const clearBuilding = (old = false) => {
    if (old) {
      setValue('old_address', '', { shouldDirty: true });
      setValue('old_sub_market', '', { shouldDirty: true });
      setValue('old_district', '', { shouldDirty: true });
      setValue('old_building_grade', '', { shouldDirty: true });
      setValue('is_manual_old_building', false);
      setManualOldBuilding(false);
      setOldBuildingLocked(false);
    } else {
      setValue('new_building', '', { shouldDirty: true });
      setValue('sub_market', '', { shouldDirty: true });
      setValue('district', '', { shouldDirty: true });
      setValue('building_grade', '', { shouldDirty: true });
      setValue('is_manual_building', false);
      setManualBuilding(false);
      setBuildingLocked(false);
    }
  };

  const enableManual = (old = false) => {
    clearBuilding(old);
    if (old) {
      setManualOldBuilding(true);
      setValue('is_manual_old_building', true, { shouldDirty: true });
    } else {
      setManualBuilding(true);
      setValue('is_manual_building', true, { shouldDirty: true });
    }
  };

  const validateRentRelationship = (data: LeaseTransactionFormData) => {
    const face = monthlyRent(data.face_rent, faceRentUnit);
    const effective = monthlyRent(data.effective_rent, effectiveRentUnit);
    let valid = true;
    if (face > 1000) {
      setError('face_rent', { type: 'validate', message: '表面租金不得超过 1000 元/㎡/月，请核对金额或单位。' });
      valid = false;
    }
    if (effective > 1000) {
      setError('effective_rent', { type: 'validate', message: '有效租金不得超过 1000 元/㎡/月，请核对金额或单位。' });
      valid = false;
    }
    if (effective > face) {
      setError('effective_rent', { type: 'validate', message: '有效租金不能高于表面租金，请核对。' });
      valid = false;
    }
    return valid;
  };

  const findDuplicates = async (data: LeaseTransactionFormData) => {
    try {
      setSubmitState('saving');
      setSubmitMessage('正在检查疑似重复记录');
      const result: DuplicateCheckResult = await checkFuzzyDuplicate(
        data.company.trim(),
        data.new_building.trim(),
        data.area_sqm,
        data.transaction_quarter,
        mode === 'edit' ? initialData?.id : undefined,
        data.transaction_year,
      );
      if (result.hasDuplicate && result.duplicates.length > 0) {
        setDuplicates(result.duplicates);
        setShowDuplicate(true);
        setSubmitState(mode === 'create' ? 'unsaved' : 'idle');
        setSubmitMessage(`发现 ${result.duplicates.length} 条疑似重复记录，请确认`);
        return true;
      }
      return false;
    } catch (error) {
      // Preserve existing business behavior: duplicate-check failure never blocks submission.
      console.error('Duplicate check failed; continuing submission', error);
      return false;
    }
  };

  const persistRecentBuilding = (buildingName: string) => {
    if (!buildingName) return;
    const next = [buildingName, ...recentBuildings.filter((value) => value !== buildingName)].slice(0, 5);
    setRecentBuildings(next);
    try { window.localStorage.setItem('lease-recent-buildings', JSON.stringify(next)); } catch { /* non-critical */ }
  };

  const buildPayload = (data: LeaseTransactionFormData): LeaseTransaction => {
    const isRelocation = data.demand_type === '搬迁';
    return {
      company: data.company?.trim() || '',
      suspected_company_fullname: data.suspected_company_fullname?.trim() || null,
      enterprise_type: data.enterprise_type || null,
      industry: data.industry?.trim() || null,
      sub_industry: isCustomSubIndustry && customSubIndustryText.trim() ? customSubIndustryText.trim() : (data.sub_industry?.trim() || null),
      demand_type: data.demand_type || null,
      relocation_area_change: isRelocation ? data.relocation_area_change || null : null,
      new_building: data.new_building?.trim() || '',
      floor_info: data.floor_info?.trim() || null,
      floor: data.floor?.trim() || null,
      sub_market: data.sub_market?.trim() || null,
      district: data.district?.trim() || null,
      building_grade: data.building_grade || null,
      old_address: isRelocation ? data.old_address?.trim() || null : null,
      old_sub_market: isRelocation ? data.old_sub_market?.trim() || null : null,
      old_district: isRelocation ? data.old_district?.trim() || null : null,
      old_building_grade: isRelocation ? data.old_building_grade || null : null,
      area_sqm: data.area_sqm ?? null,
      face_rent: monthlyRent(data.face_rent, faceRentUnit),
      is_face_rent_estimated: data.is_face_rent_estimated === true,
      lease_term_months: data.lease_term_months ?? null,
      fit_out_months: data.fit_out_months ?? null,
      rent_free_months: data.rent_free_months ?? null,
      effective_rent: monthlyRent(data.effective_rent, effectiveRentUnit),
      is_effective_rent_estimated: data.is_effective_rent_estimated === true,
      transaction_date: null,
      transaction_year: data.transaction_year,
      transaction_quarter: data.transaction_quarter,
      remarks: data.remarks?.trim() || null,
      is_manual_building: data.is_manual_building,
      is_manual_old_building: data.is_manual_old_building,
      submitter_id: isOnBehalf && behalfUserId ? behalfUserId : userId,
      submitter_name: isOnBehalf && behalfUserId ? brokers.find((broker) => broker.user_id === behalfUserId)?.name || userName : userName,
    };
  };

  const persistTransaction = async (data: LeaseTransactionFormData, payload: LeaseTransaction) => {
    if (operationRef.current) return;
    operationRef.current = 'submitting';
    setSubmitErrorMessage(null);
    setSubmitState('submitting');
    setSubmitMessage(mode === 'edit' ? '正在更新成交记录' : '正在写入成交记录');

    try {
      const result = mode === 'edit' && initialData?.id
        ? await updateTransaction(initialData.id, payload, userId, initialData.updated_at)
        : await submitTransaction(payload);
      if (!result.success || !result.data) {
        setSubmitState('error');
        setSubmitMessage(result.error || '数据库写入失败');
        setSubmitErrorMessage(result.error || '提交失败，请重试。');
        return;
      }

      if (mode === 'create') {
        try {
          await deleteLeaseTransactionDraft(userId);
          setDraftSavedAt(null);
          setDraftUiBaseline('');
        } catch (draftError) {
          // The transaction is already committed. Never invite a retry that could duplicate it.
          console.error('Lease transaction saved but draft cleanup failed', draftError);
        }
      }

      logAction(userId, 'SUBMIT_LEASE_TRANSACTION', {
        mode,
        recordId: result.data.id,
        company: data.company,
        building: data.new_building,
        area: data.area_sqm,
        district: data.district,
        year: data.transaction_year,
        quarter: data.transaction_quarter,
        target_table: 'lease_transactions',
        target_id: result.data.id,
        target_name: `${data.company} · ${data.new_building}`,
      });
      persistRecentBuilding(data.new_building);
      setSubmittedRecord(result.data);
      setSubmitState('submitted');
      setSubmitMessage('成交记录已写入');
      setPendingEdit(null);
      setForceSubmit(false);
      forceSubmitRef.current = false;
      onSubmitSuccess();
    } catch (error) {
      console.error('Lease transaction submission failed', error);
      setSubmitState('error');
      setSubmitMessage('提交失败，当前表单内容已保留');
      setSubmitErrorMessage('提交失败，请重试。当前表单内容仍保留。');
    } finally {
      operationRef.current = null;
    }
  };

  const submitValidated = async (data: LeaseTransactionFormData) => {
    if (!validateRentRelationship(data)) return;
    if (mode === 'create' && isOnBehalf && !behalfUserId) {
      setSubmitErrorMessage('选择“代他人填报”后，必须选择被代报人。');
      return;
    }
    if (!forceSubmitRef.current && await findDuplicates(data)) return;

    const payload = buildPayload(data);

    if (mode === 'edit' && initialData) {
      const changes = buildLeaseTransactionChanges(initialData, payload);
      if (changes.length === 0) {
        setSubmitErrorMessage(null);
        setSubmitState('idle');
        setSubmitMessage('未检测到实际变更，无需更新');
        setForceSubmit(false);
        forceSubmitRef.current = false;
        return;
      }

      setPendingEdit({ data, payload, changes });
      setSubmitState('idle');
      setSubmitMessage(`待确认 ${changes.length} 项修改`);
      return;
    }

    await persistTransaction(data, payload);
  };

  const invalidSubmit = (formErrors: typeof errors) => {
    const first = Object.entries(formErrors)[0];
    const fieldName = first?.[0];
    if (fieldName) window.requestAnimationFrame(() => document.getElementById(fieldName)?.focus());
    setSubmitState('error');
    setSubmitMessage(`有 ${Object.keys(formErrors).length} 个字段需要检查`);
    setSubmitErrorMessage('存在未通过校验的字段。错误已显示在对应字段附近。');
  };

  const continueAdding = () => {
    savedDraftSignatureRef.current = null;
    setDraftUiBaseline('');
    reset(DEFAULTS);
    setSubmittedRecord(null);
    setSubmitState('idle');
    setSubmitMessage('可以继续录入下一笔成交');
    setSubmitErrorMessage(null);
    setDraftSavedAt(null);
    setForceSubmit(false);
    forceSubmitRef.current = false;
    setIsCustomSubIndustry(false);
    setCustomSubIndustryText('');
    setBuildingLocked(false);
    setOldBuildingLocked(false);
    setManualBuilding(false);
    setManualOldBuilding(false);
    setIsOnBehalf(false);
    setBehalfUserId('');
    window.requestAnimationFrame(() => document.getElementById('company')?.focus());
  };

  if (!isOpen) return null;

  if (submittedRecord) {
    return (
      <>
        <div className="fixed inset-0 z-[45] bg-slate-950/35" aria-hidden="true" />
        <aside className="fixed inset-y-0 right-0 z-[var(--cd-z-drawer)] flex w-full max-w-xl flex-col border-l border-[#d9e0e8] bg-[#eef2f6] shadow-2xl" aria-label="租赁成交填报结果">
          <div className="flex items-center justify-between border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-900">提交成功</h2>
            <button type="button" onClick={onClose} className="rounded-[var(--cd-radius-md)] p-2 text-[var(--cd-color-text-muted)] transition hover:bg-[var(--cd-color-surface-alt)]" aria-label="返回记录列表"><X size={17} /></button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-emerald-200 bg-white p-5 shadow-[0_2px_8px_rgba(23,32,51,0.05)]">
              <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 size={20} /><strong className="text-sm">{mode === 'edit' ? '成交记录已更新' : '成交记录已写入'}</strong></div>
              <dl className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 text-xs">
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">企业</dt><dd className="font-medium text-slate-800">{submittedRecord.company}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">楼宇</dt><dd className="font-medium text-slate-800">{submittedRecord.new_building}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">面积</dt><dd className="tabular-nums text-slate-800">{submittedRecord.area_sqm?.toLocaleString('zh-CN') ?? '-'} ㎡</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">成交年份</dt><dd className="tabular-nums text-slate-800">{submittedRecord.transaction_year || '-'}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">成交季度</dt><dd className="text-slate-800">{submittedRecord.transaction_quarter || '-'}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-slate-400">记录编号</dt><dd className="truncate font-mono text-[10px] text-slate-500" title={submittedRecord.id}>{submittedRecord.id || '系统生成'}</dd></div>
              </dl>
              <p className="mt-3 text-[var(--cd-font-size-sm)] leading-5 text-[var(--cd-color-text-secondary)]">该记录已完成数据库写入。返回记录列表后，提交历史会刷新；新增模式可直接继续录入下一条。</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                {mode === 'create' && <Button variant="secondary" size="sm" onClick={continueAdding}>继续新增 <ChevronRight size={13} /></Button>}
                <Button size="sm" onClick={onClose}>返回记录列表</Button>
              </div>
            </div>
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[45] bg-slate-950/35" onClick={requestClose} aria-hidden="true" />
      <aside className="fixed inset-y-0 right-0 z-[var(--cd-z-drawer)] flex w-full max-w-3xl flex-col border-l border-[#d9e0e8] bg-[#eef2f6] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="lease-entry-title" aria-busy={busy} inert={showLeaveConfirmation || showDuplicate || Boolean(pendingEdit)}>
        <div className="shrink-0 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="lease-entry-title" className="truncate text-sm font-semibold text-slate-900">{mode === 'edit' ? '编辑成交记录' : '新增成交记录'}</h2>
            <div className="flex items-center gap-2"><SaveStatus state={submitState} message={submitMessage} savedAt={draftSavedAt} className="hidden" /><button type="button" onClick={requestClose} disabled={busy} className="rounded-[var(--cd-radius-md)] p-2 text-[var(--cd-color-text-muted)] transition hover:bg-[var(--cd-color-surface-alt)] disabled:opacity-50" aria-label="关闭填报"><X size={17} /></button></div>
          </div>
        </div>

        <form onSubmit={handleSubmit(submitValidated, invalidSubmit)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" autoComplete="off">
          {submitError && <div className="sticky top-0 z-20 border-b border-slate-200 bg-white p-2.5"><ValidationMessage severity="error">{submitError}</ValidationMessage></div>}

          {mode === 'create' && (
            <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={isOnBehalf} onChange={(event) => { setIsOnBehalf(event.target.checked); if (!event.target.checked) setBehalfUserId(''); }} className="h-3.5 w-3.5 rounded border-slate-300 text-[#003e7e]" />代他人填报 <span className="font-normal text-slate-400">记录将归属被代报人</span></label>
              {isOnBehalf && <div className="mt-2 max-w-xs"><SearchableSelect value={behalfUserId} onChange={setBehalfUserId} options={brokers.map((broker) => ({ value: broker.user_id, label: broker.name }))} placeholder="选择被代报人 *" /></div>}
            </div>
          )}

          <Section index="01" title="企业信息与需求类型">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2"><FormField name="company" label="企业名称" type="text" placeholder="请输入企业名称" register={register} error={errors.company} required /></div>
              <FormField name="suspected_company_fullname" label="疑似企业全称" type="text" placeholder="可选" register={register} error={errors.suspected_company_fullname} />
              <FormField name="enterprise_type" label="企业类型" type="select" options={['央国企','外企','民企','其他']} register={register} control={control} error={errors.enterprise_type} required />
              <FormField name="industry" label="所属行业" type="select" options={industryOptions} register={register} control={control} error={errors.industry} required />
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">所属子行业 *</label><SearchableSelect value={isCustomSubIndustry ? '其他' : (watch('sub_industry') || '')} onChange={(value) => { setValue('sub_industry', value, { shouldDirty: true, shouldValidate: true }); setIsCustomSubIndustry(value === '其他'); if (value !== '其他') setCustomSubIndustryText(''); }} options={subIndustryOptions} placeholder={selectedIndustry ? '请选择' : '先选择行业'} disabled={!selectedIndustry} />{isCustomSubIndustry && <input type="text" value={customSubIndustryText} onChange={(event) => setCustomSubIndustryText(event.target.value)} placeholder="填写具体子行业（可留空）" className="mt-1.5 min-h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs outline-none focus:border-[#003e7e]" />}{errors.sub_industry && <p className="mt-1 text-[10px] text-rose-600">{errors.sub_industry.message}</p>}</div>
              <FormField name="demand_type" label="需求类型" type="select" options={['新租','搬迁','扩租','续租','未知']} register={register} control={control} error={errors.demand_type} required />
              {demandType === '搬迁' && <FormField name="relocation_area_change" label="搬迁面积变化" type="select" options={['缩减面积','扩大面积','面积不变','未知']} register={register} control={control} error={errors.relocation_area_change} required />}
            </div>
            {demandType === '新租' && <div className="mt-3"><ValidationMessage severity="info">现有业务定义：新租指企业此前办公项目未出现在高力监控的甲乙级写字楼和产业园项目中。</ValidationMessage></div>}
          </Section>

          <Section index="02" title="交易楼宇信息">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1"><label className="mb-1 block text-[11px] font-medium text-zinc-600">交易楼宇 *</label>{buildingsLoading ? <div className="min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-400">正在加载楼宇列表…</div> : manualBuilding ? <input {...register('new_building')} id="new_building" className="min-h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs outline-none focus:border-[#003e7e]" placeholder="手动输入楼宇名称" /> : <SearchableSelect value={selectedBuilding || ''} onChange={(value) => selectBuilding(value)} options={allBuildingNames} locked={buildingLocked} onClear={() => clearBuilding()} placeholder="搜索楼宇名称…" />}{!manualBuilding ? <button type="button" onClick={() => enableManual()} className="mt-1 text-[10px] font-medium text-[#003e7e]">未匹配到？手动录入</button> : <button type="button" onClick={() => clearBuilding()} className="mt-1 text-[10px] font-medium text-[#003e7e]">返回实体选择</button>}{errors.new_building && <p className="mt-1 text-[10px] text-rose-600">{errors.new_building.message}</p>}</div>
              {recentBuildings.length > 0 && !manualBuilding && !buildingLocked && <div className="sm:col-span-2 lg:col-span-2"><span className="mb-1 block text-[10px] font-medium text-zinc-400">最近使用</span><div className="flex flex-wrap gap-1">{recentBuildings.map((name) => <button key={name} type="button" onClick={() => selectBuilding(name)} className="max-w-52 truncate rounded-[4px] border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-600 hover:border-[#003e7e]/30 hover:text-[#003e7e]">{name}</button>)}</div></div>}
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">子市场 *</label>{buildingLocked ? <input {...register('sub_market')} id="sub_market" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600" /> : <SearchableSelect value={watch('sub_market') || ''} onChange={(value) => setValue('sub_market', value, { shouldDirty: true, shouldValidate: true })} options={submarkets} placeholder="请选择" />}{errors.sub_market && <p className="mt-1 text-[10px] text-rose-600">{errors.sub_market.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">区域 *</label><input {...register('district')} id="district" readOnly={buildingLocked} className={`min-h-9 w-full rounded-md border px-2.5 text-xs outline-none focus:border-[#003e7e] ${buildingLocked ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-zinc-300 bg-white'}`} placeholder="如：朝阳区" />{errors.district && <p className="mt-1 text-[10px] text-rose-600">{errors.district.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼宇等级 *</label>{buildingLocked ? <input {...register('building_grade')} id="building_grade" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600" /> : <SearchableSelect value={watch('building_grade') || ''} onChange={(value) => setValue('building_grade', value as LeaseTransactionFormData['building_grade'], { shouldDirty: true, shouldValidate: true })} options={['甲级','乙级','产业园','其他']} placeholder="请选择" />}{errors.building_grade && <p className="mt-1 text-[10px] text-rose-600">{errors.building_grade.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼座 *</label><div className="flex gap-1.5"><input {...register('floor_info')} id="floor_info" disabled={floorInfoUnknown} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder={floorInfoUnknown ? '未知' : '如：A座'} /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={floorInfoUnknown} onChange={(event) => { setFloorInfoUnknown(event.target.checked); setValue('floor_info', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.floor_info && <p className="mt-1 text-[10px] text-rose-600">{errors.floor_info.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼层 *</label><div className="flex gap-1.5"><input {...register('floor')} id="floor" disabled={floorUnknown} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder={floorUnknown ? '未知' : '如：15'} /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={floorUnknown} onChange={(event) => { setFloorUnknown(event.target.checked); setValue('floor', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.floor && <p className="mt-1 text-[10px] text-rose-600">{errors.floor.message}</p>}</div>
            </div>
          </Section>

          {demandType === '搬迁' && <Section index="03" title="原址信息"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址楼宇 *</label>{oldAddressUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : manualOldBuilding ? <input {...register('old_address')} id="old_address" className="min-h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs" placeholder="手动输入原址楼宇" /> : <SearchableSelect value={selectedOldBuilding || ''} onChange={(value) => selectBuilding(value, true)} options={allBuildingNames} locked={oldBuildingLocked} onClear={() => clearBuilding(true)} placeholder="搜索原址楼宇…" />}<div className="mt-1 flex items-center justify-between gap-2"><button type="button" disabled={oldAddressUnknown} onClick={() => manualOldBuilding ? clearBuilding(true) : enableManual(true)} className="text-[10px] font-medium text-[#003e7e] disabled:text-zinc-300">{manualOldBuilding ? '返回实体选择' : '手动录入'}</button><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldAddressUnknown} onChange={(event) => { const checked = event.target.checked; setOldAddressUnknown(checked); setValue('old_address', checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); if (checked && !getValues('old_district')) { setOldDistrictUnknown(true); setValue('old_district', '未知', { shouldDirty: true }); } }} />未知</label></div>{errors.old_address && <p className="mt-1 text-[10px] text-rose-600">{errors.old_address.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址子市场 *</label>{oldSubmarketUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : oldBuildingLocked ? <input {...register('old_sub_market')} id="old_sub_market" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : <SearchableSelect value={watch('old_sub_market') || ''} onChange={(value) => setValue('old_sub_market', value, { shouldDirty: true, shouldValidate: true })} options={submarkets} placeholder="请选择" />}<label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldSubmarketUnknown} onChange={(event) => { setOldSubmarketUnknown(event.target.checked); setValue('old_sub_market', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label>{errors.old_sub_market && <p className="mt-1 text-[10px] text-rose-600">{errors.old_sub_market.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址区域 *</label><div className="flex gap-1.5"><input {...register('old_district')} id="old_district" disabled={oldDistrictUnknown} readOnly={oldBuildingLocked} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder="如：朝阳区" /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldDistrictUnknown} onChange={(event) => { setOldDistrictUnknown(event.target.checked); setValue('old_district', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.old_district && <p className="mt-1 text-[10px] text-rose-600">{errors.old_district.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址等级 *</label>{oldGradeUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : oldBuildingLocked ? <input {...register('old_building_grade')} id="old_building_grade" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : <SearchableSelect value={watch('old_building_grade') || ''} onChange={(value) => setValue('old_building_grade', value as LeaseTransactionFormData['old_building_grade'], { shouldDirty: true, shouldValidate: true })} options={['甲级','乙级','产业园','其他']} placeholder="请选择" />}<label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldGradeUnknown} onChange={(event) => { setOldGradeUnknown(event.target.checked); setValue('old_building_grade', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label>{errors.old_building_grade && <p className="mt-1 text-[10px] text-rose-600">{errors.old_building_grade.message}</p>}</div>
          </div></Section>}

          <Section index={demandType === '搬迁' ? '04' : '03'} title="成交核心数据">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField name="area_sqm" label="租赁面积 (㎡)" type="number" placeholder="如：500" register={register} error={errors.area_sqm} required />
              <div><div className="flex items-end gap-1.5"><div className="min-w-0 flex-1"><FormField name="face_rent" label={`表面租金 (元/㎡/${faceRentUnit === 'daily' ? '天' : '月'})`} type="number" placeholder={faceRentUnit === 'daily' ? '如：5' : '如：150'} register={register} error={errors.face_rent} required /></div><button type="button" onClick={() => setFaceRentUnit((unit) => unit === 'daily' ? 'monthly' : 'daily')} className="mb-[1px] min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[10px] font-semibold text-zinc-600">{faceRentUnit === 'daily' ? '日' : '月'} ⇄</button></div><label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" {...register('is_face_rent_estimated')} />预估值</label></div>
              <div><div className="flex items-end gap-1.5"><div className="min-w-0 flex-1"><FormField name="effective_rent" label={`有效租金 (元/㎡/${effectiveRentUnit === 'daily' ? '天' : '月'})`} type="number" placeholder={effectiveRentUnit === 'daily' ? '如：4.5' : '如：135'} register={register} error={errors.effective_rent} required /></div><button type="button" onClick={() => setEffectiveRentUnit((unit) => unit === 'daily' ? 'monthly' : 'daily')} className="mb-[1px] min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[10px] font-semibold text-zinc-600">{effectiveRentUnit === 'daily' ? '日' : '月'} ⇄</button></div><label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" {...register('is_effective_rent_estimated')} />预估值</label></div>
              <FormField name="lease_term_months" label="租期 (月)" type="number" placeholder="如：36" register={register} error={errors.lease_term_months} />
              <FormField name="fit_out_months" label="装修期 (月)" type="number" placeholder="如：2" register={register} error={errors.fit_out_months} />
              <FormField name="rent_free_months" label="免租期 (月)" type="number" placeholder="如：1" register={register} error={errors.rent_free_months} />
            </div>
          </Section>

          <Section index={demandType === '搬迁' ? '05' : '04'} title="时间与备注">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">成交年份 *</label><SearchableSelect value={String(selectedYear || '')} onChange={(value) => setValue('transaction_year', Number(value), { shouldDirty: true, shouldValidate: true })} options={availableYears.map((year) => ({ value: String(year), label: String(year) }))} placeholder="年份" />{errors.transaction_year && <p className="mt-1 text-[10px] text-rose-600">{errors.transaction_year.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">成交季度 *</label><SearchableSelect value={watch('transaction_quarter') || ''} onChange={(value) => setValue('transaction_quarter', value, { shouldDirty: true, shouldValidate: true })} options={availableQuarters} placeholder="季度" disabled={!selectedYear} />{errors.transaction_quarter && <p className="mt-1 text-[10px] text-rose-600">{errors.transaction_quarter.message}</p>}</div>
              <div className="sm:col-span-2 lg:col-span-2"><FormField name="remarks" label="备注" type="textarea" placeholder="代理行、业主租赁策略变化、企业客户重要情况等" register={register} error={errors.remarks} /></div>
            </div>
          </Section>

          <DataEntryToolbar className="sticky bottom-0 z-30" leading={errorCount ? <div className="text-[10px] font-semibold text-rose-700">{errorCount} 个字段需要检查</div> : undefined}>
            <Button type="button" variant="secondary" size="sm" onClick={requestClose} disabled={busy}>取消</Button>
            {mode === 'create' && <Button type="button" variant="secondary" size="sm" onClick={() => { void saveDraft(); }} disabled={!draftHydrated || isSubmitting || submitState === 'saving' || submitState === 'submitting'}>{submitState === 'saving' && <Loader2 size={13} className="animate-spin" />}保存草稿</Button>}
            <Button type="submit" size="sm" disabled={isSubmitting || submitState === 'saving' || submitState === 'submitting' || !draftHydrated}>{(isSubmitting || submitState === 'submitting') && <Loader2 size={13} className="animate-spin" />}{submitState === 'submitting' ? '提交中…' : mode === 'edit' ? '更新记录' : '提交记录'}</Button>
          </DataEntryToolbar>
        </form>
      </aside>

      <Dialog
        open={showLeaveConfirmation}
        onOpenChange={(open) => { if (!busy && !operationRef.current) setShowLeaveConfirmation(open); }}
        title="未保存的修改"
        dismissible={!busy}
        footer={<>
          <Button className="min-h-11" variant="secondary" disabled={busy} onClick={() => setShowLeaveConfirmation(false)}>继续编辑</Button>
          <Button className="min-h-11" variant="danger" disabled={busy} onClick={() => { if (operationRef.current) return; setShowLeaveConfirmation(false); onClose(); }}>放弃修改并关闭</Button>
          {mode === 'create' && <Button className="min-h-11" disabled={busy || !draftHydrated} onClick={async () => { if (await saveDraft()) { setShowLeaveConfirmation(false); onClose(); } }}>保存草稿并关闭</Button>}
        </>}
      >
        <p className="text-sm text-[var(--cd-color-text-secondary)]">{mode === 'create' ? '关闭会丢失尚未保存的修改，已保存的云端草稿仍会保留。' : '关闭会丢失本次修改，正式成交记录保持原样。'}</p>
        {submitError && <ValidationMessage severity="error">{submitError}</ValidationMessage>}
      </Dialog>
      {showDuplicate && <DuplicateDialog duplicates={duplicates} onCancel={() => { setShowDuplicate(false); setForceSubmit(false); forceSubmitRef.current = false; setSubmitState(mode === 'create' ? 'unsaved' : 'idle'); }} onConfirm={() => { setShowDuplicate(false); setForceSubmit(true); forceSubmitRef.current = true; void handleSubmit(submitValidated, (formErrors) => { setForceSubmit(false); forceSubmitRef.current = false; invalidSubmit(formErrors); })(); }} />}

      {pendingEdit && (
        <EditConfirmationDialog
          recordLabel={`${initialData?.company || '成交记录'} · ${initialData?.new_building || '未标记楼宇'}`}
          changes={pendingEdit.changes}
          onCancel={() => {
            setPendingEdit(null);
            setForceSubmit(false);
            forceSubmitRef.current = false;
            setSubmitState('idle');
            setSubmitMessage('已返回编辑，可继续调整');
          }}
          onConfirm={() => {
            const pending = pendingEdit;
            setPendingEdit(null);
            setForceSubmit(false);
            forceSubmitRef.current = false;
            void persistTransaction(pending.data, pending.payload);
          }}
        />
      )}
    </>
  );
}
