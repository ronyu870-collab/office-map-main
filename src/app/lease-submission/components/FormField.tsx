'use client';

import * as React from 'react';
import { UseFormRegister, FieldError, Controller } from 'react-hook-form';
import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import type { LeaseTransactionFormData } from '../schemas/leaseTransactionSchema';

/**
 * 高力国际品牌级表单控件
 * 
 * 设计规范：
 * - 主色调：#003e7e (深海军蓝)
 * - 边框：极浅锌灰 (border-zinc-200)
 * - Focus：微妙 ring 阴影
 * - 错误：柔和红色 (border-red-400)
 */

interface FormFieldProps {
  name: keyof LeaseTransactionFormData;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea';
  placeholder?: string;
  options?: string[];
  register: UseFormRegister<LeaseTransactionFormData>;
  control?: any;
  error?: FieldError;
  required?: boolean;
  disabled?: boolean;
}

export function FormField({
  name,
  label,
  type,
  placeholder,
  options,
  register,
  control,
  error,
  required = false,
  disabled = false,
}: FormFieldProps) {
  const baseInputClass = `
    min-h-10 w-full rounded-lg border px-3 py-2.5 text-sm
    transition-[border-color,box-shadow,background-color] duration-200
    focus:outline-none focus:ring-2 focus:ring-[#003e7e]/20 focus:border-[#003e7e]
    disabled:bg-zinc-50 disabled:text-zinc-400 disabled:cursor-not-allowed
    ${
      error
        ? 'border-red-400 bg-red-50/30 text-red-900 placeholder:text-red-300'
        : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300'
    }
  `.trim();

  const labelClass = `
    block text-[13px] font-medium text-zinc-700 mb-1.5
    ${error ? 'text-red-600' : ''}
  `.trim();

  // 注册配置
  const registerConfig = type === 'number' 
    ? { ...register(name, { valueAsNumber: true }) }
    : register(name);

  return (
    <div className="space-y-1">
      <label htmlFor={name} className={labelClass}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {type === 'select' && control && (
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <SearchableSelect
              id={name}
              value={field.value as string ?? ''}
              onChange={field.onChange}
              options={options?.filter(o => o !== '') ?? []}
              placeholder="请选择"
              disabled={disabled}
            />
          )}
        />
      )}

      {type === 'textarea' && (
        <textarea
          id={name}
          {...registerConfig}
          placeholder={placeholder}
          rows={3}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          className={baseInputClass}
          disabled={disabled}
        />
      )}

      {type === 'date' && (
        <input
          id={name}
          type="date"
          {...registerConfig}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          className={baseInputClass}
          disabled={disabled}
        />
      )}

      {(type === 'text' || type === 'number') && (
        <input
          id={name}
          type={type}
          {...registerConfig}
          placeholder={placeholder}
          step={type === 'number' ? 'any' : undefined}
          inputMode={type === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          className={baseInputClass}
          disabled={disabled}
        />
      )}

      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 flex items-start gap-1 text-xs text-red-600">
          <span className="inline-block mt-0.5">⚠</span>
          <span>{error.message}</span>
        </p>
      )}
    </div>
  );
}
