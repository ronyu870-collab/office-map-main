import type { AvailabilityRow, MaterialProvenance, SalesMaterial, TimeEvidence } from './model';

export function rowAsOf(row: AvailabilityRow, material: SalesMaterial, provenance: MaterialProvenance): TimeEvidence | null {
  if (row.timing) return row.timing.as_of;
  if (provenance.as_of) return provenance.as_of;
  // Old records without evidence must not be treated as verified dates.
  return material.document_date && provenance.document_date_evidence
    ? { value: material.document_date, evidence: provenance.document_date_evidence } : null;
}

export function formatSourceTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.replaceAll('-', '.')}（仅日期）`;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)}（北京时间）`
    : '时间未记录';
}

export function rowTimeLabel(row: AvailabilityRow, material: SalesMaterial, provenance: MaterialProvenance, now = new Date()): string {
  const asOf = rowAsOf(row, material, provenance);
  const confirmed = row.timing?.confirmed;
  const confirmationIsLatest = confirmed && (!asOf || Date.parse(confirmed.value) >= Date.parse(asOf.value));
  const event = confirmationIsLatest ? confirmed : asOf;
  if (!event) return '时效未核实';
  const datePart = event.value.length === 10 ? event.value : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(event.value));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(datePart)) / 86400000));
  return `${confirmationIsLatest ? '确认' : '截至'} ${datePart.replaceAll('-', '.')} · ${days === 0 ? '今天' : `${days}天前`}`;
}
