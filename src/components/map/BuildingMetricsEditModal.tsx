'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { getSession } from '@/src/services/Auth';
import { AuditService } from '@/src/services/auditService';

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface BuildingMetric {
  id: string;
  building_id: string;
  record_year: number;
  record_quarter: number;
  asking_rent: number | null;
  management_fee: number | null;
  face_rent: number | null;
  rent_free_period: number | null;
  net_effective_rent: number | null;
  vacancy_rate: number | null;
  vacant_area: number | null;
  total_area: number | null;
  updated_at: string;
}

interface BuildingInfo {
  id: string;
  name: string;
  total_area: number | null;
}

interface BuildingMetricsEditModalProps {
  buildingId: string;
  buildingName: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
}

interface MetricFormData {
  asking_rent: string;
  management_fee: string;
  face_rent: string;
  rent_free_period: string;
  vacant_area: string;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 安全解析数值 */
const parseNumericInput = (value: string): number | null => {
  if (value === '' || value === '-' || value === '.') {
    return null;
  }
  const cleaned = value.replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) || !isFinite(num) ? null : num;
};

/** 格式化数值显示 */
const formatNumericDisplay = (value: number | null): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

/** 安全除法 */
const safeDivide = (numerator: number, denominator: number): number => {
  if (!denominator || denominator === 0) return 0;
  return numerator / denominator;
};

/** 计算净有效租金 */
const calculateNetRent = (faceRent: number | null, rentFreePeriod: number | null): number | null => {
  if (!faceRent || faceRent <= 0) return null;
  if (rentFreePeriod === null || rentFreePeriod < 0) return null;
  if (rentFreePeriod >= 36) return null;
  return Math.round(faceRent * (36 - rentFreePeriod) / 36 * 100) / 100;
};

/** 计算空置率 */
const calculateVacancyRate = (vacantArea: number | null, totalArea: number | null): number | null => {
  if (vacantArea === null || totalArea === null || totalArea <= 0) return null;
  return Math.round(safeDivide(vacantArea, totalArea) * 10000) / 100;
};

// ─── 确认对话框组件 ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
        <p className="mt-3 text-sm text-zinc-600 leading-relaxed">{message}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-[#003e7e] rounded-lg hover:bg-[#002d5e] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function BuildingMetricsEditModal({
  buildingId,
  buildingName,
  isOpen,
  onClose,
  onSave,
}: BuildingMetricsEditModalProps) {
  // 状态
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [quarter, setQuarter] = React.useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [formData, setFormData] = React.useState<MetricFormData>({
    asking_rent: '',
    management_fee: '',
    face_rent: '',
    rent_free_period: '',
    vacant_area: '',
  });
  const [originalData, setOriginalData] = React.useState<MetricFormData>({
    asking_rent: '',
    management_fee: '',
    face_rent: '',
    rent_free_period: '',
    vacant_area: '',
  });
  const [metricId, setMetricId] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  const [buildingInfo, setBuildingInfo] = React.useState<BuildingInfo | null>(null);

  // UI 状态
  const [isLoadingData, setIsLoadingData] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  // 计算属性
  const isDirty = React.useMemo(() => {
    return Object.keys(formData).some(key => {
      return formData[key as keyof MetricFormData] !== originalData[key as keyof MetricFormData];
    });
  }, [formData, originalData]);

  const isFormDisabled = isLoadingData || saving;

  // 计算字段
  const calculatedNetRent = React.useMemo(() => {
    return calculateNetRent(
      parseNumericInput(formData.face_rent),
      parseNumericInput(formData.rent_free_period)
    );
  }, [formData.face_rent, formData.rent_free_period]);

  const calculatedVacancyRate = React.useMemo(() => {
    return calculateVacancyRate(
      parseNumericInput(formData.vacant_area),
      buildingInfo?.total_area
    );
  }, [formData.vacant_area, buildingInfo?.total_area]);

  // ─── 数据加载 ─────────────────────────────────────────────────────────────

  // 加载楼宇信息
  React.useEffect(() => {
    if (!isOpen || !buildingId) return;

    const loadBuildingInfo = async () => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name, total_area')
        .eq('id', buildingId)
        .single();

      if (!error && data) {
        setBuildingInfo(data);
      }
    };

    loadBuildingInfo();
  }, [isOpen, buildingId]);

  // 加载指标数据
  React.useEffect(() => {
    if (!isOpen || !buildingId) return;

    let cancelled = false;
    setIsLoadingData(true);
    setSaveError(null);
    setValidationErrors([]);

    const loadMetricData = async () => {
      try {
        const { data, error } = await supabase
          .from('building_metrics')
          .select('*')
          .eq('building_id', buildingId)
          .eq('record_year', year)
          .eq('record_quarter', quarter)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (cancelled) return;

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows returned
          throw error;
        }

        if (data) {
          const loadedData: MetricFormData = {
            asking_rent: formatNumericDisplay(data.asking_rent),
            management_fee: formatNumericDisplay(data.management_fee),
            face_rent: formatNumericDisplay(data.face_rent),
            rent_free_period: formatNumericDisplay(data.rent_free_period),
            vacant_area: formatNumericDisplay(data.vacant_area),
          };
          setMetricId(data.id);
          setUpdatedAt(data.updated_at);
          setFormData(loadedData);
          setOriginalData(loadedData);
        } else {
          // 无数据，新增模式
          setMetricId(null);
          setUpdatedAt(null);
          const emptyData: MetricFormData = {
            asking_rent: '',
            management_fee: '',
            face_rent: '',
            rent_free_period: '',
            vacant_area: '',
          };
          setFormData(emptyData);
          setOriginalData(emptyData);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSaveError(`加载数据失败：${err.message}`);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingData(false);
        }
      }
    };

    loadMetricData();

    return () => { cancelled = true; };
  }, [isOpen, buildingId, year, quarter]);

  // ─── 表单处理 ─────────────────────────────────────────────────────────────

  const handleInputChange = React.useCallback((field: keyof MetricFormData, value: string) => {
    // 只允许数字、小数点、负号
    if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) {
      return;
    }

    setFormData(prev => ({ ...prev, [field]: value }));
    setValidationErrors([]);
  }, []);

  const handleYearChange = React.useCallback((newYear: number) => {
    if (isDirty) {
      setShowUnsavedWarning(true);
      return;
    }
    setYear(newYear);
  }, [isDirty]);

  const handleQuarterChange = React.useCallback((newQuarter: number) => {
    if (isDirty) {
      setShowUnsavedWarning(true);
      return;
    }
    setQuarter(newQuarter);
  }, [isDirty]);

  // ─── 验证 ─────────────────────────────────────────────────────────────────

  const validateBeforeSave = React.useCallback((): string[] => {
    const errors: string[] = [];

    // 检查至少填写了一个字段
    const hasAnyValue = Object.values(formData).some(v => v !== '');
    if (!hasAnyValue) {
      errors.push('请至少填写一个字段');
      return errors;
    }

    // 验证数值范围
    const askingRent = parseNumericInput(formData.asking_rent);
    if (askingRent !== null && askingRent < 0) {
      errors.push('报价租金不能为负数');
    }
    if (askingRent !== null && askingRent > 10000) {
      errors.push('报价租金数值过大');
    }

    const managementFee = parseNumericInput(formData.management_fee);
    if (managementFee !== null && managementFee < 0) {
      errors.push('物业费不能为负数');
    }
    if (managementFee !== null && managementFee > 1000) {
      errors.push('物业费数值过大');
    }

    const faceRent = parseNumericInput(formData.face_rent);
    if (faceRent !== null && faceRent < 0) {
      errors.push('表面租金不能为负数');
    }
    if (faceRent !== null && faceRent > 10000) {
      errors.push('表面租金数值过大');
    }

    const rentFreePeriod = parseNumericInput(formData.rent_free_period);
    if (rentFreePeriod !== null && rentFreePeriod < 0) {
      errors.push('免租期不能为负数');
    }
    if (rentFreePeriod !== null && rentFreePeriod >= 36) {
      errors.push('免租期不能超过 36 个月');
    }

    const vacantArea = parseNumericInput(formData.vacant_area);
    if (vacantArea !== null && vacantArea < 0) {
      errors.push('空置面积不能为负数');
    }
    if (vacantArea !== null && buildingInfo?.total_area && vacantArea > buildingInfo.total_area) {
      errors.push('空置面积不能超过总面积');
    }

    return errors;
  }, [formData, buildingInfo]);

  // ─── 保存 ─────────────────────────────────────────────────────────────────

  const handleSaveClick = React.useCallback(() => {
    const errors = validateBeforeSave();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setShowConfirm(true);
  }, [validateBeforeSave]);

  const handleConfirmSave = React.useCallback(async () => {
    if (saving) return;

    setSaving(true);
    setSaveError(null);

    try {
      const payload = {
        asking_rent: parseNumericInput(formData.asking_rent),
        management_fee: parseNumericInput(formData.management_fee),
        face_rent: parseNumericInput(formData.face_rent),
        rent_free_period: parseNumericInput(formData.rent_free_period),
        net_effective_rent: calculatedNetRent,
        vacancy_rate: calculatedVacancyRate,
        vacant_area: parseNumericInput(formData.vacant_area),
        updated_at: new Date().toISOString(),
      };

      if (metricId) {
        // 更新模式：检查乐观锁
        const { data: current, error: fetchError } = await supabase
          .from('building_metrics')
          .select('updated_at')
          .eq('id', metricId)
          .single();

        if (fetchError) throw fetchError;

        if (current.updated_at !== updatedAt) {
          setSaveError('数据已被他人修改，请关闭弹窗后重试');
          setShowConfirm(false);
          return;
        }

        // 执行更新
        const { error: updateError } = await supabase
          .from('building_metrics')
          .update(payload)
          .eq('id', metricId);

        if (updateError) throw updateError;

        // 记录审计日志
        AuditService.metricsUpdate(buildingId, buildingName, {
          record_year: year,
          record_quarter: quarter,
          ...Object.fromEntries(
            Object.entries(payload)
              .filter(([key]) => key !== 'updated_at')
              .map(([key, value]) => [key, { to: value }])
          ),
        });
      } else {
        // 新增模式
        const { error: insertError } = await supabase
          .from('building_metrics')
          .insert({
            building_id: buildingId,
            record_year: year,
            record_quarter: quarter,
            ...payload,
          });

        if (insertError) throw insertError;

        // 记录审计日志
        AuditService.metricsInsert(buildingId, buildingName, year, quarter);
      }

      // 保存成功
      setShowConfirm(false);
      await onSave();
      onClose();

    } catch (err: any) {
      setSaveError(`保存失败：${err.message}`);
      setShowConfirm(false);
    } finally {
      setSaving(false);
    }
  }, [formData, calculatedNetRent, calculatedVacancyRate, metricId, updatedAt, buildingId, buildingName, year, quarter, onSave, onClose, saving]);

  // ─── 关闭处理 ─────────────────────────────────────────────────────────────

  const handleClose = React.useCallback(() => {
    if (isDirty) {
      setShowUnsavedWarning(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const confirmClose = React.useCallback(() => {
    setShowUnsavedWarning(false);
    onClose();
  }, [onClose]);

  // ─── 键盘快捷键 ───────────────────────────────────────────────────────────

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC 关闭
      if (e.key === 'Escape') {
        if (showConfirm) {
          setShowConfirm(false);
        } else if (showUnsavedWarning) {
          setShowUnsavedWarning(false);
        } else {
          handleClose();
        }
      }

      // Ctrl+S 保存
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!saving && !isFormDisabled && !showConfirm && !showUnsavedWarning) {
          handleSaveClick();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showConfirm, showUnsavedWarning, saving, isFormDisabled, handleClose, handleSaveClick]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  const quarters = [1, 2, 3, 4];

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="shrink-0 px-6 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">编辑指标数据</h2>
              <p className="mt-1 text-sm text-zinc-500">{buildingName}</p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 年份/季度选择器 */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-zinc-700">年份</label>
              <select
                value={year}
                onChange={(e) => handleYearChange(Number(e.target.value))}
                disabled={isFormDisabled}
                className="px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-zinc-700">季度</label>
              <select
                value={quarter}
                onChange={(e) => handleQuarterChange(Number(e.target.value))}
                disabled={isFormDisabled}
                className="px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50"
              >
                {quarters.map(q => (
                  <option key={q} value={q}>Q{q}</option>
                ))}
              </select>
            </div>
            {metricId && (
              <span className="text-xs text-zinc-400 ml-auto">
                编辑模式
              </span>
            )}
            {!metricId && !isLoadingData && (
              <span className="text-xs text-blue-500 ml-auto">
                新增模式
              </span>
            )}
          </div>

          {/* 加载状态 */}
          {isLoadingData && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
                <p className="text-sm text-zinc-500">加载数据中...</p>
              </div>
            </div>
          )}

          {/* 表单 */}
          {!isLoadingData && (
            <div className="space-y-4">
              {/* 只读信息 */}
              {buildingInfo?.total_area && (
                <div className="px-4 py-3 bg-zinc-50 rounded-lg">
                  <span className="text-xs text-zinc-500">总面积：</span>
                  <span className="text-sm font-semibold text-zinc-800 ml-2">
                    {buildingInfo.total_area.toLocaleString()} m²
                  </span>
                </div>
              )}

              {/* 可编辑字段 */}
              <div className="grid grid-cols-2 gap-4">
                {/* 报价租金 */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    报价租金
                  </label>
                  <input
                    type="text"
                    value={formData.asking_rent}
                    onChange={(e) => handleInputChange('asking_rent', e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="元/m²/天"
                    className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50 disabled:bg-zinc-50"
                  />
                </div>

                {/* 物业费 */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    物业费
                  </label>
                  <input
                    type="text"
                    value={formData.management_fee}
                    onChange={(e) => handleInputChange('management_fee', e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="元/m²/月"
                    className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50 disabled:bg-zinc-50"
                  />
                </div>

                {/* 表面租金 */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    表面租金
                  </label>
                  <input
                    type="text"
                    value={formData.face_rent}
                    onChange={(e) => handleInputChange('face_rent', e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="元/m²/天"
                    className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50 disabled:bg-zinc-50"
                  />
                </div>

                {/* 免租期 */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    免租期（月）
                  </label>
                  <input
                    type="text"
                    value={formData.rent_free_period}
                    onChange={(e) => handleInputChange('rent_free_period', e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="0-36"
                    className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50 disabled:bg-zinc-50"
                  />
                </div>

                {/* 空置面积 */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    空置面积
                  </label>
                  <input
                    type="text"
                    value={formData.vacant_area}
                    onChange={(e) => handleInputChange('vacant_area', e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="m²"
                    className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all disabled:opacity-50 disabled:bg-zinc-50"
                  />
                </div>
              </div>

              {/* 计算字段（只读） */}
              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-200">
                <div>
                  <label className="block text-sm font-medium text-zinc-500 mb-1.5">
                    净有效租金（自动计算）
                  </label>
                  <div className="px-3 py-2.5 text-sm border border-zinc-100 rounded-lg bg-zinc-50 text-zinc-800 font-semibold">
                    {calculatedNetRent !== null ? `¥${calculatedNetRent.toFixed(2)}` : '-'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-500 mb-1.5">
                    空置率（自动计算）
                  </label>
                  <div className="px-3 py-2.5 text-sm border border-zinc-100 rounded-lg bg-zinc-50 text-zinc-800 font-semibold">
                    {calculatedVacancyRate !== null ? `${calculatedVacancyRate.toFixed(1)}%` : '-'}
                  </div>
                </div>
              </div>

              {/* 验证错误 */}
              {validationErrors.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <ul className="text-sm text-red-600 space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 保存错误 */}
              {saveError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {saveError}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="shrink-0 px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {isDirty && '• 已修改未保存'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSaveClick}
              disabled={saving || isFormDisabled || !isDirty}
              className="px-4 py-2.5 text-sm font-medium text-white bg-[#003e7e] rounded-lg hover:bg-[#002d5e] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  保存中...
                </>
              ) : (
                '保存'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={showConfirm}
        title="确认修改"
        message={`确认修改 ${buildingName} 的指标数据？此操作将覆盖当前数据。`}
        confirmLabel="确认保存"
        cancelLabel="返回编辑"
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirm(false)}
        isLoading={saving}
      />

      {/* 未保存提醒 */}
      <ConfirmDialog
        isOpen={showUnsavedWarning}
        title="未保存的更改"
        message="您有未保存的更改，确定要离开吗？所有更改将丢失。"
        confirmLabel="放弃更改"
        cancelLabel="继续编辑"
        onConfirm={confirmClose}
        onCancel={() => setShowUnsavedWarning(false)}
      />
    </div>,
    document.body
  );
}

export default BuildingMetricsEditModal;
