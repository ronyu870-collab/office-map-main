// Frozen before product repair. Evidence types are part of the contract.
export const cases = [
  { id: 'protocol', family: 'capability-and-single-quarter', expected: 'PASS', tests: ['src/lib/intelligence/agent/toolRegistry.test.ts', 'src/lib/intelligence/agent/verifiedDataTool.test.ts', 'src/lib/intelligence/research/research.test.ts', 'src/lib/intelligence/agent/queryObligationHttp.test.ts'] },
  { id: 'data', family: 'data-and-units', expected: 'PASS', tests: ['src/lib/intelligence/query/__tests__/analytics.test.ts', 'src/lib/intelligence/query/__tests__/relativeQuarter.test.ts', 'src/lib/intelligence/query/__tests__/ai5-query-correctness.test.ts', 'scripts/intelligence/evaluation/oracle.test.ts'] },
  { id: 'permissions', family: 'owner-revocation-and-download', expected: 'PASS', tests: ['src/lib/intelligence/agent/resultWorkset.test.ts', 'src/lib/intelligence/query/__tests__/recoveryHttp.test.ts', 'src/lib/intelligence/query/__tests__/tableExportHttp.test.ts', 'src/lib/intelligence/query/__tests__/historyHttp.test.ts'] },
  { id: 'files', family: 'delivery-and-real-files', expected: 'PASS', tests: ['src/lib/intelligence/agent/exportTableTool.test.ts', 'src/lib/intelligence/agent/artifactFulfillment.test.ts', 'src/lib/intelligence/agent/agentHttp.test.ts', 'src/lib/intelligence/query/__tests__/reportPdf.test.ts', 'src/lib/intelligence/query/__tests__/chartWorkspace.test.ts'] },
  { id: 'conversation', family: 'stream-and-state', expected: 'PASS', tests: ['src/lib/intelligence/agent/agentConversation.test.ts', 'src/lib/intelligence/agent/agentStreamHttp.test.ts', 'src/components/home/__tests__/home-query-workspace.test.tsx'] },
  { id: 'budget', family: 'cost-and-replay-boundaries', expected: 'PASS', tests: [], nodeTests: ['scripts/intelligence/evaluation/budget.node-test.mjs', 'scripts/intelligence/evaluation/trace.node-test.mjs'] },
  { id: 'lease', family: 'lease-business-knowledge', expected: 'PASS', tests: ['src/lib/intelligence/lease/research.test.ts', 'src/lib/intelligence/business/research.test.ts', 'src/lib/intelligence/knowledge/research.test.ts'] },
  { id: 'auth-http', family: 'real-auth-db-http', expected: 'PASS', externalRunner: 'scripts/verification/verify-ai-query-auth.mjs' },
  { id: 'live-calibration', family: 'live-natural-explanation', expected: 'PASS', live: true, phase: 'diagnostic', question: '请解释空置率的含义。' },
  { id: 'live-capabilities', family: 'live-capability-discovery', expected: 'PASS', live: true, phase: 'acceptance', question: '请检查我这次能读取哪些字段、覆盖哪些范围，能否导出？' },
  { id: 'live-quarter', family: 'live-quarterly-task', expected: 'PASS', live: true, phase: 'acceptance', question: '查询 CBD 2026Q3 的净有效租金，说明单位和有效样本。' },
];
export const statuses = ['PASS', 'PARTIAL', 'FAIL', 'EXPECTED_DENIAL', 'UNSUPPORTED', 'INFRA_BLOCKED', 'BUDGET_BLOCKED', 'NOT_RUN'];
