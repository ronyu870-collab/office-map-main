import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Intelligence workspace product contract', () => {
  it('uses live Supabase data for operational counts instead of hard-coded KPI values', () => {
    const workspace = source('src/components/intelligence/IntelligenceWorkspace.tsx');

    for (const table of [
      "from('buildings')",
      "from('building_metrics')",
      "from('lease_transactions')",
      "from('building_brochure_data')",
      "from('future_supplies')",
      "from('building_current_data')",
    ]) {
      expect(workspace).toContain(table);
    }

    expect(workspace).toContain("{ count: 'exact', head: true }");
    expect(workspace).toContain(".not('lease_term_months', 'is', null)");
    expect(workspace).toContain(".order('record_year', { ascending: false })");
    expect(workspace).toContain(".order('record_quarter', { ascending: false })");

    for (const staleOrInventedKpi of ['642', '2,004', '325', '221', '139', '51', '2026 Q2']) {
      expect(workspace).not.toContain(staleOrInventedKpi);
    }
  });

  it('marks unsupported capabilities as preview or pending instead of presenting them as live facts', () => {
    const workspace = source('src/components/intelligence/IntelligenceWorkspace.tsx');

    expect(workspace).toContain('Pilot Preview');
    expect(workspace).toContain('企业变化 · 待接入');
    expect(workspace).toContain('资本事件 · 待接入');
    expect(workspace).toContain('暂无已保存的客户方案');
    expect(workspace).toContain('Pilot Example');
    expect(workspace).toContain('缺失数据不以 Demo 值补齐');
  });

  it('keeps the preview gated without changing existing module authorization', () => {
    const preview = source('src/config/intelligencePreview.ts');
    const access = source('src/config/accessControl.ts');

    expect(preview).toContain("parseUserRole(role) === 'admin'");
    expect(preview).toContain("NEXT_PUBLIC_INTELLIGENCE_PREVIEW === 'true'");
    expect(access).not.toContain("module: 'intelligence'");
  });
});
