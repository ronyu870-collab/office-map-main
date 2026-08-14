'use client'
import React from 'react'

interface ImportErrorsModalProps {
  errors: string[]
  onClose: () => void
}

export function ImportErrorsModal({ errors, onClose }: ImportErrorsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="max-w-lg w-full mx-4 bg-white rounded-lg shadow-xl">
        <div className="px-6 py-4 border-b border-zinc-200">
          <h3 className="text-base font-semibold text-red-700">导入错误</h3>
        </div>
        <div className="max-h-60 overflow-auto p-6">
          <ul className="space-y-1.5 text-sm text-red-600">
            {errors.map((err, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">-</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
          <button onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-xs text-white hover:bg-zinc-700">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
