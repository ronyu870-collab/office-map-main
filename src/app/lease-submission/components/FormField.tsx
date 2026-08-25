'use client';

import * as React from 'react';
import { Controller, type FieldError, type UseFormRegister } from 'react-hook-form';

import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import type { LeaseTransactionFormData } from '../schemas/leaseTransactionSchema';

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

export function FormField({ name, label, type, placeholder, options, register, control, error, required = false, disabled = false }: FormFieldProps) {
  const inputClass = `min-h-9 w-full rounded-md border px-2.5 py-2 text-xs outline-none transition-[border-color,box-shadow,background-color] focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 ${error ? 'border-rose-400 bg-rose-50/40 text-rose-900 placeholder:text-rose-300' : 'border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400'}`;
  const registered = type === 'number' ? register(name, { valueAsNumber: true }) : register(name);

  return (
    <div>
      <label htmlFor={name} className={`mb-1 block text-[11px] font-medium ${error ? 'text-rose-700' : 'text-zinc-600'}`}>
        {label}{required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      {type === 'select' && control && (
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <SearchableSelect
              id={name}
              value={(field.value as string) ?? ''}
              onChange={field.onChange}
              options={options?.filter(Boolean) ?? []}
              placeholder="请选择"
              disabled={disabled}
            />
          )}
        />
      )}
      {type === 'textarea' && <textarea id={name} {...registered} placeholder={placeholder} rows={2} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} className={`${inputClass} resize-y`} disabled={disabled} />}
      {type === 'date' && <input id={name} type="date" {...registered} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} className={inputClass} disabled={disabled} />}
      {(type === 'text' || type === 'number') && <input id={name} type={type} {...registered} placeholder={placeholder} step={type === 'number' ? 'any' : undefined} inputMode={type === 'number' ? 'decimal' : undefined} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} className={inputClass} disabled={disabled} />}
      {error && <p id={`${name}-error`} role="alert" className="mt-1 text-[10px] leading-4 text-rose-600">{error.message}</p>}
    </div>
  );
}
