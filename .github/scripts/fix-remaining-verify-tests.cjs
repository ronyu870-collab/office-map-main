const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(source, oldText, newText, label) {
  if (!source.includes(oldText)) {
    throw new Error(`Expected source not found for ${label}`);
  }
  return source.replace(oldText, newText);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Markers not found for ${label}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

// -----------------------------------------------------------------------------
// page-scroll-layout-preservation.test.tsx
// -----------------------------------------------------------------------------
{
  const path = 'src/__tests__/page-scroll-layout-preservation.test.tsx';
  let source = read(path);

  source = replaceOnce(
    source,
    `const navigationMocks = vi.hoisted(() => ({\n  useRouter: vi.fn(),\n  useSearchParams: vi.fn(),\n  usePathname: vi.fn(),\n}));`,
    `const navigationMocks = vi.hoisted(() => ({\n  useRouter: vi.fn(),\n  useSearchParams: vi.fn(),\n  usePathname: vi.fn(),\n}));\n\nconst supabaseMocks = vi.hoisted(() => ({\n  getSession: vi.fn(),\n  from: vi.fn(),\n}));`,
    'hoisted Supabase test controls',
  );

  source = replaceOnce(
    source,
    `vi.mock('next/navigation', () => ({\n  useRouter: navigationMocks.useRouter,\n  useSearchParams: navigationMocks.useSearchParams,\n  usePathname: navigationMocks.usePathname,\n}));`,
    `vi.mock('next/navigation', () => ({\n  useRouter: navigationMocks.useRouter,\n  useSearchParams: navigationMocks.useSearchParams,\n  usePathname: navigationMocks.usePathname,\n}));\n\nvi.mock('@/src/services/supabaseClient', () => ({\n  supabase: {\n    auth: { getSession: supabaseMocks.getSession },\n    from: supabaseMocks.from,\n  },\n}));`,
    'Supabase module mock',
  );

  source = source
    .replace(/id: i,\n      '写字楼名称'/g, "id: `building-${i}`,\n      name: `Building ${i}`,\n      submarket: 'CBD',\n      grade: 'A',\n      '写字楼名称'");

  source = replaceOnce(
    source,
    `  beforeEach(() => {\n    navigationMocks.useRouter.mockReturnValue({`,
    `  beforeEach(async () => {\n    navigationMocks.useRouter.mockReturnValue({`,
    'async beforeEach',
  );

  source = replaceOnce(
    source,
    `    navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams());\n    navigationMocks.usePathname.mockReturnValue('/');\n\n    // Reset viewport`,
    `    navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams());\n    navigationMocks.usePathname.mockReturnValue('/');\n\n    const session = {\n      user: {\n        id: 'user-123',\n        email: 'test@example.com',\n        user_metadata: { full_name: 'Test User' },\n      },\n      displayName: 'Test User',\n      role: 'editor',\n    };\n    const { getSession, getSessionFast } = await import('@/src/services/Auth');\n    vi.mocked(getSession).mockResolvedValue(session as any);\n    vi.mocked(getSessionFast).mockResolvedValue(session as any);\n\n    supabaseMocks.getSession.mockResolvedValue({\n      data: { session: { user: session.user, access_token: 'test-token' } },\n      error: null,\n    });\n\n    const makeQuery = (data: unknown) => {\n      const query: any = { data, error: null };\n      for (const method of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte', 'not', 'neq', 'ilike']) {\n        query[method] = vi.fn(() => query);\n      }\n      query.single = vi.fn(async () => ({ data, error: null }));\n      query.maybeSingle = vi.fn(async () => ({ data, error: null }));\n      return query;\n    };\n\n    const roleQuery = makeQuery({ role: 'editor' });\n    const assignmentQuery = makeQuery([{ building_id: 'building-0' }]);\n    const emptyQuery = makeQuery([]);\n    supabaseMocks.from.mockImplementation((table: string) => {\n      if (table === 'user_roles') return roleQuery;\n      if (table === 'building_assignments') return assignmentQuery;\n      return emptyQuery;\n    });\n\n    // Reset viewport`,
    'deterministic Auth and Supabase reset',
  );

  source = source.replace(
    /user: \{ email: 'admin@example\.com', user_metadata: \{ full_name: 'Admin User' \} \}/g,
    "user: { id: 'admin-123', email: 'admin@example.com', user_metadata: { full_name: 'Admin User' } }",
  );

  source = replaceOnce(
    source,
    `expect(screen.queryByText('系统管理后台')).toBeInTheDocument();`,
    `expect(screen.queryByText('数据库管理')).toBeInTheDocument();`,
    'current admin UI assertion',
  );

  source = replaceOnce(
    source,
    `      await waitFor(() => {\n        expect(screen.queryByText('季度数据填报')).toBeInTheDocument();\n      }, { timeout: 3000 });\n      \n      const pageContainer = container.firstChild as HTMLElement;\n      const tableContainer = pageContainer?.querySelector('.overflow-auto');`,
    `      await waitFor(() => {\n        expect(screen.queryByText('季度数据填报')).toBeInTheDocument();\n        expect(container.querySelector('.overflow-auto')).toBeTruthy();\n      }, { timeout: 3000 });\n      \n      const pageContainer = container.firstChild as HTMLElement;\n      const tableContainer = pageContainer?.querySelector('.overflow-auto');`,
    'wait for loaded update table',
  );

  write(path, source);
}

// -----------------------------------------------------------------------------
// leaseTransactionSubmitService.test.ts
// -----------------------------------------------------------------------------
{
  const path = 'src/services/__tests__/leaseTransactionSubmitService.test.ts';
  let source = read(path);

  source = replaceOnce(
    source,
    `  checkDuplicate,\n  submitTransaction,`,
    `  checkDuplicate,\n  checkFuzzyDuplicate,\n  submitTransaction,`,
    'import checkFuzzyDuplicate',
  );

  const checkStart = `  // ========================================\n  // 4.2 checkDuplicate 函数测试`;
  const submitStart = `  // ========================================\n  // 4.3 submitTransaction 函数测试`;
  const checkReplacement = `  // ========================================\n  // 4.2 duplicate-check tests\n  // ========================================\n  describe('duplicate checks', () => {\n    it('keeps deprecated checkDuplicate fail-open because it has no area input', async () => {\n      const result = await checkDuplicate('测试公司', '测试楼宇', '2024Q1');\n\n      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });\n      expect(mockedSupabase.rpc).not.toHaveBeenCalled();\n    });\n\n    it('returns no duplicate for invalid fuzzy-check input without querying', async () => {\n      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 0, '2024Q1');\n\n      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });\n      expect(mockedSupabase.from).not.toHaveBeenCalled();\n    });\n\n    it('returns matching fuzzy duplicates from the current fluent query path', async () => {\n      const row = {\n        id: 'uuid-1',\n        company: '测试公司',\n        new_building: '测试楼宇',\n        area_sqm: 500,\n        transaction_quarter: '2024Q1',\n        transaction_date: null,\n        submitter_name: '测试用户',\n        submitter_id: 'user-123',\n        created_at: '2024-03-15T10:00:00Z',\n      };\n      const query: any = { data: [row], error: null };\n      for (const method of ['select', 'eq', 'gte', 'lte', 'not', 'order', 'limit', 'neq']) {\n        query[method] = vi.fn(() => query);\n      }\n      mockedSupabase.from = vi.fn(() => query) as any;\n\n      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 500, '2024Q1');\n\n      expect(result.hasDuplicate).toBe(true);\n      expect(result.duplicates).toHaveLength(1);\n      expect(result.duplicates[0].company).toBe('测试公司');\n      expect(mockedSupabase.from).toHaveBeenCalledWith('lease_transactions');\n    });\n\n    it('fails open when the fuzzy duplicate query reports an error', async () => {\n      const query: any = {\n        data: null,\n        error: { code: 'PGRST301', message: 'Connection timeout' },\n      };\n      for (const method of ['select', 'eq', 'gte', 'lte', 'not', 'order', 'limit', 'neq']) {\n        query[method] = vi.fn(() => query);\n      }\n      mockedSupabase.from = vi.fn(() => query) as any;\n\n      const result = await checkFuzzyDuplicate('测试公司', '测试楼宇', 500, '2024Q1');\n\n      expect(result).toEqual({ hasDuplicate: false, duplicates: [] });\n    });\n  });\n\n`;
  source = replaceBetween(source, checkStart, submitStart, checkReplacement, 'duplicate test block');

  const dateTestStart = `    it('should fail when transaction_date is missing', async () => {`;
  const submitterComment = `    /**\n     * 测试必填字段缺失时的失败情况 - 缺少 submitter_id`;
  const dateTestReplacement = `    it('should allow transaction_date to be omitted because year and quarter are canonical', async () => {\n      const mockInsert = vi.fn().mockReturnValue({\n        select: vi.fn().mockReturnValue({\n          single: vi.fn().mockResolvedValue({\n            data: { id: 'uuid-new' },\n            error: null,\n          }),\n        }),\n      });\n      mockedSupabase.from = vi.fn().mockReturnValue({ insert: mockInsert });\n\n      const transaction = {\n        company: '测试公司',\n        new_building: '测试楼宇',\n        transaction_year: 2024,\n        transaction_quarter: '2024Q1',\n        submitter_id: 'user-123',\n        submitter_name: '测试用户',\n      } as LeaseTransaction;\n\n      const result = await submitTransaction(transaction);\n\n      expect(result.success).toBe(true);\n      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ transaction_date: null }));\n    });\n\n`;
  source = replaceBetween(source, dateTestStart, submitterComment, dateTestReplacement, 'optional transaction_date test');

  source = source.replace(/expect\(result\.error\)\.toContain\('必须为有效数字'\);/g, "expect(result.error).toContain('格式错误');");
  source = source.replace(`      expect(result.error).toContain('area_sqm');\n`, '');

  const inconsistentStart = `    it('should fail when year and quarter are inconsistent', async () => {`;
  const consistentComment = `    /**\n     * 测试年份季度一致时可以成功提交`;
  const inconsistentReplacement = `    it('should reject an invalid quarter format', async () => {\n      const transaction: LeaseTransaction = {\n        company: '测试公司',\n        new_building: '测试楼宇',\n        transaction_year: 2024,\n        transaction_quarter: '2024-Q1',\n        submitter_id: 'user-123',\n        submitter_name: '测试用户',\n      };\n\n      const result = await submitTransaction(transaction);\n\n      expect(result.success).toBe(false);\n      expect(result.error).toContain('成交季度格式错误');\n    });\n\n`;
  source = replaceBetween(source, inconsistentStart, consistentComment, inconsistentReplacement, 'quarter validation test');

  const numericTestStart = source.indexOf(`    it('should succeed when optional numeric fields are valid numbers'`);
  if (numericTestStart < 0) throw new Error('numeric valid test not found');
  const numericTestEnd = source.indexOf(`\n    });`, numericTestStart);
  const numericBlock = source.slice(numericTestStart, numericTestEnd + 7);
  const numericUpdated = numericBlock.replace(/effective_rent: 7\.5,/g, `effective_rent: 7.5,\n        is_manual_building: true,`);
  if (numericUpdated === numericBlock) throw new Error('numeric valid transaction marker not found');
  source = source.slice(0, numericTestStart) + numericUpdated + source.slice(numericTestEnd + 7);

  const mySubmissionsStart = `  // ========================================\n  // 4.4 getMySubmissions 函数测试`;
  const weeklyStart = `  // ========================================\n  // 4.5 getWeeklyProgress 函数测试`;
  const mySubmissionsReplacement = `  // ========================================\n  // 4.4 getMySubmissions tests\n  // ========================================\n  describe('getMySubmissions', () => {\n    function mockSubmissionQuery(result: { data: unknown; error: unknown }) {\n      const limit = vi.fn().mockResolvedValue(result);\n      const order = vi.fn().mockReturnValue({ limit });\n      const eq = vi.fn().mockReturnValue({ order });\n      const select = vi.fn().mockReturnValue({ eq });\n      mockedSupabase.from = vi.fn().mockReturnValue({ select });\n      return { select, eq, order, limit };\n    }\n\n    it('returns submissions for the user', async () => {\n      const submissions = [\n        { id: 'uuid-1', company: '公司A', submitter_id: 'user-123' },\n        { id: 'uuid-2', company: '公司B', submitter_id: 'user-123' },\n      ];\n      mockSubmissionQuery({ data: submissions, error: null });\n\n      const result = await getMySubmissions('user-123');\n\n      expect(result).toHaveLength(2);\n      expect(result[0].company).toBe('公司A');\n    });\n\n    it('rejects a missing user id', async () => {\n      await expect(getMySubmissions('')).rejects.toThrow('用户 ID 为必填参数');\n    });\n\n    it('rejects a whitespace-only user id', async () => {\n      await expect(getMySubmissions('   ')).rejects.toThrow('用户 ID 为必填参数');\n    });\n\n    it('orders newest first and caps history at 200 rows', async () => {\n      const query = mockSubmissionQuery({ data: [], error: null });\n\n      await getMySubmissions('user-123');\n\n      expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });\n      expect(query.limit).toHaveBeenCalledWith(200);\n      expect(mockedSupabase.from).toHaveBeenCalledWith('lease_transactions');\n    });\n\n    it('surfaces database query errors', async () => {\n      mockSubmissionQuery({\n        data: null,\n        error: { code: 'PGRST301', message: 'Connection timeout' },\n      });\n\n      await expect(getMySubmissions('user-123')).rejects.toThrow('数据库连接超时');\n    });\n\n    it('trims the user id before querying', async () => {\n      const query = mockSubmissionQuery({ data: [], error: null });\n\n      await getMySubmissions('  user-123  ');\n\n      expect(query.eq).toHaveBeenCalledWith('submitter_id', 'user-123');\n    });\n  });\n\n`;
  source = replaceBetween(source, mySubmissionsStart, weeklyStart, mySubmissionsReplacement, 'getMySubmissions test block');

  write(path, source);
}
