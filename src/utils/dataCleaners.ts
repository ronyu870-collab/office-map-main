/**
 * 数据清洗工具函数
 * @module utils/dataCleaners
 * @description 提供统一的数据清洗和格式化函数
 */

/**
 * 清洗数值字段（移除单位符号和千分位逗号）
 * @param value 原始值（可能包含单位符号）
 * @returns 清洗后的数字，如果无法转换则返回 null
 * @example
 * cleanNumericValue('500㎡') // 500
 * cleanNumericValue('8.5元') // 8.5
 * cleanNumericValue('1,000') // 1000
 * cleanNumericValue('abc') // null
 */
export function cleanNumericValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // 如果已经是数字，直接返回
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  // 移除常见单位符号和千分位逗号
  const cleaned = String(value)
    .replace(/[㎡平方米元月人民币￥$]/g, '') // 移除单位符号
    .replace(/,/g, '')                        // 移除千分位逗号
    .replace(/\s+/g, '')                      // 移除空格
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 清洗行政区字段（移除"北京市"、"北京-"等冗余前缀）
 * @param district 原始行政区名称
 * @returns 清洗后的行政区名称
 * @example
 * cleanDistrict('北京市朝阳区') // '朝阳区'
 * cleanDistrict('北京-海淀区') // '海淀区'
 * cleanDistrict('朝阳区') // '朝阳区'
 */
export function cleanDistrict(district: string | null | undefined): string | null {
  if (!district || typeof district !== 'string') {
    return null;
  }

  return district
    .replace(/^北京市/, '')   // 移除"北京市"前缀
    .replace(/^北京-/, '')    // 移除"北京-"前缀
    .replace(/^北京/, '')     // 移除"北京"前缀
    .trim();
}

/**
 * 清洗楼宇名称（移除多余空格和特殊字符）
 * @param buildingName 原始楼宇名称
 * @returns 清洗后的楼宇名称
 */
export function cleanBuildingName(buildingName: string | null | undefined): string | null {
  if (!buildingName || typeof buildingName !== 'string') {
    return null;
  }

  return buildingName
    .replace(/\s+/g, ' ')  // 多个空格替换为单个空格
    .trim();
}

/**
 * 批量清洗数值字段
 * @param data 包含数值字段的对象
 * @param fields 需要清洗的字段名数组
 * @returns 清洗后的对象
 */
export function cleanNumericFields<T extends Record<string, any>>(
  data: T,
  fields: (keyof T)[]
): T {
  const cleaned = { ...data };
  
  for (const field of fields) {
    const value = cleaned[field];
    if (value !== undefined && value !== null) {
      const cleanedValue = cleanNumericValue(value as any);
      cleaned[field] = cleanedValue as any;
    }
  }
  
  return cleaned;
}

/**
 * 验证清洗后的数值是否有效
 * @param value 清洗后的数值
 * @param fieldName 字段名（用于错误提示）
 * @param options 验证选项
 * @returns 验证结果
 */
export function validateNumericValue(
  value: number | null,
  fieldName: string,
  options?: {
    required?: boolean;
    min?: number;
    max?: number;
  }
): { valid: boolean; error?: string } {
  const { required = false, min, max } = options || {};

  // 必填校验
  if (required && (value === null || value === undefined)) {
    return { valid: false, error: `${fieldName}为必填项` };
  }

  // 如果值为空且非必填，则通过
  if (value === null || value === undefined) {
    return { valid: true };
  }

  // 最小值校验
  if (min !== undefined && value < min) {
    return { valid: false, error: `${fieldName}不能小于 ${min}` };
  }

  // 最大值校验
  if (max !== undefined && value > max) {
    return { valid: false, error: `${fieldName}不能大于 ${max}` };
  }

  return { valid: true };
}
