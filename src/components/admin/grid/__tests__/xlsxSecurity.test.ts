import { describe, expect, it } from 'vitest'
import {
  MAX_XLSX_CELLS,
  MAX_XLSX_DATA_ROWS,
  MAX_XLSX_FILE_BYTES,
  validateXlsxRowBudget,
  validateXlsxUploadFile,
} from '../xlsxSecurity'

describe('xlsxSecurity', () => {
  describe('validateXlsxUploadFile', () => {
    it('accepts a normal xlsx file', () => {
      expect(validateXlsxUploadFile({ name: '季度数据.xlsx', size: 1024 })).toBeNull()
    })

    it('rejects non-xlsx file names', () => {
      expect(validateXlsxUploadFile({ name: '季度数据.xls', size: 1024 })).toContain('仅支持 .xlsx')
    })

    it('rejects files above the size budget', () => {
      expect(
        validateXlsxUploadFile({ name: '季度数据.xlsx', size: MAX_XLSX_FILE_BYTES + 1 }),
      ).toContain('不得超过 25 MiB')
    })
  })

  describe('validateXlsxRowBudget', () => {
    it('accepts rows within the configured budgets', () => {
      expect(validateXlsxRowBudget([['项目', '季度'], ['A', '2026Q3']])).toBeNull()
    })

    it('rejects workbooks above the data-row budget', () => {
      const rows = Array.from({ length: MAX_XLSX_DATA_ROWS + 3 }, () => [])
      expect(validateXlsxRowBudget(rows)).toContain('数据行数超过安全上限')
    })

    it('rejects workbooks above the cell budget', () => {
      const row = Array.from({ length: 1000 }, () => '')
      const rows = Array.from({ length: Math.floor(MAX_XLSX_CELLS / row.length) + 1 }, () => row)
      expect(validateXlsxRowBudget(rows)).toContain('单元格数量超过安全上限')
    })
  })
})
