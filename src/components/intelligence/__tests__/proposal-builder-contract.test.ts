import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Intelligence proposal builder contract', () => {
  it('keeps the draft browser-session scoped and capped at five buildings', () => {
    const draft = source('src/lib/intelligence/proposalDraft.ts');
    expect(draft).toContain('window.sessionStorage');
    expect(draft).not.toContain('window.localStorage');
    expect(draft).toContain('MAX_PROPOSAL_CANDIDATES = 5');
    expect(draft).toContain('appliedCapabilities');
    expect(draft).not.toContain('meta: result.meta');
  });

  it('mounts proposal selection only for a validated Intelligence map handoff', () => {
    const page = source('src/app/map/page.tsx');
    const bridge = source('src/app/map/MapProposalBridge.tsx');
    const intelligence = source('src/components/intelligence/IntelligenceWorkspace.tsx');
    expect(page).toContain('initialIntelligenceHandoff ? <MapProposalBridge enabled /> : null');
    expect(page).not.toContain('<MapProposalBridge enabled={false}');
    expect(intelligence).toContain('beginProposalDraft(parseResult, mapHandoff.appliedCapabilities)');
    expect(bridge).toContain("'＋ 加入客户方案'");
    expect(bridge).toContain('MAX_PROPOSAL_CANDIDATES');
  });

  it('reads real building, metric and brochure data without persisting fake proposal history', () => {
    const workspace = source('src/components/intelligence/ProposalWorkspace.tsx');
    expect(workspace).toContain("from('buildings')");
    expect(workspace).toContain("from('building_metrics')");
    expect(workspace).toContain("from('building_brochure_data')");
    expect(workspace).not.toContain('.insert(');
    expect(workspace).not.toContain('.update(');
    expect(workspace).toContain('市场指标，不等于实时销控');
    expect(workspace).toContain('数据完整度');
    expect(workspace).not.toContain('AI Shortlist');
    expect(workspace).not.toContain('Broker');
    expect(workspace).not.toContain('Client Requirement');
    expect(workspace).toContain('楼书字段，不代表当前可租单元');
  });

  it('scores only requirement conditions explicitly eligible for proposal evaluation', () => {
    const workspace = source('src/components/intelligence/ProposalWorkspace.tsx');
    expect(workspace).toContain('new Set(draft.requirement.appliedCapabilities)');
    expect(workspace).toContain('new Set(draft.requirement.evaluationCapabilities)');
    expect(workspace).toContain('scoringCapabilities');
    expect(workspace).toContain('appliedCapabilitySet.has(item.key)');
    expect(workspace).toContain('绿色条件参与规则评估；黄色或灰色条件只保留为人工核验事项');
  });

  it('keeps recommendation scoring explainable and excludes unsupported requirement fields', () => {
    const scoring = source('src/lib/intelligence/proposalScoring.ts');
    expect(scoring).toContain("WEIGHTS = { location: 25, rent: 35, grade: 20, metro: 15, green: 5 }");
    expect(scoring).not.toContain("key: 'area'");
    expect(scoring).not.toContain("key: 'moveIn'");
    expect(scoring).toContain('dataConfidence');
  });
});
