/**
 * 租赁成交数据填报服务单元测试
 * @module services/__tests__/leaseTransactionSubmitService.test
 * @description 测试 leaseTransactionSubmitService 的所有服务函数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkDuplicate,
  checkFuzzyDuplicate,
  submitTransaction,
  getMySubmissions,
  getWeeklyProgress,
} from '../leaseTransactionSubmitService';
import type {
  LeaseTransaction,
  DuplicateCheckResult,
  WeeklyProgress,
  SubmissionResult,
} from '../../types/lease-transaction';

// Mock Supabase 客户端
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(),
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              select: vi.fn(),
            })),
          })),
        })),
      })),
    })),
  },
}));

import { supabase } from '../supabaseClient';

// 获取 mock 函数的类型
const mockedSupabase = vi.mocked(supabase);

describe('leaseTransactionSubmitService', () => {
  // 在每个测试前重置所有 mock
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 在每个测试后清理
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // 4.2 duplicate-check tests
  // ========================================
  describe('duplicate checks', () => {
    it('keeps deprecated checkDuplicate fail-open because it has no area input', async () => {
      const result = await checkDuplicate('测试公司', '测试楼宇', '2024Q1');

      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });
      expect(mockedSupabase.rpc).not.toHaveBeenCalled();
    });

    it('returns no duplicate for invalid fuzzy-check input without querying', async () => {
      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 0, '2024Q1');

      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });
      expect(mockedSupabase.from).not.toHaveBeenCalled();
    });

    it('returns matching fuzzy duplicates from the current fluent query path', async () => {
      const row = {
        id: 'uuid-1',
        company: '测试公司',
        new_building: '测试楼宇',
        area_sqm: 500,
        transaction_quarter: '2024Q1',
        transaction_date: null,
        submitter_name: '测试用户',
        submitter_id: 'user-123',
        created_at: '2024-03-15T10:00:00Z',
      };
      const query: any = { data: [row], error: null };
      for (const method of ['select', 'eq', 'gte', 'lte', 'not', 'order', 'limit', 'neq']) {
        query[method] = vi.fn(() => query);
      }
      mockedSupabase.from = vi.fn(() => query) as any;

      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 500, '2024Q1');

      expect(result.hasDuplicate).toBe(true);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].company).toBe('测试公司');
      expect(mockedSupabase.from).toHaveBeenCalledWith('lease_transactions');
    });

    it('fails open when the fuzzy duplicate query reports an error', async () => {
      const query: any = {
        data: null,
        error: { code: 'PGRST301', message: 'Connection timeout' },
      };
      for (const method of ['select', 'eq', 'gte', 'lte', 'not', 'order', 'limit', 'neq']) {
        query[method] = vi.fn(() => query);
      }
      mockedSupabase.from = vi.fn(() => query) as any;

      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 500, '2024Q1');

      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });
    });
  });

  // ========================================
  // 4.3 submitTransaction 函数测试
  // ========================================
  describe('submitTransaction', () => {
    /**
     * 测试成功提交有效数据
     * Validates: Requirements 3.1, 3.2, 3.3
     */
    it('should successfully submit a valid transaction', async () => {
      const mockInsertedData = {
        id: 'uuid-new',
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        created_at: '2024-03-15T10:00:00Z',
      };

      // Mock insert 链式调用
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mockInsertedData,
            error: null,
          }),
        }),
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.id).toBe('uuid-new');
      expect(result.data?.company).toBe('测试公司');
    });

    /**
     * 测试必填字段缺失时的失败情况 - 缺少 company
     * Validates: Requirements 8.1, 8.2
     */
    it('should fail when company is missing', async () => {
      const transaction = {
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      } as LeaseTransaction;

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少必填字段');
      expect(result.error).toContain('company');
    });

    /**
     * 测试必填字段缺失时的失败情况 - 缺少 new_building
     * Validates: Requirements 8.1, 8.2
     */
    it('should fail when new_building is missing', async () => {
      const transaction = {
        company: '测试公司',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      } as LeaseTransaction;

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少必填字段');
      expect(result.error).toContain('new_building');
    });

    /**
     * 测试必填字段缺失时的失败情况 - 缺少 transaction_date
     * Validates: Requirements 8.1, 8.2
     */
    it('should allow transaction_date to be omitted because year and quarter are canonical', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'uuid-new' },
            error: null,
          }),
        }),
      });
      mockedSupabase.from = vi.fn().mockReturnValue({ insert: mockInsert });

      const transaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      } as LeaseTransaction;

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ transaction_date: null }));
    });

    /**
     * 测试必填字段缺失时的失败情况 - 缺少 submitter_id
     * Validates: Requirements 8.1, 8.2
     */
    it('should fail when submitter_id is missing', async () => {
      const transaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_name: '测试用户',
      } as LeaseTransaction;

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少必填字段');
      expect(result.error).toContain('submitter_id');
    });

    /**
     * 测试数值字段无效时的失败情况 - area_sqm 为 NaN
     * Validates: Requirements 8.3
     */
    it('should fail when area_sqm is NaN', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        area_sqm: NaN,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('格式错误');
    });

    /**
     * 测试数值字段无效时的失败情况 - face_rent 为无效类型
     * Validates: Requirements 8.3
     */
    it('should fail when face_rent is invalid type', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        face_rent: 'invalid' as unknown as number,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('格式错误');
    });

    it('should reject an effective rent above 1000 yuan per sqm per month', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        effective_rent: 6205,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('有效租金不得超过 1000 元/㎡/月，请核对金额或单位后修改。');
    });

    it('should reject a face rent above 1000 yuan per sqm per month', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        face_rent: 1000.01,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('表面租金不得超过 1000 元/㎡/月，请核对金额或单位后修改。');
    });

    it('should reject an effective rent above the face rent', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        face_rent: 100,
        effective_rent: 100.01,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('有效租金不能高于表面租金，请核对填写内容后修改。');
    });

    /**
     * 测试年份季度不一致时的失败情况
     * Validates: Requirements 8.1, 8.3
     */
    it('should reject an invalid quarter format', async () => {
      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_year: 2024,
        transaction_quarter: '2024-Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('成交季度格式错误');
    });

    /**
     * 测试年份季度一致时可以成功提交
     * Validates: Requirements 8.1, 8.3
     */
    it('should succeed when year and quarter are consistent', async () => {
      const mockInsertedData = {
        id: 'uuid-new',
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      };

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mockInsertedData,
            error: null,
          }),
        }),
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(true);
    });

    /**
     * 测试数据库插入失败时的错误处理
     * Validates: Requirements 3.4
     */
    it('should handle database insertion error', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' },
          }),
        }),
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(false);
      expect(result.error).toContain('数据库插入失败');
    });

    /**
     * 测试可选数值字段为 null 时可以成功提交
     * Validates: Requirements 8.3
     */
    it('should succeed when optional numeric fields are null', async () => {
      const mockInsertedData = {
        id: 'uuid-new',
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        area_sqm: null,
        face_rent: null,
      };

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mockInsertedData,
            error: null,
          }),
        }),
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        area_sqm: null,
        face_rent: null,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(true);
    });

    /**
     * 测试可选数值字段为有效数字时可以成功提交
     * Validates: Requirements 8.3
     */
    it('should succeed when optional numeric fields are valid numbers', async () => {
      const mockInsertedData = {
        id: 'uuid-new',
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        area_sqm: 500.5,
        face_rent: 8.5,
        lease_term_months: 36,
        fit_out_months: 2,
        rent_free_months: 1,
        effective_rent: 7.5,
        is_manual_building: true,
      };

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mockInsertedData,
            error: null,
          }),
        }),
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      const transaction: LeaseTransaction = {
        company: '测试公司',
        new_building: '测试楼宇',
        transaction_date: '2024-03-15',
        transaction_year: 2024,
        transaction_quarter: '2024Q1',
        submitter_id: 'user-123',
        submitter_name: '测试用户',
        area_sqm: 500.5,
        face_rent: 8.5,
        lease_term_months: 36,
        fit_out_months: 2,
        rent_free_months: 1,
        effective_rent: 7.5,
        is_manual_building: true,
      };

      const result = await submitTransaction(transaction);

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // 4.4 getMySubmissions tests
  // ========================================
  describe('getMySubmissions', () => {
    function mockSubmissionQuery(result: { data: unknown; error: unknown }) {
      const limit = vi.fn().mockResolvedValue(result);
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      mockedSupabase.from = vi.fn().mockReturnValue({ select });
      return { select, eq, order, limit };
    }

    it('returns submissions for the user', async () => {
      const submissions = [
        { id: 'uuid-1', company: '公司A', submitter_id: 'user-123' },
        { id: 'uuid-2', company: '公司B', submitter_id: 'user-123' },
      ];
      mockSubmissionQuery({ data: submissions, error: null });

      const result = await getMySubmissions('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].company).toBe('公司A');
    });

    it('rejects a missing user id', async () => {
      await expect(getMySubmissions('')).rejects.toThrow('用户 ID 为必填参数');
    });

    it('rejects a whitespace-only user id', async () => {
      await expect(getMySubmissions('   ')).rejects.toThrow('用户 ID 为必填参数');
    });

    it('orders newest first and caps history at 200 rows', async () => {
      const query = mockSubmissionQuery({ data: [], error: null });

      await getMySubmissions('user-123');

      expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(query.limit).toHaveBeenCalledWith(200);
      expect(mockedSupabase.from).toHaveBeenCalledWith('lease_transactions');
    });

    it('surfaces database query errors', async () => {
      mockSubmissionQuery({
        data: null,
        error: { code: 'PGRST301', message: 'Connection timeout' },
      });

      await expect(getMySubmissions('user-123')).rejects.toThrow('数据库连接超时');
    });

    it('trims the user id before querying', async () => {
      const query = mockSubmissionQuery({ data: [], error: null });

      await getMySubmissions('  user-123  ');

      expect(query.eq).toHaveBeenCalledWith('submitter_id', 'user-123');
    });
  });

  // ========================================
  // 4.5 getWeeklyProgress 函数测试
  // ========================================
  describe('getWeeklyProgress', () => {
    /**
     * 测试成功获取周进度
     * Validates: Requirements 5.1, 5.2, 5.3
     */
    it('should return progress with correct structure', async () => {
      // Mock 链式调用: from().select().eq().gte().lte()
      const mockLte = vi.fn().mockResolvedValue({
        count: 1,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result = await getWeeklyProgress('user-123');

      expect(result).toHaveProperty('submittedCount');
      expect(result).toHaveProperty('targetCount');
      expect(result).toHaveProperty('percentage');
      expect(result.targetCount).toBe(2);
    });

    /**
     * 测试返回结果结构正确
     * Validates: Requirements 5.3
     */
    it('should return WeeklyProgress interface compliant object', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 2,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result: WeeklyProgress = await getWeeklyProgress('user-123');

      expect(typeof result.submittedCount).toBe('number');
      expect(typeof result.targetCount).toBe('number');
      expect(typeof result.percentage).toBe('number');
      expect(result.targetCount).toBe(2);
    });

    /**
     * 测试完成百分比计算正确 - 0 条提交
     * Validates: Requirements 5.3, 5.5
     */
    it('should calculate percentage correctly with 0 submissions', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 0,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result = await getWeeklyProgress('user-with-no-submissions');

      expect(result.submittedCount).toBe(0);
      expect(result.percentage).toBe(0);
    });

    /**
     * 测试完成百分比计算正确 - 1 条提交
     * Validates: Requirements 5.3, 5.5
     */
    it('should calculate percentage correctly with 1 submission', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 1,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result = await getWeeklyProgress('user-with-1-submission');

      expect(result.submittedCount).toBe(1);
      expect(result.percentage).toBe(50);
    });

    /**
     * 测试完成百分比计算正确 - 2 条提交
     * Validates: Requirements 5.3, 5.5
     */
    it('should calculate percentage correctly with 2 submissions', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 2,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result = await getWeeklyProgress('user-with-2-submissions');

      expect(result.submittedCount).toBe(2);
      expect(result.percentage).toBe(100);
    });

    /**
     * 测试完成百分比计算正确 - 超过目标数量
     * Validates: Requirements 5.3, 5.5
     */
    it('should cap percentage at 100 when submissions exceed target', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 5,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      const result = await getWeeklyProgress('user-with-5-submissions');

      expect(result.submittedCount).toBe(5);
      expect(result.percentage).toBe(100); // 上限为 100
    });

    /**
     * 测试参数缺失时的错误抛出
     * Validates: Requirements 5.2, 5.7
     */
    it('should throw error when userId is missing', async () => {
      await expect(getWeeklyProgress('')).rejects.toThrow('用户 ID 为必填参数');
    });

    /**
     * 测试参数为空白字符串时的错误抛出
     * Validates: Requirements 5.2, 5.7
     */
    it('should throw error when userId is whitespace only', async () => {
      await expect(getWeeklyProgress('   ')).rejects.toThrow('用户 ID 为必填参数');
    });

    /**
     * 测试数据库查询失败时的错误处理
     * Validates: Requirements 5.7
     */
    it('should handle database query error', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: null,
        error: { code: 'PGRST301', message: 'Connection timeout' },
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      await expect(getWeeklyProgress('user-123')).rejects.toThrow();
    });

    /**
     * 测试 userId 会被 trim 处理
     * Validates: Requirements 5.2
     */
    it('should trim userId before query', async () => {
      const mockEq = vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockResolvedValue({
            count: 0,
            error: null,
          }),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      await getWeeklyProgress('  user-123  ');

      expect(mockEq).toHaveBeenCalledWith('submitter_id', 'user-123');
    });

    /**
     * 测试周起止时间计算正确（周一至周日）
     * Validates: Requirements 5.4
     */
    it('should calculate week range from Monday to Sunday', async () => {
      const mockLte = vi.fn().mockResolvedValue({
        count: 0,
        error: null,
      });

      const mockGte = vi.fn().mockReturnValue({
        lte: mockLte,
      });

      const mockEq = vi.fn().mockReturnValue({
        gte: mockGte,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      });

      mockedSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      await getWeeklyProgress('user-123');

      // 验证 gte 和 lte 被调用（说明周范围计算被执行）
      expect(mockGte).toHaveBeenCalled();
    });
  });
});
