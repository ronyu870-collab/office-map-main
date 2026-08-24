export const MAX_XLSX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_XLSX_DATA_ROWS = 10_000
export const MAX_XLSX_CELLS = 500_000

// One header row + one optional instruction row + one sentinel row.
// The sentinel lets the parser reveal that the workbook exceeded the accepted
// data-row budget without parsing an unbounded number of worksheet rows.
export const XLSX_SHEET_ROW_LIMIT = MAX_XLSX_DATA_ROWS + 3

export function validateXlsxUploadFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return '仅支持 .xlsx 文件，请使用系统下载的标准模板'
  }

  if (file.size > MAX_XLSX_FILE_BYTES) {
    return 'XLSX 文件过大，单个文件不得超过 25 MiB'
  }

  return null
}

export function validateXlsxRowBudget(rows: unknown[][]): string | null {
  if (rows.length > MAX_XLSX_DATA_ROWS + 2) {
    return `XLSX 数据行数超过安全上限（最多 ${MAX_XLSX_DATA_ROWS.toLocaleString('en-US')} 条）`
  }

  let cellCount = 0
  for (const row of rows) {
    cellCount += row.length
    if (cellCount > MAX_XLSX_CELLS) {
      return `XLSX 单元格数量超过安全上限（最多 ${MAX_XLSX_CELLS.toLocaleString('en-US')} 个）`
    }
  }

  return null
}
