'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react';

import { leaseTransactionSchema, type LeaseTransactionFormData } from '../schemas/leaseTransactionSchema';
import { dbGradeToFormGrade, getAvailableLeasePeriods, mapLeaseRecordToFormDefaults } from '../leaseEntryModel';
import { FormField } from './FormField';
import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import { SaveStatus, type SaveState } from '@/src/components/data-entry/SaveStatus';
import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';
import { DataEntryToolbar } from '@/src/components/data-entry/DataEntryToolbar';
import { checkFuzzyDuplicate, getAllBrokers, submitTransaction, updateTransaction } from '@/src/services/leaseTransactionSubmitService';
import { useBuildings } from '@/src/hooks/useBuildings';
import { logAction } from '@/src/utils/audit';
import { supabase } from '@/src/services/supabaseClient';
import type { DuplicateCheckResult, LeaseTransaction } from '@/src/types/lease-transaction';

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
  description?: string;
  children: React.ReactNode;
}

function Section({ index, title, description, children }: SectionProps) {
  return (
    <section className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[10px] font-bold tabular-nums text-[#003e7e]">{index}</span>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-800">{title}</h3>
        {description && <span className="ml-auto hidden text-[10px] text-zinc-400 sm:inline">{description}</span>}
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
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/45 p-3" onClick={onCancel}>
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="duplicate-title" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-zinc-200 px-4 py-3">
          <h3 id="duplicate-title" className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><AlertTriangle size={16} className="text-amber-600" /> Potential duplicate</h3>
          <p className="mt-1 text-[11px] text-zinc-500">沿用现有规则：不同 Broker 可以提交相似记录，只要确认并非同一笔交易即可继续。</p>
        </div>
        <div className="max-h-[45vh] overflow-auto">
          <table className="w-full min-w-[620px] text-[11px]">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-500"><tr>{['提交人','企业','楼宇','面积','季度','提交时间'].map((label) => <th key={label} className="border-b border-zinc-200 px-3 py-2 text-left font-semibold">{label}</th>)}</tr></thead>
            <tbody>{duplicates.map((item, index) => <tr key={item.id ?? index} className="border-b border-zinc-100"><td className="px-3 py-2 font-medium text-[#003e7e]">{item.submitter_name || '-'}</td><td className="px-3 py-2">{item.company || '-'}</td><td className="px-3 py-2">{item.new_building || '-'}</td><td className="px-3 py-2 tabular-nums">{item.area_sqm?.toLocaleString('zh-CN') || '-'}</td><td className="px-3 py-2">{item.transaction_quarter || '-'}</td><td className="px-3 py-2 text-zinc-400">{item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-'}</td></tr>)}</tbody>
          </table>
        </div>
        <DataEntryToolbar>
          <button type="button" onClick={onCancel} className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600">返回检查</button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white">确认不是同一笔并提交</button>
        </DataEntryToolbar>
      </div>
    </div>
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
  const [forceSubmit, setForceSubmit] = React.useState(false);
  const forceSubmitRef = React.useRef(false);
  const [submitState, setSubmitState] = React.useState<SaveState>('idle');
  const [submitMessage, setSubmitMessage] = React.useState('Required fields are marked with *');
  const [submitError, setSubmitErrorMessage] = React.useState<string | null>(null);
  const [submittedRecord, setSubmittedRecord] = React.useState<LeaseTransaction | null>(null);

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
    if (!isOpen) return;
    setSubmittedRecord(null);
    setSubmitErrorMessage(null);
    setSubmitState('idle');
    setSubmitMessage(mode === 'edit' ? 'Existing record loaded' : 'Required fields are marked with *');
    setForceSubmit(false);
    forceSubmitRef.current = false;
    setShowDuplicate(false);

    if (mode === 'edit' && initialData) {
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
    } else {
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
  }, [isOpen, mode, initialData, reset, buildings, industryMap]);

  React.useEffect(() => {
    if (!selectedYear || availableQuarters.length === 0) return;
    const currentQuarter = getValues('transaction_quarter');
    if (!currentQuarter || !availableQuarters.includes(currentQuarter)) {
      setValue('transaction_quarter', availableQuarters[availableQuarters.length - 1], { shouldDirty: true });
    }
  }, [selectedYear, availableQuarters, getValues, setValue]);

  React.useEffect(() => {
    if (dirtyCount > 0 && submitState === 'idle') setSubmitMessage(`${dirtyCount} field${dirtyCount === 1 ? '' : 's'} changed`);
  }, [dirtyCount, submitState]);

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
      setSubmitMessage('Checking potential duplicates');
      const result: DuplicateCheckResult = await checkFuzzyDuplicate(
        data.company.trim(),
        data.new_building.trim(),
        data.area_sqm,
        data.transaction_quarter,
        mode === 'edit' ? initialData?.id : undefined,
      );
      if (result.hasDuplicate && result.duplicates.length > 0) {
        setDuplicates(result.duplicates);
        setShowDuplicate(true);
        setSubmitState('idle');
        setSubmitMessage(`${result.duplicates.length} potential duplicate${result.duplicates.length === 1 ? '' : 's'} need review`);
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

  const submitValidated = async (data: LeaseTransactionFormData) => {
    if (!validateRentRelationship(data)) return;
    if (mode === 'create' && isOnBehalf && !behalfUserId) {
      setSubmitErrorMessage('选择“代他人填报”后，必须选择被代报人。');
      return;
    }
    if (!forceSubmitRef.current && await findDuplicates(data)) return;

    setSubmitErrorMessage(null);
    setSubmitState('submitting');
    setSubmitMessage(mode === 'edit' ? 'Updating record in database' : 'Writing record to database');
    const payload = buildPayload(data);

    try {
      const result = mode === 'edit' && initialData?.id
        ? await updateTransaction(initialData.id, payload, userId)
        : await submitTransaction(payload);
      if (!result.success || !result.data) {
        setSubmitState('error');
        setSubmitMessage(result.error || 'Database write failed');
        setSubmitErrorMessage(result.error || '提交失败，请重试。');
        return;
      }

      logAction(userId, 'SUBMIT_LEASE_TRANSACTION', {
        mode,
        recordId: result.data.id,
        company: data.company,
        building: data.new_building,
        area: data.area_sqm,
        district: data.district,
        quarter: data.transaction_quarter,
      });
      persistRecentBuilding(data.new_building);
      setSubmittedRecord(result.data);
      setSubmitState('submitted');
      setSubmitMessage('Submission written to database');
      setForceSubmit(false);
      forceSubmitRef.current = false;
      onSubmitSuccess();
    } catch (error) {
      console.error('Lease transaction submission failed', error);
      setSubmitState('error');
      setSubmitMessage('Submission failed; form values are retained');
      setSubmitErrorMessage('提交失败，请重试。当前表单内容仍保留。');
    }
  };

  const invalidSubmit = (formErrors: typeof errors) => {
    const first = Object.entries(formErrors)[0];
    const fieldName = first?.[0];
    if (fieldName) window.requestAnimationFrame(() => document.getElementById(fieldName)?.focus());
    setSubmitState('error');
    setSubmitMessage(`${Object.keys(formErrors).length} validation issue${Object.keys(formErrors).length === 1 ? '' : 's'}`);
    setSubmitErrorMessage('存在未通过校验的字段。错误已显示在对应字段附近。');
  };

  const continueAdding = () => {
    reset(DEFAULTS);
    setSubmittedRecord(null);
    setSubmitState('idle');
    setSubmitMessage('Ready for another submission');
    setSubmitErrorMessage(null);
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
        <div className="fixed inset-0 z-[90] bg-zinc-950/35" aria-hidden="true" />
        <aside className="fixed inset-y-0 right-0 z-[95] flex w-full max-w-xl flex-col border-l border-zinc-200 bg-[#f3f5f7] shadow-xl" aria-label="Lease submission result">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
            <div><div className="text-[10px] font-bold tracking-[0.14em] text-[#003e7e]">LEASE SUBMISSION</div><h2 className="mt-0.5 text-sm font-semibold text-zinc-900">Submission succeeded</h2></div>
            <button type="button" onClick={onClose} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100" aria-label="返回工作区"><X size={17} /></button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-emerald-200 bg-white p-5">
              <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 size={20} /><strong className="text-sm">{mode === 'edit' ? 'Record updated' : 'Record written to database'}</strong></div>
              <dl className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200 text-xs">
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-zinc-400">企业</dt><dd className="font-medium text-zinc-800">{submittedRecord.company}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-zinc-400">楼宇</dt><dd className="font-medium text-zinc-800">{submittedRecord.new_building}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-zinc-400">面积</dt><dd className="tabular-nums text-zinc-800">{submittedRecord.area_sqm?.toLocaleString('zh-CN') ?? '-'} ㎡</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-zinc-400">成交季度</dt><dd className="text-zinc-800">{submittedRecord.transaction_year} {submittedRecord.transaction_quarter}</dd></div>
                <div className="grid grid-cols-[90px_1fr] gap-3 px-3 py-2"><dt className="text-zinc-400">Record ID</dt><dd className="truncate font-mono text-[10px] text-zinc-500" title={submittedRecord.id}>{submittedRecord.id || 'Database generated'}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] leading-5 text-zinc-500">该记录已完成数据库写入。返回工作区后，提交历史会刷新；新增模式可直接继续录入下一条。</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                {mode === 'create' && <button type="button" onClick={continueAdding} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#003e7e] bg-white px-3 py-2 text-xs font-semibold text-[#003e7e]">继续新增 <ChevronRight size={13} /></button>}
                <button type="button" onClick={onClose} className="rounded-md bg-[#003e7e] px-3 py-2 text-xs font-semibold text-white">返回工作区</button>
              </div>
            </div>
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-zinc-950/35" onClick={onClose} aria-hidden="true" />
      <aside className="fixed inset-y-0 right-0 z-[95] flex w-full max-w-3xl flex-col border-l border-zinc-200 bg-[#f3f5f7] shadow-xl" role="dialog" aria-modal="true" aria-labelledby="lease-entry-title">
        <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="text-[10px] font-bold tracking-[0.14em] text-[#003e7e]">LEASE SUBMISSION</div><h2 id="lease-entry-title" className="mt-0.5 truncate text-sm font-semibold text-zinc-900">{mode === 'edit' ? 'Edit transaction record' : 'New transaction record'}</h2></div>
            <div className="flex items-center gap-2"><SaveStatus state={submitState} message={submitMessage} /><button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 disabled:opacity-50" aria-label="关闭填报"><X size={17} /></button></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400"><span>{errorCount ? `${errorCount} validation issue${errorCount === 1 ? '' : 's'}` : 'Validation ready'}</span><span>·</span><span>{dirtyCount} changed fields</span><span>·</span><span>Required *</span></div>
        </div>

        <form onSubmit={handleSubmit(submitValidated, invalidSubmit)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" autoComplete="off">
          {submitError && <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white p-2.5"><ValidationMessage severity="error">{submitError}</ValidationMessage></div>}

          {mode === 'create' && (
            <div className="border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700"><input type="checkbox" checked={isOnBehalf} onChange={(event) => { setIsOnBehalf(event.target.checked); if (!event.target.checked) setBehalfUserId(''); }} className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]" />代他人填报 <span className="font-normal text-zinc-400">记录将归属被代报人</span></label>
              {isOnBehalf && <div className="mt-2 max-w-xs"><SearchableSelect value={behalfUserId} onChange={setBehalfUserId} options={brokers.map((broker) => ({ value: broker.user_id, label: broker.name }))} placeholder="选择被代报人 *" /></div>}
            </div>
          )}

          <Section index="01" title="Tenant & Requirement" description="Identity and demand classification">
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

          <Section index="02" title="Transaction Building" description="Entity-first selection; auto-fill market attributes">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1"><label className="mb-1 block text-[11px] font-medium text-zinc-600">交易楼宇 *</label>{buildingsLoading ? <div className="min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-400">Loading buildings…</div> : manualBuilding ? <input {...register('new_building')} id="new_building" className="min-h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs outline-none focus:border-[#003e7e]" placeholder="手动输入楼宇名称" /> : <SearchableSelect value={selectedBuilding || ''} onChange={(value) => selectBuilding(value)} options={allBuildingNames} locked={buildingLocked} onClear={() => clearBuilding()} placeholder="搜索楼宇名称…" />}{!manualBuilding ? <button type="button" onClick={() => enableManual()} className="mt-1 text-[10px] font-medium text-[#003e7e]">未匹配到？手动录入</button> : <button type="button" onClick={() => clearBuilding()} className="mt-1 text-[10px] font-medium text-[#003e7e]">返回实体选择</button>}{errors.new_building && <p className="mt-1 text-[10px] text-rose-600">{errors.new_building.message}</p>}</div>
              {recentBuildings.length > 0 && !manualBuilding && !buildingLocked && <div className="sm:col-span-2 lg:col-span-2"><span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400">Recent</span><div className="flex flex-wrap gap-1">{recentBuildings.map((name) => <button key={name} type="button" onClick={() => selectBuilding(name)} className="max-w-52 truncate rounded-[4px] border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-600 hover:border-[#003e7e]/30 hover:text-[#003e7e]">{name}</button>)}</div></div>}
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">子市场 *</label>{buildingLocked ? <input {...register('sub_market')} id="sub_market" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600" /> : <SearchableSelect value={watch('sub_market') || ''} onChange={(value) => setValue('sub_market', value, { shouldDirty: true, shouldValidate: true })} options={submarkets} placeholder="请选择" />}{errors.sub_market && <p className="mt-1 text-[10px] text-rose-600">{errors.sub_market.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">区域 *</label><input {...register('district')} id="district" readOnly={buildingLocked} className={`min-h-9 w-full rounded-md border px-2.5 text-xs outline-none focus:border-[#003e7e] ${buildingLocked ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-zinc-300 bg-white'}`} placeholder="如：朝阳区" />{errors.district && <p className="mt-1 text-[10px] text-rose-600">{errors.district.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼宇等级 *</label>{buildingLocked ? <input {...register('building_grade')} id="building_grade" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600" /> : <SearchableSelect value={watch('building_grade') || ''} onChange={(value) => setValue('building_grade', value as LeaseTransactionFormData['building_grade'], { shouldDirty: true, shouldValidate: true })} options={['甲级','乙级','产业园','其他']} placeholder="请选择" />}{errors.building_grade && <p className="mt-1 text-[10px] text-rose-600">{errors.building_grade.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼座 *</label><div className="flex gap-1.5"><input {...register('floor_info')} id="floor_info" disabled={floorInfoUnknown} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder={floorInfoUnknown ? '未知' : '如：A座'} /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={floorInfoUnknown} onChange={(event) => { setFloorInfoUnknown(event.target.checked); setValue('floor_info', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.floor_info && <p className="mt-1 text-[10px] text-rose-600">{errors.floor_info.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">楼层 *</label><div className="flex gap-1.5"><input {...register('floor')} id="floor" disabled={floorUnknown} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder={floorUnknown ? '未知' : '如：15'} /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={floorUnknown} onChange={(event) => { setFloorUnknown(event.target.checked); setValue('floor', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.floor && <p className="mt-1 text-[10px] text-rose-600">{errors.floor.message}</p>}</div>
            </div>
          </Section>

          {demandType === '搬迁' && <Section index="03" title="Previous Location" description="Required only for relocation"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址楼宇 *</label>{oldAddressUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : manualOldBuilding ? <input {...register('old_address')} id="old_address" className="min-h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs" placeholder="手动输入原址楼宇" /> : <SearchableSelect value={selectedOldBuilding || ''} onChange={(value) => selectBuilding(value, true)} options={allBuildingNames} locked={oldBuildingLocked} onClear={() => clearBuilding(true)} placeholder="搜索原址楼宇…" />}<div className="mt-1 flex items-center justify-between gap-2"><button type="button" disabled={oldAddressUnknown} onClick={() => manualOldBuilding ? clearBuilding(true) : enableManual(true)} className="text-[10px] font-medium text-[#003e7e] disabled:text-zinc-300">{manualOldBuilding ? '返回实体选择' : '手动录入'}</button><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldAddressUnknown} onChange={(event) => { const checked = event.target.checked; setOldAddressUnknown(checked); setValue('old_address', checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); if (checked && !getValues('old_district')) { setOldDistrictUnknown(true); setValue('old_district', '未知', { shouldDirty: true }); } }} />未知</label></div>{errors.old_address && <p className="mt-1 text-[10px] text-rose-600">{errors.old_address.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址子市场 *</label>{oldSubmarketUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : oldBuildingLocked ? <input {...register('old_sub_market')} id="old_sub_market" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : <SearchableSelect value={watch('old_sub_market') || ''} onChange={(value) => setValue('old_sub_market', value, { shouldDirty: true, shouldValidate: true })} options={submarkets} placeholder="请选择" />}<label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldSubmarketUnknown} onChange={(event) => { setOldSubmarketUnknown(event.target.checked); setValue('old_sub_market', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label>{errors.old_sub_market && <p className="mt-1 text-[10px] text-rose-600">{errors.old_sub_market.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址区域 *</label><div className="flex gap-1.5"><input {...register('old_district')} id="old_district" disabled={oldDistrictUnknown} readOnly={oldBuildingLocked} className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 text-xs disabled:bg-zinc-100" placeholder="如：朝阳区" /><label className="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldDistrictUnknown} onChange={(event) => { setOldDistrictUnknown(event.target.checked); setValue('old_district', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label></div>{errors.old_district && <p className="mt-1 text-[10px] text-rose-600">{errors.old_district.message}</p>}</div>
            <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">原址等级 *</label>{oldGradeUnknown ? <input value="未知" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : oldBuildingLocked ? <input {...register('old_building_grade')} id="old_building_grade" readOnly className="min-h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs" /> : <SearchableSelect value={watch('old_building_grade') || ''} onChange={(value) => setValue('old_building_grade', value as LeaseTransactionFormData['old_building_grade'], { shouldDirty: true, shouldValidate: true })} options={['甲级','乙级','产业园','其他']} placeholder="请选择" />}<label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={oldGradeUnknown} onChange={(event) => { setOldGradeUnknown(event.target.checked); setValue('old_building_grade', event.target.checked ? '未知' : '', { shouldDirty: true, shouldValidate: true }); }} />未知</label>{errors.old_building_grade && <p className="mt-1 text-[10px] text-rose-600">{errors.old_building_grade.message}</p>}</div>
          </div></Section>}

          <Section index={demandType === '搬迁' ? '04' : '03'} title="Economics" description="Rent values are persisted as RMB / sqm / month">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField name="area_sqm" label="租赁面积 (㎡)" type="number" placeholder="如：500" register={register} error={errors.area_sqm} required />
              <div><div className="flex items-end gap-1.5"><div className="min-w-0 flex-1"><FormField name="face_rent" label={`表面租金 (元/㎡/${faceRentUnit === 'daily' ? '天' : '月'})`} type="number" placeholder={faceRentUnit === 'daily' ? '如：5' : '如：150'} register={register} error={errors.face_rent} required /></div><button type="button" onClick={() => setFaceRentUnit((unit) => unit === 'daily' ? 'monthly' : 'daily')} className="mb-[1px] min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[10px] font-semibold text-zinc-600">{faceRentUnit === 'daily' ? '日' : '月'} ⇄</button></div><label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" {...register('is_face_rent_estimated')} />预估值</label></div>
              <div><div className="flex items-end gap-1.5"><div className="min-w-0 flex-1"><FormField name="effective_rent" label={`有效租金 (元/㎡/${effectiveRentUnit === 'daily' ? '天' : '月'})`} type="number" placeholder={effectiveRentUnit === 'daily' ? '如：4.5' : '如：135'} register={register} error={errors.effective_rent} required /></div><button type="button" onClick={() => setEffectiveRentUnit((unit) => unit === 'daily' ? 'monthly' : 'daily')} className="mb-[1px] min-h-9 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[10px] font-semibold text-zinc-600">{effectiveRentUnit === 'daily' ? '日' : '月'} ⇄</button></div><label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" {...register('is_effective_rent_estimated')} />预估值</label></div>
              <FormField name="lease_term_months" label="租期 (月)" type="number" placeholder="如：36" register={register} error={errors.lease_term_months} />
              <FormField name="fit_out_months" label="装修期 (月)" type="number" placeholder="如：2" register={register} error={errors.fit_out_months} />
              <FormField name="rent_free_months" label="免租期 (月)" type="number" placeholder="如：1" register={register} error={errors.rent_free_months} />
            </div>
          </Section>

          <Section index={demandType === '搬迁' ? '05' : '04'} title="Timing & Context" description="Current quarter and previous quarter remain selectable">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">成交年份 *</label><SearchableSelect value={String(selectedYear || '')} onChange={(value) => setValue('transaction_year', Number(value), { shouldDirty: true, shouldValidate: true })} options={availableYears.map((year) => ({ value: String(year), label: String(year) }))} placeholder="年份" />{errors.transaction_year && <p className="mt-1 text-[10px] text-rose-600">{errors.transaction_year.message}</p>}</div>
              <div><label className="mb-1 block text-[11px] font-medium text-zinc-600">成交季度 *</label><SearchableSelect value={watch('transaction_quarter') || ''} onChange={(value) => setValue('transaction_quarter', value, { shouldDirty: true, shouldValidate: true })} options={availableQuarters} placeholder="季度" disabled={!selectedYear} />{errors.transaction_quarter && <p className="mt-1 text-[10px] text-rose-600">{errors.transaction_quarter.message}</p>}</div>
              <div className="sm:col-span-2 lg:col-span-2"><FormField name="remarks" label="备注" type="textarea" placeholder="代理行、业主租赁策略变化、企业客户重要情况等" register={register} error={errors.remarks} /></div>
            </div>
          </Section>

          <DataEntryToolbar className="sticky bottom-0 z-30" leading={<div className="text-[10px] text-zinc-500">{errorCount ? <span className="font-semibold text-rose-700">{errorCount} fields need attention</span> : 'Validation errors appear beside the affected field.'}</div>}>
            <button type="button" onClick={onClose} disabled={isSubmitting || submitState === 'saving'} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isSubmitting || submitState === 'saving' || submitState === 'submitting'} className="inline-flex items-center gap-1.5 rounded-md bg-[#003e7e] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{(isSubmitting || submitState === 'saving' || submitState === 'submitting') && <Loader2 size={13} className="animate-spin" />}{submitState === 'saving' ? 'Checking…' : submitState === 'submitting' ? 'Submitting…' : mode === 'edit' ? 'Update record' : 'Submit record'}</button>
          </DataEntryToolbar>
        </form>
      </aside>

      {showDuplicate && <DuplicateDialog duplicates={duplicates} onCancel={() => { setShowDuplicate(false); setForceSubmit(false); forceSubmitRef.current = false; setSubmitState('idle'); }} onConfirm={() => { setShowDuplicate(false); setForceSubmit(true); forceSubmitRef.current = true; const values = getValues(); window.setTimeout(() => { void submitValidated(values); }, 0); }} />}
    </>
  );
}
