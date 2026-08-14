'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, AlertTriangle, CheckCircle, Loader2, Building2, Info, FileText, Calendar } from 'lucide-react';

import { 
  leaseTransactionSchema, 
  type LeaseTransactionFormData,
} from '../schemas/leaseTransactionSchema';
import { FormField } from './FormField';
import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import { checkFuzzyDuplicate, submitTransaction, updateTransaction, getAllBrokers } from '@/src/services/leaseTransactionSubmitService';
import type { LeaseTransaction, DuplicateCheckResult } from '@/src/types/lease-transaction';
import { useBuildings } from '@/src/hooks/useBuildings';
import { logAction } from '@/src/utils/audit';
import { supabase } from '@/src/services/supabaseClient';

// ==========================================
// 重复警告模态框（保持原有逻辑）
// ==========================================
interface DuplicateWarningModalProps {
  isOpen: boolean;
  duplicates: LeaseTransaction[];
  onConfirm: () => void;
  onCancel: () => void;
}

function DuplicateWarningModal({ isOpen, duplicates, onConfirm, onCancel }: DuplicateWarningModalProps) {
  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  React.useEffect(() => {
    if (isOpen) modalRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-modal-title"
        className="w-full max-w-2xl rounded-xl border border-amber-200 bg-white p-6 shadow-xl"
        tabIndex={-1}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="text-amber-600" size={20} />
          </div>
          <div>
            <h3 id="duplicate-modal-title" className="text-lg font-semibold text-zinc-900">
              ⚠️ 发现相似的成交记录
            </h3>
            <p className="text-sm text-zinc-500 mt-0.5">
              系统检测到以下记录与您要提交的数据相似，请仔细核对是否为同一笔交易
            </p>
          </div>
        </div>

        {/* 🔥 业务说明 */}
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-sm text-blue-800">
            <strong>业务规则：</strong>不同 Broker 可以上传相似的成交记录，
            只要您确认这<strong>不是同一笔交易</strong>即可继续提交。
          </p>
        </div>

        {/* 🔥 相似记录列表 */}
        <div className="mb-5 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-100">
              <tr className="border-b border-zinc-200">
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600">原提交人</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600">公司名称</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600">楼宇</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-600">面积 (㎡)</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-zinc-600">季度</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-zinc-600">提交时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {duplicates.map((item, idx) => (
                <tr key={item.id ?? idx} className="hover:bg-zinc-100/50">
                  <td className="px-3 py-2">
                    <span className="font-medium text-[#003e7e]">{item.submitter_name || '-'}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-900">{item.company || '-'}</td>
                  <td className="px-3 py-2 text-zinc-700">{item.new_building || '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                    {item.area_sqm ? item.area_sqm.toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="px-3 py-2 text-center text-zinc-600">{item.transaction_quarter || '-'}</td>
                  <td className="px-3 py-2 text-center text-zinc-500 text-xs">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 🔥 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            返回修改
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 shadow-sm"
          >
            ⚠️ 确认非同一笔，执意提交
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Toast 提示组件
// ==========================================
interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  React.useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="fixed bottom-6 right-6 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-300"
      role={type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div
        className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg ${
          type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        } text-white`}
      >
        {type === 'success' ? (
          <CheckCircle size={18} />
        ) : (
          <AlertTriangle size={18} />
        )}
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}

// ==========================================
// 主表单组件
// ==========================================
interface LeaseTransactionFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  userId: string;
  userName: string;
  mode?: 'create' | 'edit';
  initialData?: LeaseTransaction;
}

export function LeaseTransactionForm({
  isOpen,
  onClose,
  onSubmitSuccess,
  userId,
  userName,
  mode = 'create',
  initialData,
}: LeaseTransactionFormProps) {
  // 获取楼宇数据 - 🔥 强制重新验证，确保数据加载
  const { buildings, isLoading: isBuildingsLoading } = useBuildings({
    revalidateOnMount: true,
  });

  // 🌟 CL-036: 租金单位切换（日租金/月租金）
  const [faceRentUnit, setFaceRentUnit] = React.useState<'monthly' | 'daily'>('monthly');
  const [effectiveRentUnit, setEffectiveRentUnit] = React.useState<'monthly' | 'daily'>('monthly');
  const [isFloorInfoUnknown, setIsFloorInfoUnknown] = React.useState(false);
  const [isFloorUnknown, setIsFloorUnknown] = React.useState(false);
  const [isOldSubMarketUnknown, setIsOldSubMarketUnknown] = React.useState(false);
  const [isOldBuildingGradeUnknown, setIsOldBuildingGradeUnknown] = React.useState(false);
  const [isOldAddressUnknown, setIsOldAddressUnknown] = React.useState(false);
  const [isOldDistrictUnknown, setIsOldDistrictUnknown] = React.useState(false);

  // 代他人填报
  const [isOnBehalf, setIsOnBehalf] = React.useState(false);
  const [behalfUserId, setBehalfUserId] = React.useState('');
  const [brokers, setBrokers] = React.useState<Array<{ user_id: string; name: string }>>([]);

  // 🔥 调试：监控楼宇数据加载状态
  React.useEffect(() => {
    console.log('🏢 [表单] 楼宇数据状态变化');
    console.log('   - isLoading:', isBuildingsLoading);
    console.log('   - buildings:', buildings ? `${buildings.length} 条` : 'undefined');
    if (buildings && buildings.length > 0) {
      console.log('   - 第一条楼宇:', buildings[0]);
      console.log('   - 有 submarket 的楼宇数:', buildings.filter(b => b.submarket).length);
    }
  }, [buildings, isBuildingsLoading]);

  // 行业/子行业数据（从 industry_classification 表拉取）
  const [industryMap, setIndustryMap] = React.useState<Record<string, string[]>>({});
  const [industryOptions, setIndustryOptions] = React.useState<string[]>([]);
  const [subIndustryOptions, setSubIndustryOptions] = React.useState<string[]>([]);
  const [isCustomSubIndustry, setIsCustomSubIndustry] = React.useState(false);
  const [customSubIndustryText, setCustomSubIndustryText] = React.useState('');

  // 拉取行业数据
  React.useEffect(() => {
    if (!isOpen) return;
    supabase.from('industry_classification')
      .select('industry_level1, sub_industry')
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, Set<string>> = {};
        for (const row of data) {
          if (!map[row.industry_level1]) map[row.industry_level1] = new Set();
          map[row.industry_level1].add(row.sub_industry);
        }
        const sorted: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(map)) {
          sorted[k] = [...v].sort();
        }
        setIndustryMap(sorted);
        setIndustryOptions(Object.keys(sorted).sort());
      });
  }, [isOpen]);

  // 加载业务员列表（代他人填报用）
  React.useEffect(() => {
    if (isOpen && mode === 'create' && brokers.length === 0) {
      getAllBrokers().then(list => {
        setBrokers(list.filter(b => b.user_id !== userId));
      }).catch(e => console.error('获取业务员列表失败', e));
    }
    if (!isOpen) {
      setIsOnBehalf(false);
      setBehalfUserId('');
      setIsCustomSubIndustry(false);
      setCustomSubIndustryText('');
    }
  }, [isOpen, mode, userId]);

  // React Hook Form 初始化
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    getValues,
    watch,
    setValue,
    setError,
  } = useForm<LeaseTransactionFormData>({
    resolver: zodResolver(leaseTransactionSchema),
    mode: 'onSubmit', // 🔥 改为仅在提交时校验，避免填写过程中出现错误提示
    defaultValues: {
      is_manual_building: false,
      is_face_rent_estimated: false,
      is_effective_rent_estimated: false,
      floor_info: '',
      floor: '',
    },
  });

  // 监听行业变化，联动子行业下拉
  const watchedIndustry = watch('industry');

  const toMonthlyRent = React.useCallback((rent: number, unit: 'monthly' | 'daily') => (
    unit === 'daily' ? rent * 365 / 12 : rent
  ), []);

  const validateMonthlyRentBounds = React.useCallback((data: LeaseTransactionFormData) => {
    const rents = [
      { field: 'face_rent' as const, label: '表面租金', value: data.face_rent, unit: faceRentUnit },
      { field: 'effective_rent' as const, label: '有效租金', value: data.effective_rent, unit: effectiveRentUnit },
    ];

    let isValid = true;
    for (const rent of rents) {
      if (rent.value !== undefined && toMonthlyRent(rent.value, rent.unit) > 1000) {
        setError(rent.field, {
          type: 'validate',
          message: `${rent.label}不得超过 1000 元/㎡/月，请核对金额或单位后修改。`,
        });
        isValid = false;
      }
    }

    const faceRentMonthly = toMonthlyRent(data.face_rent, faceRentUnit);
    const effectiveRentMonthly = toMonthlyRent(data.effective_rent, effectiveRentUnit);
    if (effectiveRentMonthly > faceRentMonthly) {
      setError('effective_rent', {
        type: 'validate',
        message: '有效租金不能高于表面租金，请核对填写内容后修改。',
      });
      isValid = false;
    }

    return isValid;
  }, [effectiveRentUnit, faceRentUnit, setError, toMonthlyRent]);

  React.useEffect(() => {
    if (!watchedIndustry || !industryMap[watchedIndustry]) {
      setSubIndustryOptions([]);
      return;
    }
    setSubIndustryOptions(industryMap[watchedIndustry]);
    // 切换行业时清空子行业（编辑模式初次回填除外）
    const currentSub = getValues('sub_industry');
    if (currentSub && !industryMap[watchedIndustry]?.includes(currentSub) && !isCustomSubIndustry) {
      setValue('sub_industry', '');
      setIsCustomSubIndustry(false);
    }
  }, [watchedIndustry, industryMap]);

  // 编辑模式：检测子行业是否为自定义值（不在标准列表中）
  React.useEffect(() => {
    if (mode === 'edit' && initialData && subIndustryOptions.length > 0) {
      const currentSub = getValues('sub_industry');
      if (currentSub && !subIndustryOptions.includes(currentSub)) {
        setIsCustomSubIndustry(true);
      }
    }
  }, [subIndustryOptions, mode]);

  // 🔥 处理表单回填：当 mode 为 edit 且 initialData 变化时，或者 isOpen 变为 true 时
  React.useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        const quarterValue = initialData.transaction_quarter || '';

        const validEnterpriseTypes = ['央国企', '外企', '民企', '其他'] as const;

        const enterpriseTypeValue = validEnterpriseTypes.includes(initialData.enterprise_type as any)
          ? (initialData.enterprise_type as any)
          : undefined;

        // 数据库 grade → 表单 grade 反向映射
        const reverseGradeMap: Record<string, string> = {
          'A': '甲级', 'P': '甲级', 'B': '乙级', 'BP': '产业园',
        };
        const mapGrade = (dbGrade: string | null | undefined) => {
          if (!dbGrade) return '';
          return reverseGradeMap[dbGrade] || '其他';
        };

        reset({
          company: initialData.company || '',
          suspected_company_fullname: initialData.suspected_company_fullname || '',
          enterprise_type: enterpriseTypeValue,
          industry: initialData.industry || '',
          sub_industry: initialData.sub_industry || '',
          demand_type: (initialData.demand_type as any) || '',
          relocation_area_change: (initialData.relocation_area_change as any) || '',
          is_manual_building: initialData.is_manual_building || false,
          is_manual_old_building: initialData.is_manual_old_building || false,
          new_building: initialData.new_building || '',
          floor_info: initialData.floor_info || '',
          floor: initialData.floor || '',
          sub_market: initialData.sub_market || '',
          district: initialData.district || '',
          building_grade: mapGrade(initialData.building_grade) as any,
          old_address: initialData.old_address || '',
          old_sub_market: initialData.old_sub_market || '',
          old_district: initialData.old_district || '',
          old_building_grade: mapGrade(initialData.old_building_grade) as any,
          area_sqm: initialData.area_sqm ?? undefined,
          face_rent: initialData.face_rent ?? undefined,
          is_face_rent_estimated: initialData.is_face_rent_estimated === true,
          lease_term_months: initialData.lease_term_months ?? undefined,
          fit_out_months: initialData.fit_out_months ?? undefined,
          rent_free_months: initialData.rent_free_months ?? undefined,
          effective_rent: initialData.effective_rent ?? undefined,
          is_effective_rent_estimated: initialData.is_effective_rent_estimated === true,
          transaction_year: initialData.transaction_year ?? undefined,
          transaction_quarter: quarterValue,
          remarks: initialData.remarks || '',
        });
        // 🌟 CL-036: 自动检测租金单位（<30 视为日租金）
        const fr = Number(initialData.face_rent);
        setFaceRentUnit(fr > 0 && fr < 30 ? 'daily' : 'monthly');
        const er = Number(initialData.effective_rent);
        setEffectiveRentUnit(er > 0 && er < 30 ? 'daily' : 'monthly');
        // CL-020: 楼座楼层"未知"状态
        setIsFloorInfoUnknown(initialData.floor_info === '未知');
        setIsFloorUnknown(initialData.floor === '未知');
        // 原址信息"未知"状态
        setIsOldSubMarketUnknown(initialData.old_sub_market === '未知');
        setIsOldBuildingGradeUnknown(initialData.old_building_grade === '未知');
        setIsOldAddressUnknown(initialData.old_address === '未知');
        setIsOldDistrictUnknown(initialData.old_district === '未知');
        // 楼宇锁定状态：编辑时如果楼宇名在列表中，锁定；否则切手动模式
        if (buildings && buildings.length > 0) {
          const matched = buildings.some(b => b.name === initialData.new_building);
          setSelectedBuildingLocked(matched && !initialData.is_manual_building);
          if (!matched && !initialData.is_manual_building) {
            // 楼宇名不在列表中，自动切手动模式
            setValue('is_manual_building', true);
          }
          if (initialData.old_address) {
            const oldMatched = buildings.some(b => b.name === initialData.old_address);
            setSelectedOldBuildingLocked(oldMatched && !initialData.is_manual_old_building);
            if (!oldMatched && !initialData.is_manual_old_building) {
              setValue('is_manual_old_building', true);
            }
          }
        }
      } else {
        // 新建模式：清空表单
        reset({
          is_manual_building: false,
          is_manual_old_building: false,
          is_face_rent_estimated: false,
          is_effective_rent_estimated: false,
        });
        setFaceRentUnit('monthly');
        setEffectiveRentUnit('monthly');
        setIsFloorInfoUnknown(false);
        setIsFloorUnknown(false);
        setSelectedBuildingLocked(false);
        setSelectedOldBuildingLocked(false);
      }
    }
  }, [isOpen, mode, initialData, reset]);

  // 编辑模式：buildings 加载完成后再校验锁定状态（异步依赖）
  React.useEffect(() => {
    if (!isOpen || mode !== 'edit' || !initialData || !buildings || buildings.length === 0) return;

    const matched = buildings.some(b => b.name === initialData.new_building);
    setSelectedBuildingLocked(matched && !initialData.is_manual_building);
    if (!matched && !initialData.is_manual_building) {
      setValue('is_manual_building', true);
    }

    if (initialData.old_address) {
      const oldMatched = buildings.some(b => b.name === initialData.old_address);
      setSelectedOldBuildingLocked(oldMatched && !initialData.is_manual_old_building);
      if (!oldMatched && !initialData.is_manual_old_building) {
        setValue('is_manual_old_building', true);
      }
    }
  }, [isOpen, mode, initialData, buildings]);

  // 监听需求类型变化（用于条件渲染）
  const demandType = watch('demand_type');
  const isManualBuilding = watch('is_manual_building');
  const selectedYear = watch('transaction_year');
  const isManualOldBuilding = watch('is_manual_old_building');

  // 🔥 计算可选的年份和季度（浮动两个季度）
  const { availableYears, availableQuarters } = React.useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentQuarter = Math.ceil(currentMonth / 3); // 1-4

    // 计算当前是第几个季度（从 2020Q1 开始计数）
    const currentQuarterIndex = (currentYear - 2020) * 4 + currentQuarter;
    
    // 可选范围：当前季度和前一个季度（共2个季度）
    const minQuarterIndex = currentQuarterIndex - 1;
    const maxQuarterIndex = currentQuarterIndex;

    // 计算可选的年份
    const minYear = 2020 + Math.floor((minQuarterIndex - 1) / 4);
    const maxYear = 2020 + Math.floor((maxQuarterIndex - 1) / 4);
    
    const years: number[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      years.push(y);
    }

    // 计算可选的季度（根据选中的年份）
    const quarters: string[] = [];
    if (selectedYear) {
      const yearQuarterStart = (selectedYear - 2020) * 4 + 1;
      const yearQuarterEnd = (selectedYear - 2020) * 4 + 4;
      
      for (let q = 1; q <= 4; q++) {
        const quarterIndex = (selectedYear - 2020) * 4 + q;
        if (quarterIndex >= minQuarterIndex && quarterIndex <= maxQuarterIndex) {
          quarters.push(`Q${q}`);
        }
      }
    }

    console.log('📅 [时间选择] 当前:', `${currentYear}Q${currentQuarter}`);
    console.log('📅 [时间选择] 可选年份:', years);
    console.log('📅 [时间选择] 可选季度:', quarters);

    return {
      availableYears: years,
      availableQuarters: quarters,
    };
  }, [selectedYear]);

  // 🔥 当年份改变时，自动设置季度
  React.useEffect(() => {
    if (selectedYear && availableQuarters.length > 0) {
      const currentQuarter = watch('transaction_quarter');
      // 如果当前季度不在可选范围内，自动设置为最后一个可选季度
      if (!currentQuarter || !availableQuarters.includes(currentQuarter)) {
        setValue('transaction_quarter', availableQuarters[availableQuarters.length - 1]);
        console.log('📅 [时间选择] 自动设置季度:', availableQuarters[availableQuarters.length - 1]);
      }
    }
  }, [selectedYear, availableQuarters, setValue, watch]);

  // 重复检测状态
  const [isCheckingDuplicate, setIsCheckingDuplicate] = React.useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<LeaseTransaction[]>([]);
  const [forceSubmit, setForceSubmit] = React.useState(false);
  
  // Toast 状态
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // 定时器引用（用于清理）
  const submitTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // 关闭时重置表单
  React.useEffect(() => {
    if (!isOpen) {
      reset();
      setDuplicates([]);
      setForceSubmit(false);
      // 清理可能存在的定时器
      if (submitTimerRef.current) {
        clearTimeout(submitTimerRef.current);
        submitTimerRef.current = null;
      }
    }
  }, [isOpen, reset]);

  // 获取去重后的子市场列表
  const uniqueSubMarkets = React.useMemo(() => {
    console.log('🔍 [表单] 计算 uniqueSubMarkets');
    console.log('   - buildings:', buildings ? `${buildings.length} 条` : 'undefined');
    
    if (!buildings || buildings.length === 0) {
      console.log('   - 返回空数组（无楼宇数据）');
      return [];
    }
    
    const submarkets = buildings
      .map(b => b.submarket)
      .filter((sm): sm is string => !!sm && sm.trim() !== '');
    
    console.log('   - 提取到的子市场:', submarkets);
    
    const unique = Array.from(new Set(submarkets)).sort();
    console.log('   - 去重后的子市场:', unique);
    
    return unique;
  }, [buildings]);

  // 所有楼宇名称列表（用于搜索）
  const allBuildingNames = React.useMemo(() => {
    if (!buildings) return [];
    return buildings.map(b => b.name).sort();
  }, [buildings]);

  // 楼宇锁定状态（从列表选中后锁定，不可编辑，需清除重选）
  const [selectedBuildingLocked, setSelectedBuildingLocked] = React.useState(false);
  const [selectedOldBuildingLocked, setSelectedOldBuildingLocked] = React.useState(false);

  // 数据库 grade → 表单 grade 映射
  const dbGradeToFormGrade = React.useCallback((dbGrade: string | null | undefined): string => {
    if (!dbGrade) return '';
    const map: Record<string, string> = { 'A': '甲级', 'P': '甲级', 'B': '乙级', 'BP': '产业园' };
    return map[dbGrade] || '其他';
  }, []);

  // 处理楼宇选择后的自动回填（子市场 + 等级 + 区域）
  const handleBuildingSelect = React.useCallback((buildingName: string) => {
    if (!buildings) return;
    const building = buildings.find(b => b.name === buildingName);
    if (!building) return;

    setValue('sub_market', building.submarket || '', { shouldValidate: false });
    setValue('building_grade', dbGradeToFormGrade(building.grade) as any, { shouldValidate: false });
    setValue('district', building.district || '', { shouldValidate: false });
    setValue('is_manual_building', false);
    setSelectedBuildingLocked(true);
  }, [buildings, setValue, dbGradeToFormGrade]);

  // 清除楼宇选择，解锁
  const handleBuildingClear = React.useCallback(() => {
    setValue('new_building', '');
    setValue('sub_market', '');
    setValue('building_grade', '' as any);
    setValue('district', '');
    setValue('is_manual_building', false);
    setSelectedBuildingLocked(false);
  }, [setValue]);

  // 切换到手动录入模式
  const handleManualBuildingToggle = React.useCallback(() => {
    setValue('is_manual_building', true);
    setValue('sub_market', '');
    setValue('building_grade', '' as any);
    setValue('district', '');
    setSelectedBuildingLocked(false);
  }, [setValue]);

  // 处理原址楼宇选择后的自动回填（搬迁模式）
  const handleOldBuildingSelect = React.useCallback((buildingName: string) => {
    if (!buildings) return;
    const building = buildings.find(b => b.name === buildingName);
    if (!building) return;

    setValue('old_sub_market', building.submarket || '', { shouldValidate: false });
    setValue('old_building_grade', dbGradeToFormGrade(building.grade) as any, { shouldValidate: false });
    setValue('old_district', building.district || '', { shouldValidate: false });
    setValue('is_manual_old_building', false);
    setSelectedOldBuildingLocked(true);
  }, [buildings, setValue, dbGradeToFormGrade]);

  // 清除原址楼宇选择，解锁
  const handleOldBuildingClear = React.useCallback(() => {
    setValue('old_address', '');
    setValue('old_sub_market', '');
    setValue('old_building_grade', '' as any);
    setValue('old_district', '');
    setValue('is_manual_old_building', false);
    setSelectedOldBuildingLocked(false);
  }, [setValue]);

  // 切换到原址手动录入模式
  const handleManualOldBuildingToggle = React.useCallback(() => {
    setValue('is_manual_old_building', true);
    setValue('old_sub_market', '');
    setValue('old_building_grade', '' as any);
    setValue('old_district', '');
    setSelectedOldBuildingLocked(false);
  }, [setValue]);

  // 检查重复（模糊匹配）
  const checkForDuplicates = async (data: LeaseTransactionFormData): Promise<boolean> => {
    const company = data.company?.trim();
    const building = data.new_building?.trim();
    const area = data.area_sqm;
    const quarter = data.transaction_quarter;
    const year = data.transaction_year;

    if (!company || !building || !area || !quarter || !year) {
      console.log('🔍 [检测] 跳过检测：缺少必要参数');
      console.log('   - 企业:', company || '缺失');
      console.log('   - 楼宇:', building || '缺失');
      console.log('   - 面积:', area || '缺失');
      console.log('   - 年份:', year || '缺失');
      console.log('   - 季度:', quarter || '缺失');
      return false;
    }
    
    try {
      setIsCheckingDuplicate(true);
      
      console.log('🔍 [检测] 开始模糊检测');
      console.log('   - 企业:', company);
      console.log('   - 楼宇:', building);
      console.log('   - 面积:', area);
      console.log('   - 季度:', quarter);
      console.log('   - 模式:', mode);
      console.log('   - 排除ID:', mode === 'edit' && initialData?.id ? initialData.id : '无');
      
      // 🔥 调用模糊检测 API（编辑模式时排除当前记录）
      const result: DuplicateCheckResult = await checkFuzzyDuplicate(
        company,
        building,
        area,
        quarter,  // 使用拼接后的完整季度
        mode === 'edit' && initialData?.id ? initialData.id : undefined
      );
      
      console.log('🔍 [检测] 结果:', result.hasDuplicate ? `发现 ${result.duplicates.length} 条相似记录` : '无重复');
      
      if (result.hasDuplicate && result?.duplicates?.length && result.duplicates.length > 0) {
        setDuplicates(result.duplicates);
        setShowDuplicateModal(true);
        return true;
      }
      
      return false;
    } catch (e) {
      console.error('❌ [检测] 失败:', e);
      console.error('   - 错误类型:', e instanceof Error ? e.constructor.name : typeof e);
      console.error('   - 错误消息:', e instanceof Error ? e.message : String(e));
      
      // 🔥 检测失败不阻止提交，只记录错误
      // 用户可以继续提交，但会在控制台看到详细的错误信息
      return false;
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  // 提交处理
  const onSubmit = async (data: LeaseTransactionFormData) => {
    // 日租金会在提交前换算为月租金，必须以最终保存的月租金值校验上限。
    if (!validateMonthlyRentBounds(data)) return;

    // 🔥 编辑模式：调用更新 API
    if (mode === 'edit' && initialData?.id) {
      console.log('🔍 [提交] 编辑模式，更新记录:', initialData.id);

      // 🔥 编辑模式也需要检测重复（排除自身）
      if (!forceSubmit) {
        const hasDuplicates = await checkForDuplicates(data);
        if (hasDuplicates) return;
      }

      // 🌟 CL-036: 日租金转月租金（×365÷12）
      const faceRentMonthly = faceRentUnit === 'daily' ? (data.face_rent ?? 0) * 365 / 12 : data.face_rent;
      const effectiveRentMonthly = effectiveRentUnit === 'daily' ? (data.effective_rent ?? 0) * 365 / 12 : data.effective_rent;

      // 子行业"其他"自定义处理
      const finalSubIndustry = isCustomSubIndustry && customSubIndustryText.trim()
        ? customSubIndustryText.trim()
        : (data.sub_industry?.trim() || null);

      // 非搬迁需求时，清空原址字段，避免脏数据
      const isRelocation = data.demand_type === '搬迁';

      const updateData: Partial<LeaseTransaction> = {
        company: data.company?.trim() || '',
        suspected_company_fullname: data.suspected_company_fullname?.trim() || null,
        enterprise_type: data.enterprise_type || null,
        industry: data.industry?.trim() || null,
        sub_industry: finalSubIndustry,
        demand_type: data.demand_type || null,
        relocation_area_change: isRelocation ? (data.relocation_area_change || null) : null,
        new_building: data.new_building?.trim() || '',
        floor_info: data.floor_info?.trim() || null,
        floor: data.floor?.trim() || null,
        sub_market: data.sub_market?.trim() || null,
        district: data.district?.trim() || null,
        building_grade: data.building_grade || null,
        old_address: isRelocation ? (data.old_address?.trim() || null) : null,
        old_sub_market: isRelocation ? (data.old_sub_market?.trim() || null) : null,
        old_district: isRelocation ? (data.old_district?.trim() || null) : null,
        old_building_grade: isRelocation ? (data.old_building_grade || null) : null,
        area_sqm: data.area_sqm ?? null,
        face_rent: faceRentMonthly ?? null,
        is_face_rent_estimated: data.is_face_rent_estimated === true,
        lease_term_months: data.lease_term_months ?? null,
        fit_out_months: data.fit_out_months ?? null,
        rent_free_months: data.rent_free_months ?? null,
        effective_rent: effectiveRentMonthly ?? null,
        is_effective_rent_estimated: data.is_effective_rent_estimated === true,
        transaction_date: null,
        transaction_year: data.transaction_year,
        transaction_quarter: data.transaction_quarter, // 🔥 使用拼接后的季度
        remarks: data.remarks?.trim() || null,
        is_manual_building: data.is_manual_building,
        is_manual_old_building: data.is_manual_old_building,
      };
      
      try {
        console.log('🔍 [前端] 开始更新记录');
        console.log('   - 记录 ID:', initialData.id);
        console.log('   - 用户 ID:', userId);
        console.log('   - 更新数据:', updateData);
        
        const result = await updateTransaction(initialData.id, updateData, userId);
        
        console.log('🔍 [前端] 更新结果:', result);
        
        if (result.success) {
          setToast({ message: '更新成功！', type: 'success' });
          logAction(userId, 'SUBMIT_LEASE_TRANSACTION', {
            mode: 'edit', recordId: initialData.id, company: data.company, building: data.new_building,
            area: data.area_sqm, district: data.district, quarter: data.transaction_quarter,
          });
          onSubmitSuccess();
          onClose();
        } else {
          console.error('❌ [前端] 更新失败:', result.error);
          setToast({ message: result.error || '更新失败，请重试', type: 'error' });
        }
      } catch (e) {
        console.error('❌ [前端] 更新异常:', e);
        setToast({ message: '更新失败，请重试', type: 'error' });
      }
      
      return;
    }
    
    // 🔥 新建模式：原有逻辑
    console.log('🔍 [提交] 新建模式，创建记录');
    
    // 如果不是强制提交，先检查重复
    if (!forceSubmit) {
      const hasDuplicates = await checkForDuplicates(data);
      if (hasDuplicates) return;
    }
    
    // 🌟 CL-036: 日租金转月租金（×365÷12）
    const faceRentMonthly = faceRentUnit === 'daily' ? (data.face_rent ?? 0) * 365 / 12 : data.face_rent;
    const effectiveRentMonthly = effectiveRentUnit === 'daily' ? (data.effective_rent ?? 0) * 365 / 12 : data.effective_rent;

    // 子行业"其他"自定义处理
    const finalSubIndustry = isCustomSubIndustry && customSubIndustryText.trim()
      ? customSubIndustryText.trim()
      : (data.sub_industry?.trim() || null);

    // 非搬迁需求时，清空原址字段，避免脏数据
    const isRelocation = data.demand_type === '搬迁';

    const submitData: LeaseTransaction = {
      company: data.company?.trim() || '',
      suspected_company_fullname: data.suspected_company_fullname?.trim() || null,
      enterprise_type: data.enterprise_type || null,
      industry: data.industry?.trim() || null,
      sub_industry: finalSubIndustry,
      demand_type: data.demand_type || null,
      relocation_area_change: isRelocation ? (data.relocation_area_change || null) : null,
      new_building: data.new_building?.trim() || '',
      floor_info: data.floor_info?.trim() || null,
      floor: data.floor?.trim() || null,
      sub_market: data.sub_market?.trim() || null,
      district: data.district?.trim() || null,
      building_grade: data.building_grade || null,
      old_address: isRelocation ? (data.old_address?.trim() || null) : null,
      old_sub_market: isRelocation ? (data.old_sub_market?.trim() || null) : null,
      old_district: isRelocation ? (data.old_district?.trim() || null) : null,
      old_building_grade: isRelocation ? (data.old_building_grade || null) : null,
      area_sqm: data.area_sqm ?? null,
      face_rent: faceRentMonthly ?? null,
      is_face_rent_estimated: data.is_face_rent_estimated === true,
      lease_term_months: data.lease_term_months ?? null,
      fit_out_months: data.fit_out_months ?? null,
      rent_free_months: data.rent_free_months ?? null,
      effective_rent: effectiveRentMonthly ?? null,
      is_effective_rent_estimated: data.is_effective_rent_estimated === true,
      transaction_date: null, // 🔥 设为 null
      transaction_year: data.transaction_year,
      transaction_quarter: data.transaction_quarter, // 🔥 使用拼接后的季度
      remarks: data.remarks?.trim() || null,
      is_manual_building: data.is_manual_building,
      is_manual_old_building: data.is_manual_old_building,
      submitter_id: isOnBehalf && behalfUserId ? behalfUserId : userId,
      submitter_name: isOnBehalf && behalfUserId ? (brokers.find(b => b.user_id === behalfUserId)?.name || userName) : userName,
    };
    
    try {
      const result = await submitTransaction(submitData);
      
      if (result.success) {
        setToast({ message: '提交成功！', type: 'success' });
        logAction(userId, 'SUBMIT_LEASE_TRANSACTION', {
          mode: 'create', company: data.company, building: data.new_building,
          area: data.area_sqm, district: data.district, quarter: data.transaction_quarter,
        });
        onSubmitSuccess();
        onClose();
      } else {
        setToast({ message: result.error || '提交失败，请重试', type: 'error' });
      }
    } catch (e) {
      console.error('Failed to submit transaction', e);
      setToast({ message: '提交失败，请重试', type: 'error' });
    }
  };

  // 确认强制提交
  const handleForceSubmit = () => {
    setShowDuplicateModal(false);
    setForceSubmit(true);
    // 立即重新提交
    const data = getValues();
    submitTimerRef.current = setTimeout(() => {
      submitTimerRef.current = null;
      onSubmit(data);
    }, 100);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 抽屉背景 */}
      <div
        className="fixed inset-0 z-[90] bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* 抽屉主体 */}
      <div className="fixed inset-y-0 right-0 z-[95] flex w-full max-w-4xl flex-col border-l border-zinc-200 bg-white shadow-2xl">
        {/* 头部 */}
        <div className="shrink-0 border-b border-zinc-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="h-9 w-1 shrink-0 rounded-full bg-[#003e7e]" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 sm:text-lg">
                  <FileText size={18} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                  {mode === 'edit' ? '编辑租赁成交记录' : '新增租赁成交记录'}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {mode === 'edit' ? '修改现有成交记录信息' : '核心信息必填，补充细节可选'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="关闭填报表单"
              className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
        
        {/* 表单内容 */}
        <form onSubmit={handleSubmit(onSubmit, (errors) => {
          const firstErrorEntry = Object.entries(errors)[0];
          const firstError = firstErrorEntry?.[1];
          const firstErrorField = firstErrorEntry?.[0];
          if (firstErrorField) {
            window.requestAnimationFrame(() => {
              document.getElementById(firstErrorField)?.focus();
            });
          }
          setToast({ message: firstError?.message || '请检查必填项后再提交', type: 'error' });
        })} className="flex-1 overflow-y-auto overscroll-contain bg-zinc-50/80" autoComplete="off">
          <div className="space-y-4 px-4 py-5 sm:space-y-5 sm:px-6 sm:py-6">
            {/* 代他人填报（仅新增模式） */}
            {mode === 'create' && (
              <section className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-4 shadow-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOnBehalf}
                    onChange={e => {
                      setIsOnBehalf(e.target.checked);
                      if (!e.target.checked) setBehalfUserId('');
                    }}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-zinc-800">代他人填报</span>
                    <span className="ml-2 text-xs text-zinc-500">选择此选项后，记录将归属到被代报人名下</span>
                  </div>
                </label>
                {isOnBehalf && (
                  <div className="mt-3 ml-7">
                    <label className="mb-1 block text-xs font-medium text-zinc-500">选择被代报人</label>
                    <SearchableSelect
                      value={behalfUserId}
                      onChange={setBehalfUserId}
                      options={brokers.map(b => ({ value: b.user_id, label: b.name }))}
                      placeholder="请选择…"
                      className="max-w-xs"
                    />
                  </div>
                )}
              </section>
            )}

            {/* ========== 板块一：企业信息 ========== */}
            <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
                <Building2 size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">企业信息</h3>
              </div>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="sm:col-span-2 xl:col-span-2">
                  <FormField
                    name="company"
                    label="企业名称"
                    type="text"
                    placeholder="请输入企业名称"
                    register={register}
                    error={errors.company}
                    required={true}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    name="suspected_company_fullname"
                    label="疑似企业全称"
                    type="text"
                    placeholder="可选"
                    register={register}
                    error={errors.suspected_company_fullname}
                    required={false}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    name="enterprise_type"
                    label="企业类型"
                    type="select"
                    options={['', '央国企', '外企', '民企', '其他']}
                    register={register}
                    control={control}
                    error={errors.enterprise_type}
                    required={true}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    name="industry"
                    label="所属行业"
                    type="select"
                    options={['', ...industryOptions]}
                    register={register}
                    control={control}
                    error={errors.industry}
                    required={true}
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-700">
                    所属子行业 <span className="text-red-500">*</span>
                  </label>
                  <select
                    {...register('sub_industry')}
                    onChange={(e) => {
                      const val = e.target.value;
                      setValue('sub_industry', val);
                      setIsCustomSubIndustry(val === '其他');
                      if (val !== '其他') {
                        setCustomSubIndustryText('');
                      }
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-[#003e7e] transition"
                  >
                    <option value="">请选择…</option>
                    {subIndustryOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  {errors.sub_industry && (
                    <p className="mt-1 text-xs text-red-500">{errors.sub_industry.message}</p>
                  )}
                  {/* 子行业选"其他"时，显示自定义输入框 */}
                  {isCustomSubIndustry && (
                    <input
                      type="text"
                      value={customSubIndustryText}
                      onChange={(e) => setCustomSubIndustryText(e.target.value)}
                      placeholder='填写具体子行业（可留空）'
                      autoComplete="off"
                      className="mt-2 min-h-10 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/20"
                    />
                  )}
                </div>
              </div>
            </section>

            {/* ========== 板块二：需求类型 ========== */}
            <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
                <Info size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">需求类型</h3>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="col-span-1">
                    <FormField
                      name="demand_type"
                      label="需求类型"
                      type="select"
                      options={['', '新租', '扩租', '搬迁', '续租', '未知']}
                      register={register}
                      control={control}
                      error={errors.demand_type}
                      required={true}
                    />
                  </div>
                  
                  {/* 🔥 搬迁时显示面积变化选项 */}
                  {demandType === '搬迁' && (
                    <div className="col-span-1">
                      <FormField
                        name="relocation_area_change"
                        label="搬迁面积变化"
                        type="select"
                        options={['', '缩减面积', '扩大面积', '面积不变', '未知']}
                        register={register}
                        control={control}
                        error={errors.relocation_area_change}
                        required={true}
                      />
                    </div>
                  )}
                </div>

                {/* 🔥 新租特殊提示 */}
                {demandType === '新租' && (
                  <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-semibold mb-1">新租定义说明</p>
                      <p>该企业之前所在办公项目未出现在高力国际所监控的甲乙级写字楼和产业园项目。</p>
                    </div>
                  </div>
                )}

                {/* 📝 扩租与续租的代码注释说明 */}
                {/* 
                  注：扩租与续租复用相同逻辑，交易楼宇即为原址。
                  跨楼宇扩租应录入为新楼宇的新租。
                */}
              </div>
            </section>

            {/* ========== 板块三：交易楼宇信息 ========== */}
            <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                  <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">交易楼宇信息</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {/* 交易楼宇 - 搜索式下拉，优先 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    交易楼宇 <span className="text-red-500">*</span>
                  </label>
                  {isBuildingsLoading ? (
                    <div className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-400">
                      加载中…
                    </div>
                  ) : isManualBuilding ? (
                    /* 手动录入模式 */
                    <input
                      {...register('new_building')}
                      type="text"
                      placeholder="请输入楼宇名称"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                    />
                  ) : (
                    /* 搜索式下拉：从全部楼宇中搜索选择 */
                    <SearchableSelect
                      value={watch('new_building') ?? ''}
                      onChange={(val) => {
                        setValue('new_building', val);
                        handleBuildingSelect(val);
                      }}
                      options={allBuildingNames}
                      locked={selectedBuildingLocked}
                      onClear={handleBuildingClear}
                      placeholder="搜索楼宇名称…"
                    />
                  )}
                  {/* 手动录入切换按钮 */}
                  {!isManualBuilding ? (
                    <button
                      type="button"
                      onClick={handleManualBuildingToggle}
                      className="mt-1.5 text-xs text-[#003e7e] hover:text-[#0050a0] transition-colors"
                    >
                      未匹配到楼宇？手动录入 →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleBuildingClear}
                      className="mt-1.5 text-xs text-[#003e7e] hover:text-[#0050a0] transition-colors"
                    >
                      ← 返回列表选择
                    </button>
                  )}
                  {errors.new_building && (
                    <p className="mt-1 text-xs text-red-600">{errors.new_building.message}</p>
                  )}
                </div>

                {/* 子市场 - 自动回填或手动选择 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    子市场 <span className="text-red-500">*</span>
                  </label>
                  {selectedBuildingLocked ? (
                    <input
                      {...register('sub_market')}
                      type="text"
                      readOnly
                      placeholder="自动回填"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                    />
                  ) : isBuildingsLoading ? (
                    <div className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-400">
                      加载中…
                    </div>
                  ) : uniqueSubMarkets.length === 0 ? (
                    <input
                      {...register('sub_market')}
                      type="text"
                      placeholder="请输入子市场"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                    />
                  ) : (
                    <SearchableSelect
                      value={watch('sub_market') ?? ''}
                      onChange={(val) => setValue('sub_market', val)}
                      options={uniqueSubMarkets}
                      placeholder="请选择子市场"
                    />
                  )}
                  {errors.sub_market && (
                    <p className="mt-1 text-xs text-red-600">{errors.sub_market.message}</p>
                  )}
                </div>

                {/* 楼宇等级 - 自动回填或手动选择 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    楼宇等级 <span className="text-red-500">*</span>
                  </label>
                  {selectedBuildingLocked ? (
                    <input
                      {...register('building_grade')}
                      type="text"
                      readOnly
                      placeholder="自动回填"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                    />
                  ) : (
                    <SearchableSelect
                      value={watch('building_grade') ?? ''}
                      onChange={(val) => setValue('building_grade', val as any)}
                      options={['甲级', '乙级', '产业园', '其他']}
                      placeholder="请选择楼宇等级"
                    />
                  )}
                  {errors.building_grade && (
                    <p className="mt-1 text-xs text-red-600">{errors.building_grade.message}</p>
                  )}
                </div>

                {/* 区域 - 自动回填或手动输入 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    区域 <span className="text-red-500">*</span>
                  </label>
                  {selectedBuildingLocked ? (
                    <input
                      {...register('district')}
                      type="text"
                      readOnly
                      placeholder="自动回填"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                    />
                  ) : (
                    <input
                      {...register('district')}
                      type="text"
                      placeholder="如：朝阳区"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                    />
                  )}
                  {errors.district && (
                    <p className="mt-1 text-xs text-red-600">{errors.district.message}</p>
                  )}
                </div>

                {/* CL-020: 楼座 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    楼座 <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('floor_info')}
                    type="text"
                    disabled={isFloorInfoUnknown}
                    placeholder={isFloorInfoUnknown ? '未知' : '如：A座'}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e] disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFloorInfoUnknown}
                      onChange={(e) => {
                        setIsFloorInfoUnknown(e.target.checked);
                        if (e.target.checked) setValue('floor_info', '未知');
                        else setValue('floor_info', '');
                      }}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                    />
                    <span className="text-xs text-zinc-500">未知</span>
                  </label>
                </div>

                {/* CL-020: 楼层 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    楼层 <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('floor')}
                    type="text"
                    disabled={isFloorUnknown}
                    placeholder={isFloorUnknown ? '未知' : '如：15'}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e] disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFloorUnknown}
                      onChange={(e) => {
                        setIsFloorUnknown(e.target.checked);
                        if (e.target.checked) setValue('floor', '未知');
                        else setValue('floor', '');
                      }}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                    />
                    <span className="text-xs text-zinc-500">未知</span>
                  </label>
                </div>
              </div>
            </section>

            {/* ========== 板块四：原址信息（仅搬迁时显示）========== */}
            {demandType === '搬迁' && (
              <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
                  <Building2 size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                  <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">原址信息</h3>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {/* 原址楼宇 - 搜索式下拉，优先 */}
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      原址楼宇 <span className="text-red-500">*</span>
                    </label>
                    {isOldAddressUnknown ? (
                      <input
                        type="text"
                        value="未知"
                        disabled
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-100 text-zinc-400"
                      />
                    ) : isBuildingsLoading ? (
                      <div className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-400">
                        加载中…
                      </div>
                    ) : isManualOldBuilding ? (
                      <input
                        {...register('old_address')}
                        type="text"
                        placeholder="请输入原址楼宇名称"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                      />
                    ) : (
                      <SearchableSelect
                        value={watch('old_address') ?? ''}
                        onChange={(val) => {
                          setValue('old_address', val);
                          handleOldBuildingSelect(val);
                        }}
                        options={allBuildingNames}
                        locked={selectedOldBuildingLocked}
                        onClear={handleOldBuildingClear}
                        placeholder="搜索原址楼宇…"
                      />
                    )}
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOldAddressUnknown}
                        onChange={(e) => {
                          setIsOldAddressUnknown(e.target.checked);
                          if (e.target.checked) {
                            setValue('old_address', '未知');
                            const currentDistrict = getValues('old_district');
                            if (!currentDistrict) {
                              setValue('old_district', '未知');
                              setIsOldDistrictUnknown(true);
                            }
                          } else {
                            setValue('old_address', '');
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                      />
                      <span className="text-xs text-zinc-500">未知</span>
                    </label>
                    {!isOldAddressUnknown && !isManualOldBuilding && (
                      <button
                        type="button"
                        onClick={handleManualOldBuildingToggle}
                        className="mt-1.5 text-xs text-[#003e7e] hover:text-[#0050a0] transition-colors"
                      >
                        未匹配到楼宇？手动录入 →
                      </button>
                    )}
                    {!isOldAddressUnknown && isManualOldBuilding && (
                      <button
                        type="button"
                        onClick={handleOldBuildingClear}
                        className="mt-1.5 text-xs text-[#003e7e] hover:text-[#0050a0] transition-colors"
                      >
                        ← 返回列表选择
                      </button>
                    )}
                    {errors.old_address && (
                      <p className="mt-1 text-xs text-red-600">{errors.old_address.message}</p>
                    )}
                  </div>

                  {/* 原址子市场 - 自动回填或手动选择 */}
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      原址子市场 <span className="text-red-500">*</span>
                    </label>
                    {isOldSubMarketUnknown ? (
                      <input
                        type="text"
                        value="未知"
                        disabled
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-100 text-zinc-400"
                      />
                    ) : selectedOldBuildingLocked ? (
                      <input
                        {...register('old_sub_market')}
                        type="text"
                        readOnly
                        placeholder="自动回填"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                      />
                    ) : isBuildingsLoading ? (
                      <div className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-400">
                        加载中…
                      </div>
                    ) : uniqueSubMarkets.length === 0 ? (
                      <input
                        {...register('old_sub_market')}
                        type="text"
                        placeholder="请输入原址子市场"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                      />
                    ) : (
                      <SearchableSelect
                        value={watch('old_sub_market') ?? ''}
                        onChange={(val) => setValue('old_sub_market', val)}
                        options={uniqueSubMarkets}
                        placeholder="请选择原址子市场"
                      />
                    )}
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOldSubMarketUnknown}
                        onChange={(e) => {
                          setIsOldSubMarketUnknown(e.target.checked);
                          if (e.target.checked) setValue('old_sub_market', '未知');
                          else setValue('old_sub_market', '');
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                      />
                      <span className="text-xs text-zinc-500">未知</span>
                    </label>
                    {errors.old_sub_market && (
                      <p className="mt-1 text-xs text-red-600">{errors.old_sub_market.message}</p>
                    )}
                  </div>

                  {/* 原址楼宇等级 - 自动回填或手动选择 */}
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      原址楼宇等级 <span className="text-red-500">*</span>
                    </label>
                    {isOldBuildingGradeUnknown ? (
                      <input
                        type="text"
                        value="未知"
                        disabled
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-100 text-zinc-400"
                      />
                    ) : selectedOldBuildingLocked ? (
                      <input
                        {...register('old_building_grade')}
                        type="text"
                        readOnly
                        placeholder="自动回填"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                      />
                    ) : (
                      <SearchableSelect
                        value={watch('old_building_grade') ?? ''}
                        onChange={(val) => setValue('old_building_grade', val as any)}
                        options={['甲级', '乙级', '产业园', '其他']}
                        placeholder="请选择原址楼宇等级"
                      />
                    )}
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOldBuildingGradeUnknown}
                        onChange={(e) => {
                          setIsOldBuildingGradeUnknown(e.target.checked);
                          if (e.target.checked) setValue('old_building_grade', '未知' as any);
                          else setValue('old_building_grade', null);
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                      />
                      <span className="text-xs text-zinc-500">未知</span>
                    </label>
                    {errors.old_building_grade && (
                      <p className="mt-1 text-xs text-red-600">{errors.old_building_grade.message}</p>
                    )}
                  </div>

                  {/* 原址区域 - 自动回填或手动输入 */}
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      原址区域 <span className="text-red-500">*</span>
                    </label>
                    {isOldDistrictUnknown ? (
                      <input
                        type="text"
                        value="未知"
                        disabled
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-100 text-zinc-400"
                      />
                    ) : selectedOldBuildingLocked ? (
                      <input
                        {...register('old_district')}
                        type="text"
                        readOnly
                        placeholder="自动回填"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-zinc-50 text-zinc-700 cursor-not-allowed"
                      />
                    ) : (
                      <input
                        {...register('old_district')}
                        type="text"
                        placeholder="如：朝阳区"
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]"
                      />
                    )}
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOldDistrictUnknown}
                        onChange={(e) => {
                          setIsOldDistrictUnknown(e.target.checked);
                          if (e.target.checked) setValue('old_district', '未知');
                          else setValue('old_district', '');
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-[#003e7e]"
                      />
                      <span className="text-xs text-zinc-500">未知</span>
                    </label>
                    {errors.old_district && (
                      <p className="mt-1 text-xs text-red-600">{errors.old_district.message}</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ========== 板块五：成交核心数据 ========== */}
            <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
                <FileText size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">成交核心数据</h3>
                <span className="ml-auto rounded-md bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">租金不含物业费</span>
              </div>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="col-span-1">
                  <FormField
                    name="area_sqm"
                    label="租赁面积 (㎡)"
                    type="number"
                    placeholder="如：500"
                    register={register}
                    error={errors.area_sqm}
                    required={true}
                  />
                </div>
                
                {/* 🌟 CL-036: 表面租金 + 单位切换 + 预估复选框 */}
                <div className="col-span-1">
                  <div className="flex items-end justify-between gap-2">
                    <div className="flex-1">
                      <FormField
                        name="face_rent"
                        label={`表面租金 (元/㎡/${faceRentUnit === 'daily' ? '天' : '月'})`}
                        type="number"
                        placeholder={faceRentUnit === 'daily' ? '如：5' : '如：150'}
                        register={register}
                        error={errors.face_rent}
                        required={true}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setFaceRentUnit(u => u === 'daily' ? 'monthly' : 'daily')}
                      className="mb-[1px] shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-[7px] text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                      title="点击切换日租金/月租金"
                    >
                      {faceRentUnit === 'daily' ? '日租金' : '月租金'} ⇄
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_face_rent_estimated"
                      {...register('is_face_rent_estimated')}
                      className="h-4 w-4 rounded border-zinc-300 text-[#003e7e] focus:ring-[#003e7e] cursor-pointer"
                    />
                    <label
                      htmlFor="is_face_rent_estimated"
                      className="text-sm text-zinc-600 cursor-pointer select-none"
                    >
                      是否为预估
                    </label>
                  </div>
                </div>

                {/* 🌟 CL-036: 有效租金 + 单位切换 + 预估复选框 */}
                <div className="col-span-1">
                  <div className="flex items-end justify-between gap-2">
                    <div className="flex-1">
                      <FormField
                        name="effective_rent"
                        label={`有效租金 (元/㎡/${effectiveRentUnit === 'daily' ? '天' : '月'})`}
                        type="number"
                        placeholder={effectiveRentUnit === 'daily' ? '如：4.5' : '如：135'}
                        register={register}
                        error={errors.effective_rent}
                        required={true}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setEffectiveRentUnit(u => u === 'daily' ? 'monthly' : 'daily')}
                      className="mb-[1px] shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-[7px] text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                      title="点击切换日租金/月租金"
                    >
                      {effectiveRentUnit === 'daily' ? '日租金' : '月租金'} ⇄
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_effective_rent_estimated"
                      {...register('is_effective_rent_estimated')}
                      className="h-4 w-4 rounded border-zinc-300 text-[#003e7e] focus:ring-[#003e7e] cursor-pointer"
                    />
                    <label
                      htmlFor="is_effective_rent_estimated"
                      className="text-sm text-zinc-600 cursor-pointer select-none"
                    >
                      是否为预估
                    </label>
                  </div>
                </div>

                <div className="col-span-1">
                  <FormField
                    name="lease_term_months"
                    label="租期 (月)"
                    type="number"
                    placeholder="如：36"
                    register={register}
                    error={errors.lease_term_months}
                    required={false}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    name="fit_out_months"
                    label="装修期 (月)"
                    type="number"
                    placeholder="如：2"
                    register={register}
                    error={errors.fit_out_months}
                    required={false}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    name="rent_free_months"
                    label="免租期 (月)"
                    type="number"
                    placeholder="如：1"
                    register={register}
                    error={errors.rent_free_months}
                    required={false}
                  />
                </div>
              </div>
            </section>

            {/* ========== 板块六：时间与备注 ========== */}
            <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
                <Calendar size={17} className="shrink-0 text-[#003e7e]" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">时间与备注</h3>
              </div>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {/* 🔥 年份下拉 - 动态可选范围 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    成交年份 <span className="text-red-500">*</span>
                  </label>
                  <SearchableSelect
                    value={String(watch('transaction_year') ?? '')}
                    onChange={(val) => setValue('transaction_year', Number(val))}
                    options={availableYears.map(y => ({ value: String(y), label: String(y) }))}
                    placeholder="请选择年份"
                  />
                  {errors.transaction_year && (
                    <p className="mt-1 text-xs text-red-600">{errors.transaction_year.message}</p>
                  )}
                </div>
                
                {/* 🔥 季度下拉 - 根据年份动态变化 */}
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    成交季度 <span className="text-red-500">*</span>
                  </label>
                  <SearchableSelect
                    value={watch('transaction_quarter') ?? ''}
                    onChange={(val) => setValue('transaction_quarter', val)}
                    options={availableQuarters}
                    placeholder="请选择季度"
                    disabled={!selectedYear || availableQuarters.length === 0}
                  />
                  {errors.transaction_quarter && (
                    <p className="mt-1 text-xs text-red-600">{errors.transaction_quarter.message}</p>
                  )}
                </div>
                
                {/* 🔥 时间备注 */}
                <div className="col-span-1 flex items-end pb-2">
                  <p className="text-xs text-gray-400">
                    尽量填写最新季度成交，时间最长可填写半年内的成交
                  </p>
                </div>
                
                <div className="sm:col-span-2 xl:col-span-3">
                  <FormField
                    name="remarks"
                    label="备注"
                    type="textarea"
                    placeholder="如：成交代理行，业主重要租赁策略变化、企业客户相关重要情况等"
                    register={register}
                    error={errors.remarks}
                    required={false}
                  />
                </div>
              </div>
            </section>
          </div>

          {/* 底部按钮 */}
          <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-3 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)] backdrop-blur sm:px-6 sm:py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isCheckingDuplicate}
              className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isCheckingDuplicate}
              className="flex items-center gap-2 rounded-lg bg-[#003e7e] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#002b5e] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(isSubmitting || isCheckingDuplicate) && (
                <Loader2 size={16} className="animate-spin" />
              )}
              {isCheckingDuplicate ? '检查重复中…' : isSubmitting ? '提交中…' : '提交'}
            </button>
          </div>
        </form>
      </div>
      
      {/* 重复警告模态框 */}
      <DuplicateWarningModal
        isOpen={showDuplicateModal}
        duplicates={duplicates}
        onConfirm={handleForceSubmit}
        onCancel={() => setShowDuplicateModal(false)}
      />
      
      {/* Toast 提示 */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}
