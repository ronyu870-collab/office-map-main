/** Business page intent and evidence eligibility are independent of the theme. */
import type { ProposalScenario, ProposalStyle } from '../integration-contracts';

export type ProposalRecipeId = Extract<ProposalScenario, 'leasing-agency' | 'office-comparison' | 'market-report' | 'building-promotion'>;
export type ClaimKind = 'fact' | 'analysis' | 'recommendation' | 'forecast';
export type ProposalEvidence =
  | 'building' | 'building-profile' | 'building-quarter' | 'tenant-brief' | 'transit'
  | 'market-quarter' | 'market-history' | 'market-submarkets' | 'market-grades' | 'market-spotlight'
  | 'lease-trend' | 'lease-industries' | 'lease-areas' | 'lease-deals'
  | 'exterior-photo' | 'interior-photo' | 'location-map' | 'stacking-plan'
  | 'approved-team' | 'approved-case' | 'approved-contact' | 'approved-outlook';

export interface PageIntent {
  id: string;
  kind: ClaimKind;
  evidence: readonly ProposalEvidence[];
  fallback: 'omit' | 'retain';
  follows: readonly string[];
}

export interface RecipeDefinition {
  id: ProposalRecipeId;
  revision: 1;
  name: string;
  recommendedStyle: ProposalStyle;
  visibility: 'source-bound';
  targetPages: readonly [number, number];
  requires: readonly ProposalEvidence[];
  pages: readonly PageIntent[];
}

function page(id: string, kind: ClaimKind, evidence: readonly ProposalEvidence[], follows: readonly string[] = [], fallback: PageIntent['fallback'] = 'omit'): PageIntent {
  return { id, kind, evidence, follows, fallback };
}

export const PROPOSAL_RECIPES = {
  'leasing-agency': {
    id: 'leasing-agency', revision: 1, name: '招商代理提案', recommendedStyle: 'professional', visibility: 'source-bound', targetPages: [15, 20], requires: ['building'],
    pages: [
      page('cover', 'fact', ['building', 'exterior-photo'], [], 'retain'),
      page('summary', 'analysis', ['building-quarter', 'market-quarter'], ['cover'], 'retain'),
      page('mandate', 'fact', ['tenant-brief'], ['summary']),
      page('profile', 'fact', ['building-profile']),
      page('arrival', 'fact', ['location-map', 'transit'], ['profile']),
      page('submarket', 'fact', ['market-quarter', 'market-spotlight']),
      page('history', 'analysis', ['market-history'], ['submarket']),
      page('competition-map', 'fact', ['location-map', 'building']),
      page('comparable-properties', 'fact', ['building-profile', 'exterior-photo'], ['competition-map']),
      page('rent-position', 'analysis', ['building-quarter'], ['comparable-properties']),
      page('vacancy-position', 'analysis', ['building-quarter'], ['comparable-properties']),
      page('positioning-matrix', 'analysis', ['building-quarter'], ['rent-position', 'vacancy-position']),
      page('availability', 'fact', ['stacking-plan']),
      page('industry-demand', 'analysis', ['lease-industries']),
      page('target-tenants', 'recommendation', ['lease-industries', 'building-profile'], ['industry-demand']),
      page('offer-strategy', 'recommendation', ['building-quarter', 'building-profile', 'stacking-plan'], ['rent-position', 'availability']),
      page('implementation', 'recommendation', ['building'], ['offer-strategy'], 'retain'),
      page('team', 'fact', ['approved-team']),
      page('case', 'fact', ['approved-case']),
      page('next-steps', 'recommendation', ['building'], ['implementation'], 'retain'),
    ],
  },
  'office-comparison': {
    id: 'office-comparison', revision: 1, name: '写字楼选址对比', recommendedStyle: 'professional', visibility: 'source-bound', targetPages: [8, 12], requires: ['building'],
    pages: [
      page('cover', 'fact', ['building'], [], 'retain'),
      page('requirements', 'fact', ['tenant-brief'], [], 'retain'),
      page('scope', 'fact', ['building', 'tenant-brief'], ['requirements'], 'retain'),
      page('projects', 'fact', ['building-profile', 'exterior-photo'], ['scope']),
      page('arrival', 'fact', ['location-map', 'transit'], ['scope']),
      page('parameters', 'fact', ['building-profile'], ['projects']),
      page('candidate-spaces', 'fact', ['stacking-plan'], ['parameters']),
      page('rent-position', 'analysis', ['building-quarter'], ['parameters']),
      page('vacancy-position', 'analysis', ['building-quarter'], ['parameters']),
      page('tradeoffs', 'analysis', ['tenant-brief', 'building-profile', 'building-quarter'], ['rent-position', 'vacancy-position']),
      page('scorecard', 'analysis', ['building-quarter', 'transit'], ['tradeoffs']),
      page('next-steps', 'recommendation', ['building', 'tenant-brief'], ['tradeoffs'], 'retain'),
    ],
  },
  'market-report': {
    id: 'market-report', revision: 1, name: '写字楼季度市场报告', recommendedStyle: 'research', visibility: 'source-bound', targetPages: [15, 25], requires: ['market-quarter'],
    pages: [
      page('cover', 'fact', ['market-quarter'], [], 'retain'),
      page('key-indicators', 'fact', ['market-quarter'], ['cover'], 'retain'),
      page('summary', 'analysis', ['market-quarter', 'market-history'], ['key-indicators']),
      page('rent-trend', 'analysis', ['market-history'], ['summary']),
      page('vacancy-trend', 'analysis', ['market-history'], ['summary']),
      page('submarkets', 'fact', ['market-submarkets']),
      page('grades', 'fact', ['market-grades']),
      page('positioning-matrix', 'analysis', ['market-submarkets'], ['submarkets']),
      page('lease-trend', 'analysis', ['lease-trend']),
      page('industry-demand', 'analysis', ['lease-industries']),
      page('lease-area', 'analysis', ['lease-areas']),
      page('lease-deals', 'fact', ['lease-deals']),
      page('spatial-distribution', 'fact', ['location-map']),
      page('spotlight', 'analysis', ['market-spotlight', 'market-submarkets'], ['submarkets']),
      page('spotlight-photos', 'fact', ['exterior-photo'], ['spotlight']),
      page('spotlight-spaces', 'fact', ['stacking-plan'], ['spotlight']),
      page('outlook', 'forecast', ['approved-outlook'], ['summary']),
      page('monitoring', 'recommendation', ['market-quarter', 'market-history'], ['summary']),
      page('methodology', 'fact', ['market-quarter'], ['key-indicators'], 'retain'),
    ],
  },
  'building-promotion': {
    id: 'building-promotion', revision: 1, name: '写字楼项目推介', recommendedStyle: 'premium', visibility: 'source-bound', targetPages: [5, 8], requires: ['building'],
    pages: [
      page('cover', 'fact', ['building', 'exterior-photo'], [], 'retain'),
      page('profile', 'fact', ['building', 'building-profile'], ['cover']),
      page('arrival', 'fact', ['location-map', 'transit']),
      page('parameters', 'fact', ['building-profile'], ['profile']),
      page('spaces', 'fact', ['interior-photo'], ['parameters']),
      page('leasing-evidence', 'fact', ['building-quarter', 'stacking-plan']),
      page('occupier-fit', 'recommendation', ['building-profile'], ['parameters']),
      page('next-steps', 'recommendation', ['building', 'approved-contact'], ['occupier-fit'], 'retain'),
    ],
  },
} as const satisfies Record<ProposalRecipeId, RecipeDefinition>;
