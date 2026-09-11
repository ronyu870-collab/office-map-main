import type {
  ParsedRequirement,
  RequirementCapability,
} from './requirementSchema';

export type RequirementVocabulary = {
  districts: string[];
  submarkets: string[];
  grades: string[];
};

export type RequirementCapabilityContext = {
  latestMetricPeriod: string | null;
};

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function normalizeRequirementAgainstVocabulary(
  parsed: ParsedRequirement,
  vocabulary: RequirementVocabulary,
): ParsedRequirement {
  const districtSet = new Set(vocabulary.districts);
  const submarketSet = new Set(vocabulary.submarkets);
  const gradeSet = new Set(vocabulary.grades);
  const unresolved = [...parsed.unresolved];

  const locations = parsed.locations.map(location => {
    const normalizedDistrict = location.normalizedDistrict && districtSet.has(location.normalizedDistrict)
      ? location.normalizedDistrict
      : null;
    const normalizedSubmarket = location.normalizedSubmarket && submarketSet.has(location.normalizedSubmarket)
      ? location.normalizedSubmarket
      : null;

    if (!normalizedDistrict && !normalizedSubmarket && !unresolved.includes(location.raw)) {
      unresolved.push(location.raw);
    }

    return {
      ...location,
      normalizedDistrict,
      normalizedSubmarket,
    };
  });

  const grades = unique(parsed.grades.filter(grade => gradeSet.has(grade)));
  for (const grade of parsed.grades) {
    if (!gradeSet.has(grade) && !unresolved.includes(grade)) unresolved.push(grade);
  }

  return {
    ...parsed,
    locations,
    grades,
    unresolved: unique(unresolved),
  };
}

function numberRange(min: number | null, max: number | null, suffix: string) {
  if (min !== null && max !== null) return `${min.toLocaleString('zh-CN')}–${max.toLocaleString('zh-CN')}${suffix}`;
  if (min !== null) return `≥${min.toLocaleString('zh-CN')}${suffix}`;
  if (max !== null) return `≤${max.toLocaleString('zh-CN')}${suffix}`;
  return '';
}

export function resolveRequirementCapabilities(
  parsed: ParsedRequirement,
  context: RequirementCapabilityContext,
): RequirementCapability[] {
  const capabilities: RequirementCapability[] = [];

  if (parsed.locations.length > 0) {
    const normalized = unique(parsed.locations.flatMap(location => [
      location.normalizedSubmarket ?? '',
      location.normalizedDistrict ?? '',
    ]));
    const raw = unique(parsed.locations.map(location => location.raw));
    capabilities.push({
      key: 'location',
      label: '区域',
      value: normalized.length > 0 ? normalized.join(' / ') : raw.join(' / '),
      status: normalized.length > 0 ? 'supported' : 'partial',
      explanation: normalized.length > 0
        ? '已匹配系统现有行政区或子市场，可进入地图筛选。'
        : '已识别地点表达，但尚未匹配系统现有行政区或子市场，需要人工确认。',
      dataBasis: 'buildings.district / buildings.submarket',
    });
  }

  if (parsed.area.minSqm !== null || parsed.area.maxSqm !== null) {
    capabilities.push({
      key: 'area',
      label: '面积',
      value: numberRange(parsed.area.minSqm, parsed.area.maxSqm, '㎡'),
      status: 'unsupported',
      explanation: '当前没有实时可租单元面积数据，不能用楼宇总建筑面积替代客户所需面积。',
      dataBasis: null,
    });
  }

  if (parsed.rent.minDailyRmbSqm !== null || parsed.rent.maxDailyRmbSqm !== null) {
    const basisLabel = parsed.rent.basis === 'asking'
      ? '报价租金'
      : parsed.rent.basis === 'net_effective'
        ? '净有效租金'
        : '租金口径待确认';
    const isNetEffective = parsed.rent.basis === 'net_effective';
    const explanation = isNetEffective
      ? '可换算为现有季度净有效租金（月度口径）进入地图筛选；不会把模型生成值当作市场数据。'
      : parsed.rent.basis === 'asking'
        ? '当前地图可筛选的是净有效租金，不能用报价租金直接替代，需确认口径后再筛选。'
        : '系统已有季度净有效租金指标，但客户没有说明报价/净有效口径，建议确认后再筛选。';

    capabilities.push({
      key: 'rent',
      label: '预算',
      value: `${numberRange(parsed.rent.minDailyRmbSqm, parsed.rent.maxDailyRmbSqm, '元/㎡/天')} · ${basisLabel}`,
      status: isNetEffective ? 'supported' : 'partial',
      explanation,
      dataBasis: context.latestMetricPeriod ? `building_metrics.net_effective_rent · ${context.latestMetricPeriod}` : 'building_metrics.net_effective_rent',
    });
  }

  if (parsed.moveInMonth) {
    capabilities.push({
      key: 'moveIn',
      label: '入住时间',
      value: parsed.moveInMonth,
      status: 'unsupported',
      explanation: '当前数据库没有可入住日期字段；该条件会保留，但不会参与真实楼宇筛选。',
      dataBasis: null,
    });
  }

  if (parsed.grades.length > 0) {
    capabilities.push({
      key: 'grade',
      label: '项目等级',
      value: parsed.grades.join(' / '),
      status: 'supported',
      explanation: '已匹配系统现有项目等级，可映射到地图现有甲级/乙级/产业园区筛选。',
      dataBasis: 'buildings.grade',
    });
  }

  if (parsed.metro.preferred || parsed.metro.maxDistanceMeters !== null) {
    capabilities.push({
      key: 'metro',
      label: '交通',
      value: parsed.metro.maxDistanceMeters !== null
        ? `地铁优先 · ≤${parsed.metro.maxDistanceMeters.toLocaleString('zh-CN')}m`
        : '地铁优先',
      status: 'partial',
      explanation: '地图已有指定地铁站与距离筛选；泛化“地铁便利”仍需确认目标站点或可接受距离。',
      dataBasis: 'Map subway filter',
    });
  }

  if (parsed.greenCertifications.length > 0) {
    capabilities.push({
      key: 'green',
      label: '绿色认证',
      value: parsed.greenCertifications.join(' / '),
      status: 'partial',
      explanation: '现有楼宇数据包含 LEED 等绿色认证字段，但不同认证类型覆盖度不完全一致。',
      dataBasis: 'buildings.leed_certification / building_brochure_data',
    });
  }

  if (parsed.otherPreferences.length > 0 || parsed.unresolved.length > 0) {
    const values = unique([...parsed.otherPreferences, ...parsed.unresolved]);
    capabilities.push({
      key: 'other',
      label: '其他偏好',
      value: values.join('；'),
      status: 'partial',
      explanation: '已保留为客户偏好，不会在缺少可靠字段时强行转换为筛选条件。',
      dataBasis: null,
    });
  }

  return capabilities;
}
