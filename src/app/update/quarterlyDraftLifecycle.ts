export interface SubmissionPeriod {
  year: number;
  quarter: number;
}

interface SettingRow {
  key?: string | null;
  value?: string | null;
}

export function parseSubmissionPeriod(settings: SettingRow[] | null | undefined): SubmissionPeriod {
  const yearRaw = settings?.find((row) => row.key === 'current_submission_year')?.value;
  const quarterRaw = settings?.find((row) => row.key === 'current_submission_quarter')?.value;
  const year = Number(yearRaw);
  const quarter = Number(quarterRaw);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('当前填报年份配置无效，请联系管理员后重试。');
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error('当前填报季度配置无效，请联系管理员后重试。');
  }

  return { year, quarter };
}

export function previousSubmissionPeriod(period: SubmissionPeriod): SubmissionPeriod {
  return period.quarter === 1
    ? { year: period.year - 1, quarter: 4 }
    : { year: period.year, quarter: period.quarter - 1 };
}

export function canonicalDraftUserName(email: string | null | undefined, fallback = 'unknown') {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized.split('@')[0] || fallback;
}

export function hasMeaningfulDraftData(draft: Record<string, unknown>) {
  const regularKeys = Object.keys(draft).filter((key) => key !== '__futureSupply__');
  if (regularKeys.length > 0) return true;
  const future = draft.__futureSupply__;
  return Boolean(future && typeof future === 'object' && Object.keys(future as Record<string, unknown>).length > 0);
}

export function isDraftRevisionConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return candidate.code === '40001' || candidate.message?.includes('draft_revision_conflict') === true;
}

export function isSubmissionPeriodChanged(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { message?: string };
  return candidate.message?.includes('submission_period_changed') === true;
}
