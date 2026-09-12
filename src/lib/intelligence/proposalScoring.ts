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
    asking_rent: number | null;
    vacancy_rate: number | null;
    management_fee: number | null;
    total_area: number | null;
  };
  brochure: Record<string, unknown> | null;
};

export type CandidateMatchCheck = {
  key: 'location' | 'rent' | 'grade' | 'metro' | 'green';
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

const WEIGHTS = { location: 25, rent: 35, grade: 20, metro: 15, green: 5 } as const;

function hasCapability(capabilities: RequirementCapability[], key: CandidateMatchCheck['key']) {
  return capabilities.some(item => item.key === key);
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthlyToDaily(monthly: number) {
  return monthly * 12 / 365;
}

function gradeCategory(grade: string): 'A' | 'B' | 'BP' | null {
  const normalized = grade.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('BP')) return 'BP';
  if (normalized.includes('B')) return 'B';
  if (normalized.includes('A') || normalized.includes('P')) return 'A';
  return null;
}

function locationCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const normalized = parsed.locations.filter(item => item.normalizedSubmarket || item.normalizedDistrict);
  const passed = normalized.length === 0 || normalized.some(item => (
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
  const candidateCategory = gradeCategory(candidate.grade);
  const acceptedCategories = new Set(parsed.grades.map(gradeCategory).filter((value): value is 'A' | 'B' | 'BP' => Boolean(value)));
  const passed = acceptedCategories.size === 0 || Boolean(candidateCategory && acceptedCategories.has(candidateCategory));
  return {
    key: 'grade',
    label: '项目等级',
    passed,
    detail: candidate.grade || '暂无等级数据',
  };
}

function rentCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const useAsking = parsed.rent.basis === 'asking';
  const monthly = useAsking ? candidate.metrics.asking_rent : candidate.metrics.net_effective_rent;
  if (monthly === null) {
    return { key: 'rent', label: '预算', passed: false, detail: `暂无${useAsking ? '报价租金' : '净有效租金'}数据` };
  }
  const daily = monthlyToDaily(monthly);
  const minOk = parsed.rent.minDailyRmbSqm === null || daily >= parsed.rent.minDailyRmbSqm;
  const maxOk = parsed.rent.maxDailyRmbSqm === null || daily <= parsed.rent.maxDailyRmbSqm;
  return {
    key: 'rent',
    label: '预算',
    passed: minOk && maxOk,
    detail: `${useAsking ? '报价租金' : '净有效租金'} ¥${monthly.toFixed(0)}/㎡/月（约 ¥${daily.toFixed(1)}/㎡/天）`,
  };
}

function metroEvidence(text: string) {
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  const meters = text.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\b/i);
  const km = text.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)\b/i);
  return {
    minutes: minutes ? Number(minutes[1]) : null,
    distanceMeters: meters ? Number(meters[1]) : km ? Number(km[1]) * 1000 : null,
  };
}

function metroCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const text = candidate.brochure?.metro_access ? String(candidate.brochure.metro_access) : '';
  if (!text) return { key: 'metro', label: '地铁', passed: false, detail: '楼书暂无地铁通达信息' };
  const evidence = metroEvidence(text);
  const maxDistance = parsed.metro.maxDistanceMeters;
  const passed = maxDistance === null
    ? true
    : evidence.distanceMeters !== null
      ? evidence.distanceMeters <= maxDistance
      : false;
  return { key: 'metro', label: '地铁', passed, detail: text };
}

function greenCheck(parsed: ParsedRequirement, candidate: ProposalCandidateData): CandidateMatchCheck {
  const evidence = [
    candidate.brochure?.leed_certification,
    candidate.brochure?.well_certification,
    candidate.brochure?.green_building_standard,
  ].filter(Boolean).map(String).join(' · ');
  const normalizedEvidence = evidence.toUpperCase();
  const passed = parsed.greenCertifications.length === 0
    || parsed.greenCertifications.some(cert => normalizedEvidence.includes(cert.trim().toUpperCase()));
  return { key: 'green', label: '绿色认证', passed, detail: evidence || '暂无绿色认证数据' };
}

function dataConfidence(candidate: ProposalCandidateData) {
  const brochure = candidate.brochure;
  const checks = [
    candidate.metricPeriod !== null,
    candidate.metrics.net_effective_rent !== null || candidate.metrics.asking_rent !== null,
    Boolean(brochure && brochure.address),
    Boolean(brochure && brochure.metro_access),
    number(brochure?.standard_floor_area) !== null,
  ];
  return checks.filter(Boolean).length * 20;
}

export function scoreProposalCandidate(
  parsed: ParsedRequirement,
  capabilities: RequirementCapability[],
  candidate: ProposalCandidateData,
): CandidateScore {
  const checks: CandidateMatchCheck[] = [];
  if (hasCapability(capabilities, 'location')) checks.push(locationCheck(parsed, candidate));
  if (hasCapability(capabilities, 'rent')) checks.push(rentCheck(parsed, candidate));
  if (hasCapability(capabilities, 'grade')) checks.push(gradeCheck(parsed, candidate));
  if (hasCapability(capabilities, 'metro')) checks.push(metroCheck(parsed, candidate));
  if (hasCapability(capabilities, 'green')) checks.push(greenCheck(parsed, candidate));

  const denominator = checks.reduce((sum, item) => sum + WEIGHTS[item.key], 0);
  const numerator = checks.reduce((sum, item) => sum + (item.passed ? WEIGHTS[item.key] : 0), 0);
  const score = denominator > 0 ? Math.round(numerator / denominator * 100) : null;

  const notes: string[] = [];
  const rent = parsed.rent.basis === 'asking' ? candidate.metrics.asking_rent : candidate.metrics.net_effective_rent;
  if (candidate.submarket) notes.push(`位于${candidate.submarket}`);
  if (rent !== null) notes.push(`${parsed.rent.basis === 'asking' ? '报价租金' : '净有效租金'}约 ¥${rent.toFixed(0)}/㎡/月`);
  if (candidate.metrics.vacancy_rate !== null) notes.push(`最新空置率 ${(candidate.metrics.vacancy_rate * 100).toFixed(1)}%`);
  if (candidate.brochure?.metro_access) notes.push(`地铁：${String(candidate.brochure.metro_access)}`);
  if (candidate.brochure?.standard_floor_area) notes.push(`标准层约 ${Number(candidate.brochure.standard_floor_area).toLocaleString('zh-CN')}㎡`);

  return { score, dataConfidence: dataConfidence(candidate), checks, notes: notes.slice(0, 4) };
}
