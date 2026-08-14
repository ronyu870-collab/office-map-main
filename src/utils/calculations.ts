/**
 * 可复用的核心算法集合（从 `_legacy_v1/update.html`、`_legacy_v1/map.html` 提取并“纯函数化”）
 *
 * 设计原则：
 * - 纯函数：不读写外部状态、无副作用、可预测、可测试。
 * - 错误边界：对“空值/NaN/负数/分母为 0/百分号字符串”等常见脏数据做防御。
 * - 童子军规则：把旧版散落在页面脚本里的计算逻辑收敛到单一模块，命名清晰、注释完整。
 */

export type NumericLike = number | string | null | undefined;

/**
 * 将“可能是数字/数字字符串/带百分号字符串”的输入解析为 number。
 *
 * 兼容旧版逻辑：
 * - `_legacy_v1/update.html` 的 `safeNum`：`"13%" => 0.13`，其他走 `parseFloat`
 * - `_legacy_v1/map.html` 的 `vCurrent` 解析：支持 `"13%"`、`0.13`、`13`
 *
 * 重要约定：
 * - 默认不会把 `13` 自动当作 `0.13`，除非你显式传入 `percentHeuristic`。
 * - 当解析失败时返回 `NaN`（让上层选择“抛错/兜底/忽略”）。
 */
export function parseNumberLike(
  input: NumericLike,
  options?: {
    /** 如果为 true：当值大于 1 时，按“百分比数值”除以 100（例如 13 -> 0.13） */
    percentHeuristic?: boolean;
  },
): number {
  if (input === null || input === undefined) return NaN;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return NaN;
    return options?.percentHeuristic && input > 1 ? input / 100 : input;
  }
  const raw = String(input).trim();
  if (!raw) return NaN;

  // 处理带百分号的字符串： "13%" / " 13.0 % "
  if (raw.includes('%')) {
    const n = Number.parseFloat(raw.replace(/%/g, ''));
    return Number.isFinite(n) ? n / 100 : NaN;
  }

  // 处理带千分位的字符串： "12,345.6"
  const normalized = raw.replace(/,/g, '');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return NaN;
  return options?.percentHeuristic && n > 1 ? n / 100 : n;
}

/**
 * 把输入解析为“比例（0~1）”，常用于空置率。
 *
 * 逻辑来源：`_legacy_v1/map.html` 对 `vRaw` 的兼容解析。
 * - "13%" => 0.13
 * - 0.13 => 0.13
 * - 13 => 0.13
 */
export function parseRate(input: NumericLike): number {
  // 先按百分号优先解析；否则对 >1 的数做 /100 的启发式处理
  return parseNumberLike(input, { percentHeuristic: true });
}

/**
 * 计算净有效租金（Net Effective Rent, NER）。
 *
 * 旧版公式（`_legacy_v1/update.html`）：
 * - 三年租约默认 36 个月
 * - NER = 表面租金 * (36 - 免租月) / 36
 *
 * @param faceRent 表面租金（例如 元/㎡/天 或 元/㎡/月；单位由调用方统一）
 * @param freeMonths 免租期（月）
 * @param leaseMonths 租约总月数，默认 36（与旧版一致）
 * @returns 净有效租金（与 faceRent 同单位）；若输入不合法抛错
 */
export function calculateNetEffectiveRent(params: {
  faceRent: NumericLike;
  freeMonths: NumericLike;
  leaseMonths?: NumericLike;
}): number {
  const leaseMonthsRaw = params.leaseMonths ?? 36;
  const faceRent = parseNumberLike(params.faceRent);
  const freeMonths = parseNumberLike(params.freeMonths);
  const leaseMonths = parseNumberLike(leaseMonthsRaw);

  if (!Number.isFinite(faceRent)) throw new TypeError('表面租金(faceRent)不是有效数字');
  if (!Number.isFinite(freeMonths)) throw new TypeError('免租期(freeMonths)不是有效数字');
  if (!Number.isFinite(leaseMonths)) throw new TypeError('租约月数(leaseMonths)不是有效数字');
  if (leaseMonths <= 0) throw new RangeError('租约月数(leaseMonths)必须大于 0');
  if (faceRent < 0) throw new RangeError('表面租金(faceRent)不能为负数');
  if (freeMonths < 0) throw new RangeError('免租期(freeMonths)不能为负数');
  if (freeMonths > leaseMonths) throw new RangeError('免租期(freeMonths)不能大于租约月数(leaseMonths)');

  return (faceRent * (leaseMonths - freeMonths)) / leaseMonths;
}

/**
 * 净有效租金的“安全版本”：输入不合法时返回 null（用于 UI 容错展示）。
 */
export function calculateNetEffectiveRentSafe(params: {
  faceRent: NumericLike;
  freeMonths: NumericLike;
  leaseMonths?: NumericLike;
}): number | null {
  try {
    const v = calculateNetEffectiveRent(params);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 计算空置率（Vacancy Rate）。
 *
 * 旧版来源（`_legacy_v1/update.html`）：
 * - vacRate = vacArea / totalArea
 * - UI 展示时再 *100 并保留 1 位小数
 *
 * @returns 0~1 的比例；若输入不合法抛错
 */
export function calculateVacancyRate(params: {
  vacantArea: NumericLike;
  totalArea: NumericLike;
  /**
   * 是否把结果限制在 [0, 1]（对上游数据偶发异常更“温和”）。
   * 默认 true：更符合“错误边界处理”的预期。
   */
  clamp?: boolean;
}): number {
  const vacantArea = parseNumberLike(params.vacantArea);
  const totalArea = parseNumberLike(params.totalArea);
  const clamp = params.clamp ?? true;

  if (!Number.isFinite(vacantArea)) throw new TypeError('空置面积(vacantArea)不是有效数字');
  if (!Number.isFinite(totalArea)) throw new TypeError('总面积(totalArea)不是有效数字');
  if (vacantArea < 0) throw new RangeError('空置面积(vacantArea)不能为负数');
  if (totalArea <= 0) throw new RangeError('总面积(totalArea)必须大于 0');

  const rate = vacantArea / totalArea;
  if (!Number.isFinite(rate)) throw new RangeError('空置率计算结果不是有限数值');
  if (!clamp) return rate;
  return Math.min(1, Math.max(0, rate));
}

/**
 * 空置率“安全版本”：输入不合法时返回 null（用于 UI 中显示为 '-'）。
 */
export function calculateVacancyRateSafe(params: {
  vacantArea: NumericLike;
  totalArea: NumericLike;
  clamp?: boolean;
}): number | null {
  try {
    const v = calculateVacancyRate(params);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 计算环比变化率（例如租金环比）。
 *
 * 旧版来源：`_legacy_v1/update.html`
 * - change = (current - last) / last
 *
 * @returns 比例（例如 0.035 表示 +3.5%）；当 last<=0 或输入无效时抛错
 */
export function calculateRateChange(params: { current: NumericLike; previous: NumericLike }): number {
  const current = parseNumberLike(params.current);
  const previous = parseNumberLike(params.previous);

  if (!Number.isFinite(current)) throw new TypeError('当前值(current)不是有效数字');
  if (!Number.isFinite(previous)) throw new TypeError('对比值(previous)不是有效数字');
  if (previous === 0) throw new RangeError('对比值(previous)为 0，无法计算变化率');

  return (current - previous) / previous;
}

/**
 * 变化率“安全版本”：无法计算时返回 null。
 */
export function calculateRateChangeSafe(params: { current: NumericLike; previous: NumericLike }): number | null {
  try {
    const v = calculateRateChange(params);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 计算面积变化（当前空置面积 - 上期空置面积）。
 *
 * 旧版来源：`_legacy_v1/update.html` 的 `areaDiff = vacArea - lastVacArea`
 */
export function calculateAreaDiff(params: { currentArea: NumericLike; previousArea: NumericLike }): number {
  const current = parseNumberLike(params.currentArea);
  const previous = parseNumberLike(params.previousArea);

  if (!Number.isFinite(current)) throw new TypeError('当前面积(currentArea)不是有效数字');
  if (!Number.isFinite(previous)) throw new TypeError('对比面积(previousArea)不是有效数字');
  return current - previous;
}

/**
 * 计算“按面积加权”的平均租金（用于地图统计面板）。
 *
 * 旧版来源：`_legacy_v1/map.html` 的 `updateDashboard`：
 * - rentWeightSum += pCurrent * totalArea
 * - weightedAvg = rentWeightSum / totalValidRentArea
 *
 * @returns 平均值；当不存在有效样本时返回 null
 */
export function calculateWeightedAverageRent<T>(items: T[], pick: (item: T) => { rent: NumericLike; area: NumericLike }): number | null {
  let areaSum = 0;
  let weightedSum = 0;
  for (const it of items) {
    const { rent, area } = pick(it);
    const r = parseNumberLike(rent);
    const a = parseNumberLike(area);
    if (!Number.isFinite(r) || !Number.isFinite(a)) continue;
    if (r <= 0 || a <= 0) continue;
    areaSum += a;
    weightedSum += r * a;
  }
  if (areaSum <= 0) return null;
  const avg = weightedSum / areaSum;
  return Number.isFinite(avg) ? avg : null;
}

/**
 * 计算整体空置率（汇总层面）。
 *
 * 旧版来源：`_legacy_v1/map.html` 的 `overallVacRate = totalVacArea / totalArea`
 *
 * @returns 0~1 的比例；当总面积无效时返回 null
 */
export function calculateOverallVacancyRate(params: { totalVacantArea: NumericLike; totalArea: NumericLike; clamp?: boolean }): number | null {
  const totalVacantArea = parseNumberLike(params.totalVacantArea);
  const totalArea = parseNumberLike(params.totalArea);
  const clamp = params.clamp ?? true;

  if (!Number.isFinite(totalVacantArea) || !Number.isFinite(totalArea)) return null;
  if (totalArea <= 0) return null;
  if (totalVacantArea < 0) return null;

  const r = totalVacantArea / totalArea;
  if (!Number.isFinite(r)) return null;
  if (!clamp) return r;
  return Math.min(1, Math.max(0, r));
}

/**
 * 把日期格式化为 `MM-DD`（旧版门户留言墙的展示方式）。
 *
 * 旧版来源：`_legacy_v1/index.html`：
 * - `m.date ? m.date.substring(5) : ''`
 *
 * 错误边界：
 * - 输入若不是 `YYYY-MM-DD`（或更长但前 10 位可用），会尽量“保守返回空字符串”避免 UI 崩坏。
 */
export function formatDateToMMDD(dateLike: string | null | undefined): string {
  if (!dateLike) return '';
  const s = String(dateLike).trim();
  if (s.length < 10) return '';
  // 允许 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm:ss..." 等
  const ymd = s.slice(0, 10);
  // 粗校验：4位年-2位月-2位日
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  return ymd.substring(5);
}

/**
 * 把 Date 格式化为 `HH:mm`（用于“云端保存时间”这类 UI 展示）。
 *
 * 旧版来源：`_legacy_v1/update.html`：
 * - `new Date().toTimeString().substring(0, 5)`
 */
export function formatTimeToHHMM(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 将比例格式化为百分数字符串（保留 1 位小数），用于 UI 展示。
 * - 输入为 0.1234 => "12.3%"
 * - 输入非法 => "-"
 */
export function formatRatePercent(rate: NumericLike, digits = 1): string {
  const r = parseNumberLike(rate);
  if (!Number.isFinite(r)) return '-';
  const p = r * 100;
  if (!Number.isFinite(p)) return '-';
  return `${p.toFixed(digits)}%`;
}

