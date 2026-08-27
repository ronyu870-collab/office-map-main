'use client'
import React from 'react'
import { Button, Dialog } from '@/src/components/ui'

interface ImportErrorsModalProps {
  errors: string[]
  onClose: () => void
}

export function ImportErrorsModal({ errors, onClose }: ImportErrorsModalProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title={<span className="text-[var(--cd-color-danger)]">导入错误</span>} size="md" footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
        <div className="max-h-60 overflow-auto">
          <ul className="space-y-1.5 text-sm text-red-600">
            {errors.map((err, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">-</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </div>
    </Dialog>
  )
}
