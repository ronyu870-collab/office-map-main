import type {
  ParsedRequirement,
  RequirementCapability,
  RequirementParseResult,
} from './requirementSchema';

const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = 365;

export type RecommendationBuildingSource = {
  id: string;
  name: string;
  grade: string;
  district: string;
  submarket: string;
  metricPeriod: string | null;
  metrics: {
    netEffectiveRentMonthly: number | null;
    askingRentMonthly: number | null;
    vacancyRate: number | null;
    managementFee: number | null;
  };
  brochure: {
    address: string | null;
    developer: string | null;
    metroAccess: string | null;
    standardFloorArea: number | null;
    propertyManagement: string | null;
    leedCertification: string | null;
  } | null;
};

export type RecommendedBuilding = RecommendationBuildingSource & {
  score: number;
  rentDaily: number | null;
  rentBasisLabel: string | null;
  reasons: string[];
  cautions: string[];
  dataCompleteness: number;
};

export type RecommendationPlan = {
  effectiveResult: RequirementParseResult;
  candidateCount: number;
  recommendations: RecommendedBuilding[];
  hardCriteria: string[];
  preferenceCriteria: string[];
  assumptions: string[];
  verificationRequired: string[];
  gradeIsHard: boolean;
};

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthlyToDaily(monthly: number) {
  return monthly * MONTHS_PER_YEAR / DAYS_PER_YEAR;
}

function formatRange(min: number | null, max: number | null, suffix: string) {
  if (min !== null && max !== null) return `${min.toLocaleString('zh-CN')}–${max.toLocaleString('zh-CN')}${suffix}`;
  if (min !== null) return `≥${min.toLocaleString('zh-CN')}${suffix}`;
  if (max !== null) return `≤${max.toLocaleString('zh-CN')}${suffix}`;
  return '';
}

function normalizedGradeBucket(grade: string) {
  const normalized = grade.trim().toUpperCase();
  if (!normalized) return '';
  if (normalized.includes('BP')) return 'BP';
  if (normalized.includes('P') || normalized.includes('A')) return 'A';
  if (normalized.includes('B')) return 'B';
  return normalized;
}

function gradeMatches(candidateGrade: string, desiredGrades: string[]) {
  const candidate = normalizedGradeBucket(candidateGrade);
  return desiredGrades.some(grade => normalizedGradeBucket(grade) === candidate);
}

export function detectHardGradeConstraint(originalRequirement: string) {
  const normalized = originalRequirement.replace(/\s+/g, '');
  return /(?:只(?:看|考虑|要)|必须|仅限|仅考虑|限定|不要非).{0,8}(?:甲级|乙级|产业园|A类|B类)/i.test(normalized);
}

function capabilityByKey(result: RequirementParseResult, key: RequirementCapability['key']) {
  return result.capabilities.find(item => item.key === key) ?? null;
}

export function buildRecommendationRequirement(
  result: RequirementParseResult,
  originalRequirement: string,
): RequirementParseResult {
  const gradeHard = detectHardGradeConstraint(originalRequirement);
  const rentSpecified = result.parsed.rent.minDailyRmbSqm !== null || result.parsed.rent.maxDailyRmbSqm !== null;
  const assumeNetEffective = rentSpecified && result.parsed.rent.basis === 'unspecified';

  const parsed: ParsedRequirement = {
    ...result.parsed,
    rent: assumeNetEffective
      ? { ...result.parsed.rent, basis: 'net_effective' }
      : result.parsed.rent,
  };

  const capabilities = result.capabilities.map(capability => {
    if (capability.key === 'rent' && assumeNetEffective) {
      return {
        ...capability,
        status: 'supported' as const,
        value: `${formatRange(parsed.rent.minDailyRmbSqm, parsed.rent.maxDailyRmbSqm, '元/㎡/天')} · 净有效租金（系统默认）`,
        explanation: '客户未说明租金口径；推荐阶段暂按系统现有净有效租金理解，并在结果中明确提示该假设。',
      };
    }
    if (capability.key === 'grade' && parsed.grades.length > 0 && !gradeHard) {
      return {
        ...capability,
        status: 'partial' as const,
        explanation: '客户表达为偏好项：用于推荐排序，不作为硬筛选条件。',
      };
    }
    if (capability.key === 'metro' && parsed.metro.preferred) {
      return {
        ...capability,
        status: 'partial' as const,
        explanation: '作为推荐排序偏好；仅使用楼书已记录的地铁通达信息，不把缺失数据推断为便利。',
        dataBasis: 'building_brochure_data.metro_access',
      };
    }
    return capability;
  });

  return { ...result, parsed, capabilities };
}

function locationTargets(parsed: ParsedRequirement) {
  const submarkets = unique(parsed.locations.map(item => item.normalizedSubmarket ?? ''));
  if (submarkets.length > 0) return { type: 'submarket' as const, values: submarkets };
  const districts = unique(parsed.locations.map(item => item.normalizedDistrict ?? ''));
  if (districts.length > 0) return { type: 'district' as const, values: districts };
  return null;
}

function locationMatches(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const targets = locationTargets(parsed);
  if (!targets) return true;
  return targets.type === 'submarket'
    ? targets.values.includes(building.submarket)
    : targets.values.includes(building.district);
}

function rentFor(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const monthly = parsed.rent.basis === 'asking'
    ? building.metrics.askingRentMonthly
    : building.metrics.netEffectiveRentMonthly;
  if (monthly === null) return { monthly: null, daily: null, label: parsed.rent.basis === 'asking' ? '报价租金' : '净有效租金' };
  return {
    monthly,
    daily: monthlyToDaily(monthly),
    label: parsed.rent.basis === 'asking' ? '报价租金' : '净有效租金',
  };
}

function rentMatches(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const hasRentConstraint = parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null;
  if (!hasRentConstraint) return true;
  const { daily } = rentFor(parsed, building);
  if (daily === null) return false;
  if (parsed.rent.minDailyRmbSqm !== null && daily < parsed.rent.minDailyRmbSqm) return false;
  if (parsed.rent.maxDailyRmbSqm !== null && daily > parsed.rent.maxDailyRmbSqm) return false;
  return true;
}

function metroScore(text: string | null) {
  if (!text?.trim()) return 0;
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  if (minutes && Number(minutes[1]) <= 10) return 15;
  const meters = text.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\b/i);
  if (meters && Number(meters[1]) <= 800) return 15;
  return 10;
}

function rentPreferenceScore(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const hasRentConstraint = parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null;
  if (!hasRentConstraint) return null;
  const { daily } = rentFor(parsed, building);
  if (daily === null) return { score: 0, max: 35 };

  if (parsed.rent.maxDailyRmbSqm !== null && parsed.rent.maxDailyRmbSqm > 0) {
    const margin = Math.max(0, parsed.rent.maxDailyRmbSqm - daily) / parsed.rent.maxDailyRmbSqm;
    const bonus = Math.min(margin / 0.25, 1) * 10;
    return { score: 25 + bonus, max: 35 };
  }
  return { score: 35, max: 35 };
}

function completeness(building: RecommendationBuildingSource) {
  const checks = [
    building.metricPeriod !== null,
    building.metrics.netEffectiveRentMonthly !== null || building.metrics.askingRentMonthly !== null,
    Boolean(building.brochure?.address),
    Boolean(building.brochure?.metroAccess),
    building.brochure?.standardFloorArea !== null && building.brochure?.standardFloorArea !== undefined,
  ];
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function buildReasons(parsed: ParsedRequirement, building: RecommendationBuildingSource, gradeHard: boolean) {
  const reasons: string[] = [];
  const targets = locationTargets(parsed);
  if (targets) reasons.push(`位于${building.submarket || building.district}，符合目标区域`);

  const rent = rentFor(parsed, building);
  if (rent.daily !== null) {
    const max = parsed.rent.maxDailyRmbSqm;
    if (max !== null && max > 0) {
      const marginPct = Math.max(0, (max - rent.daily) / max * 100);
      reasons.push(`${rent.label}约 ¥${rent.daily.toFixed(1)}/㎡/天，低于预算上限约 ${marginPct.toFixed(0)}%`);
    } else {
      reasons.push(`${rent.label}约 ¥${rent.daily.toFixed(1)}/㎡/天`);
    }
  }

  if (parsed.grades.length > 0 && gradeMatches(building.grade, parsed.grades)) {
    reasons.push(`${building.grade || '项目等级'}符合${gradeHard ? '等级硬条件' : '等级偏好'}`);
  }
  if (parsed.metro.preferred && building.brochure?.metroAccess) {
    reasons.push(`地铁：${building.brochure.metroAccess}`);
  }
  if (parsed.greenCertifications.length > 0 && building.brochure?.leedCertification) {
    reasons.push(`绿色认证：${building.brochure.leedCertification}`);
  }
  if (building.metrics.vacancyRate !== null) {
    reasons.push(`最新市场空置率 ${(building.metrics.vacancyRate * 100).toFixed(1)}%（非实时销控）`);
  }
  return reasons.slice(0, 4);
}

function candidateCautions(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const cautions: string[] = [];
  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) {
    if (building.brochure?.standardFloorArea !== null && building.brochure?.standardFloorArea !== undefined) {
      cautions.push(`标准层约 ${building.brochure.standardFloorArea.toLocaleString('zh-CN')}㎡，仅供空间尺度参考，不代表当前有对应可租单元`);
    } else {
      cautions.push('当前无实时可租单元面积，客户面积需求需 Broker 二次确认');
    }
  }
  if (parsed.moveInMonth) cautions.push(`${parsed.moveInMonth} 入住需核验实时销控与交付日期`);
  return cautions;
}

export function buildRecommendationPlan(
  result: RequirementParseResult,
  originalRequirement: string,
  buildings: RecommendationBuildingSource[],
): RecommendationPlan {
  const effectiveResult = buildRecommendationRequirement(result, originalRequirement);
  const { parsed } = effectiveResult;
  const gradeHard = detectHardGradeConstraint(originalRequirement);
  const targets = locationTargets(parsed);
  const hardCriteria: string[] = [];
  const preferenceCriteria: string[] = [];
  const assumptions: string[] = [];
  const verificationRequired: string[] = [];

  if (targets) hardCriteria.push(`${targets.type === 'submarket' ? '子市场' : '行政区'}：${targets.values.join(' / ')}`);
  if (parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null) {
    hardCriteria.push(`${parsed.rent.basis === 'asking' ? '报价租金' : '净有效租金'} ${formatRange(parsed.rent.minDailyRmbSqm, parsed.rent.maxDailyRmbSqm, '元/㎡/天')}`);
    if (result.parsed.rent.basis === 'unspecified') assumptions.push('客户未说明租金口径，暂按净有效租金理解；可在后续版本中切换口径。');
  }
  if (parsed.grades.length > 0) {
    const label = `项目等级：${parsed.grades.join(' / ')}`;
    if (gradeHard) hardCriteria.push(label);
    else preferenceCriteria.push(`${label}（优先，不硬过滤）`);
  }
  if (parsed.metro.preferred) preferenceCriteria.push('地铁便利（基于楼书已记录信息排序）');
  if (parsed.greenCertifications.length > 0) preferenceCriteria.push(`绿色认证：${parsed.greenCertifications.join(' / ')}`);
  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) {
    verificationRequired.push(`${formatRange(parsed.area.minSqm, parsed.area.maxSqm, '㎡')}：需核验实时可租单元面积；标准层面积仅作参考。`);
  }
  if (parsed.moveInMonth) verificationRequired.push(`${parsed.moveInMonth} 入住：需核验实时销控、腾退及交付日期。`);
  if (parsed.unresolved.length > 0) verificationRequired.push(`未完全结构化：${parsed.unresolved.join('；')}`);

  const eligible = buildings.filter(building => {
    if (!locationMatches(parsed, building)) return false;
    if (!rentMatches(parsed, building)) return false;
    if (gradeHard && parsed.grades.length > 0 && !gradeMatches(building.grade, parsed.grades)) return false;
    return true;
  });

  const recommendations = eligible.map(building => {
    const factors: Array<{ score: number; max: number }> = [];
    if (targets) factors.push({ score: 25, max: 25 });
    const rent = rentPreferenceScore(parsed, building);
    if (rent) factors.push(rent);
    if (parsed.grades.length > 0) {
      factors.push({ score: gradeMatches(building.grade, parsed.grades) ? 25 : 0, max: 25 });
    }
    if (parsed.metro.preferred) {
      factors.push({ score: metroScore(building.brochure?.metroAccess ?? null), max: 15 });
    }
    if (parsed.greenCertifications.length > 0) {
      const hasGreen = Boolean(building.brochure?.leedCertification);
      factors.push({ score: hasGreen ? 10 : 0, max: 10 });
    }

    const max = factors.reduce((sum, factor) => sum + factor.max, 0);
    const achieved = factors.reduce((sum, factor) => sum + factor.score, 0);
    const score = max > 0 ? Math.round(achieved / max * 100) : 50;
    const rentValue = rentFor(parsed, building);

    return {
      ...building,
      score,
      rentDaily: rentValue.daily,
      rentBasisLabel: rentValue.label,
      reasons: buildReasons(parsed, building, gradeHard),
      cautions: candidateCautions(parsed, building),
      dataCompleteness: completeness(building),
    } satisfies RecommendedBuilding;
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.dataCompleteness !== a.dataCompleteness) return b.dataCompleteness - a.dataCompleteness;
    const aRent = a.rentDaily ?? Number.POSITIVE_INFINITY;
    const bRent = b.rentDaily ?? Number.POSITIVE_INFINITY;
    return aRent - bRent;
  });

  return {
    effectiveResult,
    candidateCount: recommendations.length,
    recommendations,
    hardCriteria,
    preferenceCriteria,
    assumptions,
    verificationRequired,
    gradeIsHard: gradeHard,
  };
}

export function recommendationCapability(
  plan: RecommendationPlan,
  key: RequirementCapability['key'],
) {
  return capabilityByKey(plan.effectiveResult, key);
}

export function toFiniteNumber(value: unknown) {
  return finite(value);
}
