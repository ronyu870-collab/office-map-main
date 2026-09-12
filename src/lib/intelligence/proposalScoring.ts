import type { ParsedRequirement, RequirementCapability } from './requirementSchema';

export type ProposalCandidateData = {
  id: string;
  name: string;
  district: string;
  submarket: string;
  grade: string;
  metricPeriod: string | null;
  metrics: {
    net_effective_rent: number | null;
    vacancy_rate: number | null;
    management_fee: number | null;
    total_area: number | null;
  };
  brochure: Record<string, unknown> | null;
};

export type CandidateMatchCheck = {
  key: 'location' | 'rent' | 'grade';
  label: string;
  passed: boolean;
  detail: string;
};

export type CandidateScore = {
  score: number | null;
  dataConfidence: number;
  checks: CandidateMatchCheck[];
  notes: string[];
};

const WEIGHTS = { location: 35, rent: 45, grade: 20 } as const;

function hasSupportedCapability(capabilities: RequirementCapability[], key: CandidateMatchCheck['key']) {
  return capabilities.some(item => item.key === key && item.status === 'supported');
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthlyToDaily(monthly: number) {
  return monthly * 12 / 365;
}

function locationCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const normalized = parsed.locations.filter(item => item.normalizedSubmarket || item.normalizedDistrict);
  const passed = normalized.some(item => (
    Boolean(item.normalizedSubmarket && item.normalizedSubmarket === candidate.submarket)
    || Boolean(item.normalizedDistrict && item.normalizedDistrict === candidate.district)
  ));
  return {
    key: 'location',
    label: '区域',
    passed,
    detail: passed ? `${candidate.district} · ${candidate.submarket}` : '不在已确认的目标区域内',
  };
}

function gradeCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const passed = parsed.grades.includes(candidate.grade);
  return {
    key: 'grade',
    label: '项目等级',
    passed,
    detail: candidate.grade || '暂无等级数据',
  };
}

function rentCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const monthly = candidate.metrics.net_effective_rent;
  if (monthly === null) {
    return { key: 'rent', label: '预算', passed: false, detail: '暂无净有效租金数据' };
  }
  const daily = monthlyToDaily(monthly);
  const minOk = parsed.rent.minDailyRmbSqm === null || daily >= parsed.rent.minDailyRmbSqm;
  const maxOk = parsed.rent.maxDailyRmbSqm === null || daily <= parsed.rent.maxDailyRmbSqm;
  return {
    key: 'rent',
    label: '预算',
    passed: minOk && maxOk,
    detail: `¥${monthly.toFixed(0)}/㎡/月（约 ¥${daily.toFixed(1)}/㎡/天）`,
  };
}

function dataConfidence(candidate: ProposalCandidateData) {
  const brochure = candidate.brochure;
  const checks = [
    candidate.metricPeriod !== null,
    Boolean(brochure && brochure.address),
    Boolean(brochure && brochure.metro_access),
    number(brochure?.standard_floor_area) !== null,
    Boolean(brochure && brochure.property_management),
  ];
  return checks.filter(Boolean).length * 20;
}

export function scoreProposalCandidate(
  parsed: ParsedRequirement,
  capabilities: RequirementCapability[],
  candidate: ProposalCandidateData,
): CandidateScore {
  const checks: CandidateMatchCheck[] = [];
  if (hasSupportedCapability(capabilities, 'location')) checks.push(locationCheck(parsed, candidate));
  if (hasSupportedCapability(capabilities, 'rent') && parsed.rent.basis === 'net_effective') checks.push(rentCheck(parsed, candidate));
  if (hasSupportedCapability(capabilities, 'grade')) checks.push(gradeCheck(parsed, candidate));

  const denominator = checks.reduce((sum, item) => sum + WEIGHTS[item.key], 0);
  const numerator = checks.reduce((sum, item) => sum + (item.passed ? WEIGHTS[item.key] : 0), 0);
  const score = denominator > 0 ? Math.round(numerator / denominator * 100) : null;

  const notes: string[] = [];
  const rent = candidate.metrics.net_effective_rent;
  if (candidate.submarket) notes.push(`位于${candidate.submarket}`);
  if (rent !== null) notes.push(`最新净有效租金约 ¥${rent.toFixed(0)}/㎡/月`);
  if (candidate.metrics.vacancy_rate !== null) notes.push(`最新空置率 ${(candidate.metrics.vacancy_rate * 100).toFixed(1)}%`);
  if (candidate.brochure?.metro_access) notes.push(`地铁：${String(candidate.brochure.metro_access)}`);
  if (candidate.brochure?.standard_floor_area) notes.push(`标准层约 ${Number(candidate.brochure.standard_floor_area).toLocaleString('zh-CN')}㎡`);

  return { score, dataConfidence: dataConfidence(candidate), checks, notes: notes.slice(0, 4) };
}
