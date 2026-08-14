/**
 * 数据清洗工具函数单元测试
 * @module utils/__tests__/dataCleaners.test
 */

import { describe, it, expect } from 'vitest';
import {
  cleanNumericValue,
  cleanDistrict,
  cleanBuildingName,
  cleanNumericFields,
  validateNumericValue,
} from '../dataCleaners';

describe('dataCleaners', () => {
  describe('cleanNumericValue', () => {
    it('should clean numeric value with unit symbols', () => {
      expect(cleanNumericValue('500㎡')).toBe(500);
      expect(cleanNumericValue('8.5元')).toBe(8.5);
      expect(cleanNumericValue('1,000')).toBe(1000);
      expect(cleanNumericValue('1,234.56元')).toBe(1234.56);
    });

    it('should handle already numeric values', () => {
      expect(cleanNumericValue(500)).toBe(500);
      expect(cleanNumericValue(8.5)).toBe(8.5);
    });

    it('should return null for invalid values', () => {
      expect(cleanNumericValue('abc')).toBeNull();
      expect(cleanNumericValue('')).toBeNull();
      expect(cleanNumericValue(null)).toBeNull();
      expect(cleanNumericValue(undefined)).toBeNull();
    });

    it('should handle values with spaces', () => {
      expect(cleanNumericValue(' 500 ')).toBe(500);
      expect(cleanNumericValue('1 000')).toBe(1000);
    });

    it('should handle NaN', () => {
      expect(cleanNumericValue(NaN)).toBeNull();
    });
  });

  describe('cleanDistrict', () => {
    it('should remove "北京市" prefix', () => {
      expect(cleanDistrict('北京市朝阳区')).toBe('朝阳区');
      expect(cleanDistrict('北京市海淀区')).toBe('海淀区');
    });

    it('should remove "北京-" prefix', () => {
      expect(cleanDistrict('北京-朝阳区')).toBe('朝阳区');
      expect(cleanDistrict('北京-海淀区')).toBe('海淀区');
    });

    it('should remove "北京" prefix', () => {
      expect(cleanDistrict('北京朝阳区')).toBe('朝阳区');
    });

    it('should handle already clean district names', () => {
      expect(cleanDistrict('朝阳区')).toBe('朝阳区');
      expect(cleanDistrict('海淀区')).toBe('海淀区');
    });

    it('should return null for invalid values', () => {
      expect(cleanDistrict(null)).toBeNull();
      expect(cleanDistrict(undefined)).toBeNull();
      expect(cleanDistrict('')).toBeNull();
    });

    it('should trim whitespace', () => {
      expect(cleanDistrict(' 朝阳区 ')).toBe('朝阳区');
      expect(cleanDistrict('北京市 朝阳区 ')).toBe('朝阳区');
    });
  });

  describe('cleanBuildingName', () => {
    it('should normalize whitespace', () => {
      expect(cleanBuildingName('国贸  大厦')).toBe('国贸 大厦');
      expect(cleanBuildingName('  国贸大厦  ')).toBe('国贸大厦');
    });

    it('should return null for invalid values', () => {
      expect(cleanBuildingName(null)).toBeNull();
      expect(cleanBuildingName(undefined)).toBeNull();
      expect(cleanBuildingName('')).toBeNull();
    });
  });

  describe('cleanNumericFields', () => {
    it('should clean multiple numeric fields', () => {
      const data = {
        area: '500㎡',
        rent: '8.5元',
        name: '测试',
      };

      const cleaned = cleanNumericFields(data, ['area', 'rent']);

      expect(cleaned.area).toBe(500);
      expect(cleaned.rent).toBe(8.5);
      expect(cleaned.name).toBe('测试');
    });

    it('should handle null and undefined values', () => {
      const data = {
        area: null,
        rent: undefined,
        name: '测试',
      };

      const cleaned = cleanNumericFields(data, ['area', 'rent']);

      expect(cleaned.area).toBeNull();
      expect(cleaned.rent).toBeUndefined();
    });
  });

  describe('validateNumericValue', () => {
    it('should validate required fields', () => {
      const result1 = validateNumericValue(null, '面积', { required: true });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('必填项');

      const result2 = validateNumericValue(500, '面积', { required: true });
      expect(result2.valid).toBe(true);
    });

    it('should validate minimum value', () => {
      const result1 = validateNumericValue(-10, '面积', { min: 0 });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('不能小于');

      const result2 = validateNumericValue(10, '面积', { min: 0 });
      expect(result2.valid).toBe(true);
    });

    it('should validate maximum value', () => {
      const result1 = validateNumericValue(1000000, '面积', { max: 100000 });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('不能大于');

      const result2 = validateNumericValue(50000, '面积', { max: 100000 });
      expect(result2.valid).toBe(true);
    });

    it('should allow null for non-required fields', () => {
      const result = validateNumericValue(null, '面积', { required: false });
      expect(result.valid).toBe(true);
    });
  });
});
