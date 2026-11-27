import type { Quarter } from '@/src/lib/intelligence/query/contracts';
import type { SlideContent, SourceReference } from '../contracts/content';
import type { BusinessDataBinding, ProposalAudience, VisualAssetReference } from '../integration-contracts';

export type Period = Quarter;
export type ProposalBlock = SlideContent['blocks'][number];
export type ImageBlock = Extract<ProposalBlock, { kind: 'image' }>;
export type MapBlock = Extract<ProposalBlock, { kind: 'map' }>;

export type PageAudience = ProposalAudience;
type Disclosure = SlideContent['disclosure'];
export type Evidence<T> = {
  value: T;
  sources: readonly SourceReference[];
  disclosure: Disclosure;
  isTestData?: boolean;
  data?: readonly BusinessDataBinding[];
  visual?: VisualAssetReference;
};

export type PublishedEvidence<T> = Evidence<T> & { publication: 'published' };

export type Field = { label: string; value: string | number; unit?: string };
export type Metrics = {
  netEffectiveRent?: number | null;
  vacancyRate?: number | null;
  trackedArea?: number | null;
  sampleCount?: number | null;
};
export type MarketObservation = Metrics & { name: string };
export type Photo = {
  kind: 'exterior' | 'lobby' | 'amenity' | 'office' | 'other';
  block: Omit<ImageBlock, 'sourceIds'>;
};
export type Building = {
  id: string;
  name: string;
  submarket?: string;
  grade?: string;
  profile?: Evidence<readonly Field[]>;
  technical?: Evidence<readonly Field[]>;
  transport?: Evidence<{ description: string; walkingMinutes?: number | null }>;
  quarter?: Evidence<Metrics & { period: Period }>;
  photos?: readonly Evidence<Photo>[];
  stackingPlan?: Evidence<Pick<SlideContent, 'blocks' | 'sources'> & { businessDate?: string | null }>;
};
export type Market = {
  city: string;
  name: string;
  submarket?: string;
  quarter: Evidence<Metrics & { period: Period }>;
  history?: readonly Evidence<Metrics & { period: Period }>[];
  submarkets?: readonly Evidence<MarketObservation & { period: Period }>[];
  grades?: readonly Evidence<MarketObservation & { period: Period }>[];
  spotlight?: PublishedEvidence<{ name: string; observation: string; details?: readonly string[] }>;
  methodology?: Evidence<string>;
  outlook?: PublishedEvidence<{ period: string; claim: string; basis: string; limitations: string[] }>;
};
export type Distribution = {
  unit: '笔' | '㎡';
  rows: readonly { label: string; value: number | null }[];
  methodology: string;
};
export type LeaseEvidence = {
  trend?: Evidence<Distribution>;
  industries?: Evidence<Distribution>;
  sizes?: Evidence<Distribution>;
  deals?: Evidence<readonly { building: string; industry: string | null; period: string; area: number | null }[]>;
};

export type CustomerBrief = {
  requirements: readonly string[];
  selectionBasis: readonly string[];
};
export type BoundBuilding = Building & { identity: Evidence<{ name: string }> };
export type LocationReference = Evidence<Omit<MapBlock, 'sourceIds'> | Omit<ImageBlock, 'sourceIds'>>;
export type ProposalData = {
  buildings: readonly BoundBuilding[];
  market?: Market;
  leases?: LeaseEvidence;
  maps?: { target?: LocationReference; candidates?: LocationReference; market?: LocationReference };
  customerBrief?: Evidence<CustomerBrief>;
  scoreWeights?: Evidence<import('./scorecard').ScoreWeights>;
  team?: PublishedEvidence<Extract<ProposalBlock, { kind: 'team' }>>;
  case?: PublishedEvidence<Extract<ProposalBlock, { kind: 'case' }>>;
  contact?: PublishedEvidence<string>;
};
