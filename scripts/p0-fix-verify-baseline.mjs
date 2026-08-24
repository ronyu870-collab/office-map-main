import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOrThrow(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Expected text not found: ${label}`);
  }
  return content.replace(search, replacement);
}

function replaceRegexOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Expected pattern not found: ${label}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function update(path, transform) {
  const before = read(path);
  const after = transform(before);
  if (after === before) {
    console.log(`no change: ${path}`);
    return;
  }
  write(path, after);
  console.log(`updated: ${path}`);
}

update('src/__tests__/page-scroll-layout-bug.test.tsx', (content) => {
  content = replaceOrThrow(content, "import BIPage from '@/src/app/bi/page';\n", '', 'remove stale BI import');
  content = replaceOrThrow(content, "type PageType = 'home' | 'bi' | 'settings' | 'oss';", "type PageType = 'home' | 'settings' | 'oss';", 'remove stale BI page type');
  content = replaceRegexOrThrow(
    content,
    /\n    it\('❌ EXPECTED TO FAIL: BI page \(\/bi\) should NOT have page-level scrolling',[\s\S]*?\n    it\('❌ EXPECTED TO FAIL: Settings page/,
    "\n    it('❌ EXPECTED TO FAIL: Settings page",
    'remove stale BI layout test',
  );
  content = replaceOrThrow(content, "        { name: 'bi', component: BIPage },\n", '', 'remove BI property-test entry');
  return content;
});

update('src/__tests__/page-scroll-layout-preservation.test.tsx', (content) => {
  content = replaceOrThrow(content, "import BIPage from '@/src/app/bi/page';\n", '', 'remove stale BI preservation import');
  content = replaceRegexOrThrow(
    content,
    /\n  describe\('Property 2\.3: Chart Area Scrolling[\s\S]*?\n  describe\('Property 2\.4:/,
    "\n  describe('Property 2.4:",
    'remove stale BI preservation block',
  );
  content = content.replace(
    /vi\.mocked\(getSession\)\.mockResolvedValue\(\{([\s\S]*?)\n      \}\);/,
    "vi.mocked(getSession).mockResolvedValue({$1\n      } as any);",
  );
  content = content.replace(
    /vi\.mocked\(getSessionFast\)\.mockResolvedValue\(\{([\s\S]*?)\n      \}\);/,
    "vi.mocked(getSessionFast).mockResolvedValue({$1\n      } as any);",
  );
  return content;
});

update('src/app/lease-submission/schemas/leaseTransactionSchema.ts', (content) => {
  content = replaceOrThrow(content,
    "z.number({ \n      required_error: '请选择成交年份', \n      invalid_type_error: '请选择成交年份' \n    })",
    "z.number({ error: '请选择成交年份' })",
    'Zod 4 transaction year error API',
  );
  content = replaceOrThrow(content,
    "z.number({ \n      required_error: '请填写租赁面积', \n      invalid_type_error: '租赁面积必须为数字' \n    })",
    "z.number({ error: '租赁面积必须为数字' })",
    'Zod 4 area error API',
  );
  content = replaceOrThrow(content,
    "z.number({ \n      required_error: '请填写有效租金', \n      invalid_type_error: '有效租金必须为数字' \n    })",
    "z.number({ error: '有效租金必须为数字' })",
    'Zod 4 effective rent error API',
  );
  content = replaceOrThrow(content,
    "z.number({ \n      required_error: '请填写表面租金', \n      invalid_type_error: '表面租金必须为数字' \n    })",
    "z.number({ error: '表面租金必须为数字' })",
    'Zod 4 face rent error API',
  );
  content = replaceOrThrow(content,
    "  enterprise_type: z.enum(\n    ['央国企', '外企', '民企', '其他'],\n    {\n      required_error: '请选择企业类型',\n      invalid_type_error: '请选择有效的企业类型',\n      errorMap: () => ({ message: '请选择有效的企业类型' })\n    }\n  ),",
    "  enterprise_type: z.enum(\n    ['央国企', '外企', '民企', '其他'],\n    { error: '请选择有效的企业类型' }\n  ),",
    'Zod 4 enterprise enum error API',
  );
  content = replaceOrThrow(content,
    "  demand_type: z.enum(['新租', '搬迁', '扩租', '续租', '未知'], {\n    required_error: '请选择需求类型',\n    invalid_type_error: '请选择有效的类型',\n  }),",
    "  demand_type: z.enum(['新租', '搬迁', '扩租', '续租', '未知'], {\n    error: '请选择有效的类型',\n  }),",
    'Zod 4 demand enum error API',
  );
  return content;
});

update('src/app/lease-submission/components/LeaseTransactionForm.tsx', (content) => {
  content = replaceOrThrow(content,
    "import { useForm } from 'react-hook-form';",
    "import { useForm, type Resolver } from 'react-hook-form';",
    'import Resolver type',
  );
  content = replaceOrThrow(content,
    '    resolver: zodResolver(leaseTransactionSchema),',
    '    resolver: zodResolver(leaseTransactionSchema) as Resolver<LeaseTransactionFormData>,',
    'align Zod preprocess resolver with RHF output model',
  );
  return content;
});

update('src/components/OSSManager.tsx', (content) => replaceOrThrow(
  content,
  '  const getAuthHeader = async () => {',
  '  const getAuthHeader = async (): Promise<Record<string, string>> => {',
  'type auth headers as string record',
));

for (const path of [
  'src/components/admin/AdminGrid.tsx',
  'src/components/admin/SubmissionGrid.tsx',
  'src/components/admin/grid/GridPanel.tsx',
]) {
  update(path, (content) => replaceOrThrow(
    content,
    "  headerForegroundColor: '#6b7280',",
    "  headerTextColor: '#6b7280',",
    `AG Grid header text theme parameter in ${path}`,
  ));
}

update('src/components/admin/grid/GridPanel.tsx', (content) => {
  const first = content.indexOf("  noRowsToShow: '暂无数据',");
  const second = content.indexOf("  noRowsToShow: '暂无数据',", first + 1);
  if (first === -1 || second === -1) throw new Error('Expected duplicate noRowsToShow entries');
  content = content.slice(0, second) + content.slice(second + "  noRowsToShow: '暂无数据',\n".length);
  content = replaceOrThrow(content,
    "            // Theming API 不会替 AgGridReact 根节点继承 flex 高度；显式约束避免出现“数据已加载但网格白屏”。\n            style={{ width: '100%', height: '100%' }}\n",
    '',
    'remove unsupported AgGridReact style prop',
  );
  return content;
});

update('src/components/admin/AuditLogPage.tsx', (content) => replaceOrThrow(
  content,
  "      const mapped = (data || []).map(log => ({ ...log, user_name: userNames.get(log.user_id) })) as AuditLogWithUser[];",
  "      const mapped = (data || []).map((log: AuditLog) => ({ ...log, user_name: userNames.get(log.user_id) })) as AuditLogWithUser[];",
  'type audit log mapper',
));

update('src/components/map/BuildingMetricsEditModal.tsx', (content) => replaceOrThrow(
  content,
  '      buildingInfo?.total_area\n',
  '      buildingInfo?.total_area ?? null\n',
  'normalize optional total area to null',
));

update('src/services/leaseTransactionSubmitService.ts', (content) => {
  content = replaceOrThrow(content,
    '.select("submitter_id, face_rent, effective_rent")',
    '.select("submitter_id, face_rent, effective_rent, new_building")',
    'fetch existing building name used by update validation',
  );
  content = replaceOrThrow(content,
    '        !existing.is_manual_building\n',
    '        transaction.is_manual_building !== true\n',
    'use submitted manual-building flag instead of nonexistent persisted field',
  );
  return content;
});

update('src/utils/__tests__/performanceMonitor.test.ts', (content) => {
  content = replaceOrThrow(content, "  const originalEnv = process.env.NODE_ENV;\n\n", '', 'remove direct NODE_ENV snapshot');
  content = replaceOrThrow(content,
    "    process.env.NODE_ENV = 'development';",
    "    vi.stubEnv('NODE_ENV', 'development');",
    'use Vitest env stub',
  );
  content = replaceOrThrow(content,
    '    process.env.NODE_ENV = originalEnv;',
    '    vi.unstubAllEnvs();',
    'restore env through Vitest',
  );
  return content;
});
