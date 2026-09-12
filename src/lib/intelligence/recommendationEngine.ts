import type {
  ParsedRequirement,
  RequirementCapability,
  RequirementParseResult,
} from './requirementSchema';

const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = 365;
export const RECOMMENDATION_RANKING_VERSION = 'broker-fit-v2';

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
    wellCertification: string | null;
    greenBuildingStandard: string | null;
    completionDate: string | null;
  } | null;
};

export type RecommendationScoreFactor = {
  key: 'rent' | 'grade' | 'metro' | 'green';
  label: string;
  score: number;
  max: number;
  detail: string;
};

export type RecommendedBuilding = RecommendationBuildingSource & {
  score: number | null;
  scoreBreakdown: RecommendationScoreFactor[];
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
  unscoredPreferences: string[];
  relaxationHints: string[];
  gradeIsHard: boolean;
  rankingVersion: string;
};

export type RecommendationResponse = {
  plan: RecommendationPlan;
  meta: {
    generatedAt: string;
    universeCount: number;
    latestMetricPeriod: string | null;
    returnedCount: number;
    rankingVersion: string;
  };
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
        explanation: '客户未说明租金口径；推荐阶段暂按系统现有净有效租金理解，并明确展示这一假设。',
      };
    }
    if (capability.key === 'grade' && parsed.grades.length > 0 && !gradeHard) {
      return {
        ...capability,
        status: 'partial' as const,
        explanation: '客户表达为偏好项：用于推荐排序，不作为硬筛选条件。',
      };
    }
    if (capability.key === 'metro' && (parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null)) {
      return {
        ...capability,
        status: 'partial' as const,
        explanation: '作为推荐排序偏好；只使用楼书已记录的地铁通达信息，不把缺失数据推断为便利。',
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

function parseMetroEvidence(text: string | null) {
  if (!text?.trim()) return { minutes: null as number | null, distanceMeters: null as number | null };
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  const meterMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\b/i);
  const kmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)\b/i);
  return {
    minutes: minuteMatch ? Number(minuteMatch[1]) : null,
    distanceMeters: meterMatch ? Number(meterMatch[1]) : kmMatch ? Number(kmMatch[1]) * 1000 : null,
  };
}

function metroFactor(parsed: ParsedRequirement, building: RecommendationBuildingSource): RecommendationScoreFactor | null {
  if (!parsed.metro.preferred && parsed.metro.maxDistanceMeters === null) return null;
  const text = building.brochure?.metroAccess ?? null;
  const evidence = parseMetroEvidence(text);
  let score = 0;

  if (evidence.distanceMeters !== null) {
    const target = parsed.metro.maxDistanceMeters;
    if (target !== null) {
      if (evidence.distanceMeters <= target) score = 20;
      else if (evidence.distanceMeters <= target * 1.25) score = 12;
      else if (evidence.distanceMeters <= target * 1.5) score = 6;
    } else if (evidence.distanceMeters <= 400) score = 20;
    else if (evidence.distanceMeters <= 800) score = 16;
    else if (evidence.distanceMeters <= 1200) score = 10;
    else score = 5;
  } else if (evidence.minutes !== null) {
    if (evidence.minutes <= 5) score = 20;
    else if (evidence.minutes <= 10) score = 16;
    else if (evidence.minutes <= 15) score = 10;
    else score = 5;
  } else if (text) {
    score = 10;
  }

  return {
    key: 'metro',
    label: '地铁便利',
    score,
    max: 20,
    detail: text || '楼书暂无地铁通达信息',
  };
}

function rentFactor(parsed: ParsedRequirement, building: RecommendationBuildingSource): RecommendationScoreFactor | null {
  const hasRentConstraint = parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null;
  if (!hasRentConstraint) return null;
  const { daily, label } = rentFor(parsed, building);
  if (daily === null) return { key: 'rent', label: '预算余量', score: 0, max: 40, detail: '暂无对应租金数据' };

  let score = 40;
  const maxBudget = parsed.rent.maxDailyRmbSqm;
  if (maxBudget !== null && maxBudget > 0) {
    const margin = Math.max(0, maxBudget - daily) / maxBudget;
    score = 24 + Math.min(margin / 0.25, 1) * 16;
  }
  return {
    key: 'rent',
    label: '预算余量',
    score,
    max: 40,
    detail: `${label}约 ¥${daily.toFixed(1)}/㎡/天`,
  };
}

function greenText(building: RecommendationBuildingSource) {
  return [
    building.brochure?.leedCertification,
    building.brochure?.wellCertification,
    building.brochure?.greenBuildingStandard,
  ].filter(Boolean).join(' · ');
}

function greenFactor(parsed: ParsedRequirement, building: RecommendationBuildingSource): RecommendationScoreFactor | null {
  if (parsed.greenCertifications.length === 0) return null;
  const evidence = greenText(building);
  const normalizedEvidence = evidence.toUpperCase();
  const matched = parsed.greenCertifications.some(cert => normalizedEvidence.includes(cert.trim().toUpperCase()));
  return {
    key: 'green',
    label: '绿色认证',
    score: matched ? 10 : 0,
    max: 10,
    detail: evidence || '暂无绿色认证数据',
  };
}

function scoreBreakdown(parsed: ParsedRequirement, building: RecommendationBuildingSource, gradeHard: boolean) {
  const factors: RecommendationScoreFactor[] = [];
  const rent = rentFactor(parsed, building);
  if (rent) factors.push(rent);

  if (parsed.grades.length > 0 && !gradeHard) {
    factors.push({
      key: 'grade',
      label: '等级偏好',
      score: gradeMatches(building.grade, parsed.grades) ? 30 : 0,
      max: 30,
      detail: building.grade || '暂无等级数据',
    });
  }

  const metro = metroFactor(parsed, building);
  if (metro) factors.push(metro);
  const green = greenFactor(parsed, building);
  if (green) factors.push(green);
  return factors;
}

function relevantDataCompleteness(parsed: ParsedRequirement, building: RecommendationBuildingSource) {
  const checks: boolean[] = [Boolean(building.brochure?.address)];
  if (parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null) {
    checks.push(building.metricPeriod !== null);
    checks.push(rentFor(parsed, building).daily !== null);
  } else {
    checks.push(building.metricPeriod !== null);
  }
  if (parsed.grades.length > 0) checks.push(Boolean(building.grade));
  if (parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null) checks.push(Boolean(building.brochure?.metroAccess));
  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) checks.push(building.brochure?.standardFloorArea != null);
  if (parsed.greenCertifications.length > 0) checks.push(Boolean(greenText(building)));
  return Math.round(checks.filter(Boolean).length / Math.max(checks.length, 1) * 100);
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
    } else if (parsed.rent.minDailyRmbSqm !== null) {
      reasons.push(`${rent.label}约 ¥${rent.daily.toFixed(1)}/㎡/天，满足预算区间`);
    }
  }

  if (parsed.grades.length > 0 && gradeMatches(building.grade, parsed.grades)) {
    reasons.push(`${building.grade || '项目等级'}符合${gradeHard ? '等级硬条件' : '等级偏好'}`);
  }
  if ((parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null) && building.brochure?.metroAccess) {
    reasons.push(`地铁：${building.brochure.metroAccess}`);
  }
  if (parsed.greenCertifications.length > 0 && greenText(building)) {
    const green = greenFactor(parsed, building);
    if (green?.score) reasons.push(`绿色认证：${green.detail}`);
  }
  return reasons.slice(0, 4);
}

function candidateCautions(parsed: ParsedRequirement, building: RecommendationBuildingSource, gradeHard: boolean) {
  const cautions: string[] = [];
  if (parsed.grades.length > 0 && !gradeHard && !gradeMatches(building.grade, parsed.grades)) {
    cautions.push(`${building.grade || '当前等级未知'}，未命中客户的等级优先偏好`);
  }
  if ((parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null) && !building.brochure?.metroAccess) {
    cautions.push('楼书暂无地铁通达信息，交通便利度需 Broker 核验');
  }
  if (parsed.greenCertifications.length > 0 && !(greenFactor(parsed, building)?.score)) {
    cautions.push('现有楼书数据未验证客户要求的绿色认证');
  }
  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) {
    if (building.brochure?.standardFloorArea != null) {
      cautions.push(`标准层约 ${building.brochure.standardFloorArea.toLocaleString('zh-CN')}㎡，仅供空间尺度参考，不代表当前有对应可租单元`);
    } else {
      cautions.push('当前无实时可租单元面积，客户面积需求需 Broker 二次确认');
    }
  }
  if (parsed.moveInMonth) cautions.push(`${parsed.moveInMonth} 入住需核验实时销控、腾退与交付日期`);
  return cautions.slice(0, 4);
}

function buildRelaxationHints(parsed: ParsedRequirement, buildings: RecommendationBuildingSource[], gradeHard: boolean) {
  const hints: string[] = [];
  const targets = locationTargets(parsed);
  const locationPool = buildings.filter(building => locationMatches(parsed, building));

  if (targets && locationPool.length === 0) {
    hints.push('当前楼宇库中没有与目标区域匹配的活跃项目，可检查区域名称或扩大选址范围。');
    return hints;
  }

  const hasRent = parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null;
  if (hasRent) {
    const rentPool = locationPool
      .map(building => ({ building, daily: rentFor(parsed, building).daily }))
      .filter((item): item is { building: RecommendationBuildingSource; daily: number } => item.daily !== null);
    const budgetMatches = rentPool.filter(item => rentMatches(parsed, item.building));
    if (rentPool.length > 0 && budgetMatches.length === 0 && parsed.rent.maxDailyRmbSqm !== null) {
      const min = Math.min(...rentPool.map(item => item.daily));
      hints.push(`目标区域内有 ${rentPool.length} 个项目具备对应租金数据，最低约 ¥${min.toFixed(1)}/㎡/天；当前预算上限会过滤全部项目。`);
    }
  }

  if (gradeHard && parsed.grades.length > 0) {
    const beforeGrade = locationPool.filter(building => rentMatches(parsed, building));
    const afterGrade = beforeGrade.filter(building => gradeMatches(building.grade, parsed.grades));
    if (beforeGrade.length > 0 && afterGrade.length === 0) {
      hints.push(`区域与预算条件下仍有 ${beforeGrade.length} 个项目，但没有项目满足当前等级硬条件；可考虑将等级改为“优先”而非“必须”。`);
    }
  }
  return hints.slice(0, 2);
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
  const unscoredPreferences = unique(parsed.otherPreferences);

  if (targets) hardCriteria.push(`${targets.type === 'submarket' ? '子市场' : '行政区'}：${targets.values.join(' / ')}`);
  if (parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null) {
    hardCriteria.push(`${parsed.rent.basis === 'asking' ? '报价租金' : '净有效租金'} ${formatRange(parsed.rent.minDailyRmbSqm, parsed.rent.maxDailyRmbSqm, '元/㎡/天')}`);
    if (result.parsed.rent.basis === 'unspecified') assumptions.push('客户未说明租金口径，暂按净有效租金理解；推荐结果会明确显示这一口径。');
  }
  if (parsed.grades.length > 0) {
    const label = `项目等级：${parsed.grades.join(' / ')}`;
    if (gradeHard) hardCriteria.push(label);
    else preferenceCriteria.push(`${label}（优先，不硬过滤）`);
  }
  if (parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null) {
    const distance = parsed.metro.maxDistanceMeters !== null ? ` · 目标 ≤${parsed.metro.maxDistanceMeters.toLocaleString('zh-CN')}m` : '';
    preferenceCriteria.push(`地铁便利${distance}（基于楼书信息排序）`);
  }
  if (parsed.greenCertifications.length > 0) preferenceCriteria.push(`绿色认证：${parsed.greenCertifications.join(' / ')}`);
  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) {
    verificationRequired.push(`${formatRange(parsed.area.minSqm, parsed.area.maxSqm, '㎡')}：需核验实时可租单元面积；标准层面积仅作参考。`);
  }
  if (parsed.moveInMonth) verificationRequired.push(`${parsed.moveInMonth} 入住：需核验实时销控、腾退及交付日期。`);
  if (parsed.metro.maxDistanceMeters !== null) verificationRequired.push('地铁距离来自楼书文本而非统一 GIS 测距；精确距离仍需 Broker 核验。');
  if (parsed.unresolved.length > 0) verificationRequired.push(`未完全结构化：${parsed.unresolved.join('；')}`);
  if (unscoredPreferences.length > 0) verificationRequired.push(`尚未量化的偏好：${unscoredPreferences.join('；')}`);

  const eligible = buildings.filter(building => {
    if (!locationMatches(parsed, building)) return false;
    if (!rentMatches(parsed, building)) return false;
    if (gradeHard && parsed.grades.length > 0 && !gradeMatches(building.grade, parsed.grades)) return false;
    return true;
  });

  const recommendations = eligible.map(building => {
    const factors = scoreBreakdown(parsed, building, gradeHard);
    const max = factors.reduce((sum, factor) => sum + factor.max, 0);
    const achieved = factors.reduce((sum, factor) => sum + factor.score, 0);
    const score = max > 0 ? Math.round(achieved / max * 100) : null;
    const rentValue = rentFor(parsed, building);

    return {
      ...building,
      score,
      scoreBreakdown: factors,
      rentDaily: rentValue.daily,
      rentBasisLabel: rentValue.label,
      reasons: buildReasons(parsed, building, gradeHard),
      cautions: candidateCautions(parsed, building, gradeHard),
      dataCompleteness: relevantDataCompleteness(parsed, building),
    } satisfies RecommendedBuilding;
  }).sort((a, b) => {
    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    if (bScore !== aScore) return bScore - aScore;
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
    unscoredPreferences,
    relaxationHints: recommendations.length === 0 ? buildRelaxationHints(parsed, buildings, gradeHard) : [],
    gradeIsHard: gradeHard,
    rankingVersion: RECOMMENDATION_RANKING_VERSION,
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
