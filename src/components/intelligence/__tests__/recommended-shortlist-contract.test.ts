import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Intelligence recommended shortlist contract', () => {
  it('routes Intelligence to the recommendation-first workspace', () => {
    const page = source('src/app/intelligence/page.tsx');
    expect(page).toContain('IntelligenceRecommendationWorkspace');
    expect(page).not.toContain('IntelligenceWorkspace');
  });

  it('makes direct recommendation the primary user action instead of exposing the parser as the main workflow', () => {
    const workspace = source('src/components/intelligence/IntelligenceRecommendationWorkspace.tsx');
    expect(workspace).toContain("'开始推荐'");
    expect(workspace).toContain('AI 推荐结果');
    expect(workspace).toContain('为什么推荐');
    expect(workspace).toContain('需要 Broker 确认');
    expect(workspace).toContain('系统假设');
    expect(workspace).toContain('生成 Top');
    expect(workspace).not.toContain('AI 已理解客户需求');
    expect(workspace).not.toContain('确认条件并查看地图');
  });

  it('reads recommendation facts only from existing real building, metric and brochure sources', () => {
    const service = source('src/services/intelligenceRecommendations.ts');
    expect(service).toContain("from('buildings')");
    expect(service).toContain("from('building_metrics')");
    expect(service).toContain("from('building_brochure_data')");
    expect(service).not.toContain('.insert(');
    expect(service).not.toContain('.update(');
  });

  it('keeps map and proposal as downstream review tools and seeds proposal from real Top 5 IDs', () => {
    const workspace = source('src/components/intelligence/IntelligenceRecommendationWorkspace.tsx');
    const draft = source('src/lib/intelligence/proposalDraft.ts');
    expect(workspace).toContain('在地图查看');
    expect(workspace).toContain("router.push('/intelligence/proposal')");
    expect(workspace).toContain('setProposalCandidates(topFive.map');
    expect(draft).toContain('MAX_PROPOSAL_CANDIDATES = 5');
  });
});
