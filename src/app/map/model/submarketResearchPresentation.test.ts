import { describe, expect, it } from 'vitest';
import cbdEdition from '../../../../data/submarket-research/2026-11-27/cbd.json';
import { submarketIntelligenceSchema } from './submarketIntelligence';
import { buildResearchPresentation, customerResearchText } from './submarketResearchPresentation';

const cbd = submarketIntelligenceSchema.parse(cbdEdition);

describe('CBD research presentation', () => {
  it('chooses a supply-backed lead independently of editorial array order', () => {
    const original = buildResearchPresentation(cbd, 'office');
    const reordered = buildResearchPresentation({ ...cbd, observations: [...cbd.observations].reverse() }, 'office');
    expect(original.lead?.title).toBe('CBD进入新供应驱动的竞争阶段');
    expect(reordered.lead?.key).toBe(original.lead?.key);
    expect(original.positioning).toBe(cbd.positioning.split('；')[0]);
    expect(original.previewFacts).toHaveLength(2);
    expect(original.previewFacts[0].measure?.value).toBe('33.2');
    expect(original.previewFacts[0].context).toContain('2026Q3');
    expect(original.previewFacts[1].measure?.value).toBe('125');
    expect(original.previewFacts[1].context).toContain('2026年6月');
    expect(original.previewFacts.some(fact => fact.variant === 'comparison')).toBe(false);
  });

  it('preserves each observation, fact and project once in the complete edition without merging scopes', () => {
    const plan = buildResearchPresentation(cbd, 'office');
    expect(plan.chapters.flatMap(chapter => chapter.observations.map(item => item.key)).sort())
      .toEqual(cbd.observations.map(item => item.title).sort());
    expect(plan.chapters.flatMap(chapter => chapter.facts.map(item => item.key)).sort())
      .toEqual(cbd.facts.map(item => item.title).sort());
    expect(plan.chapters.at(-1)?.theme).toBe('outlook');
    expect(plan.projects.map(item => item.buildingId)).toEqual(cbd.projects.map(item => item.buildingId));
    const externalVacancy = plan.chapters.flatMap(chapter => chapter.facts).find(fact => fact.variant === 'comparison');
    expect(externalVacancy?.context).toContain('公开甲级办公样本');
    expect(externalVacancy?.measure?.value).toBe('20.4');
    const client = JSON.stringify({
      observations: plan.chapters.flatMap(chapter => chapter.observations),
      facts: plan.chapters.flatMap(chapter => chapter.facts), projects: plan.projects.map(item => item.reason),
    });
    for (const source of cbd.sources.filter(item => item.scopeType === 'external_market')) {
      expect(client).not.toContain(source.publisher);
    }
    // The legacy edition is not mutated; the evidence remains available to the editor.
    expect(customerResearchText('莱坊独立样本显示CBD甲级空置率', cbd)).not.toContain('莱坊');
    expect(cbd.sources.some(source => source.publisher === '莱坊')).toBe(true);
  });
});
