import type { DataBinding, PitchDataSnapshot } from './business/adapter';
import type { PitchScope, SlideContent, SourceReference } from './contracts/content';
import type { LayoutId } from './contracts/scene';
import type { ExportArtifact } from './contracts/entities';
import type { ProjectContext, ReviewedDocumentRefresh, WorkspaceHandoffInput, WorkspaceSave } from './workspace/protocol';

export type ProposalScenario = 'leasing-agency' | 'office-comparison' | 'market-report'
  | 'building-promotion' | 'site-selection' | 'analysis-briefing';
export type ProposalStyle = 'professional' | 'premium' | 'research';
export type ProposalAudience = ExportArtifact['audience'];

/** A resolved brief. The AI interpreter may ask for clarification before producing one. */
export type ProposalBrief = Pick<ProjectContext, 'buildingIds' | 'language'> & {
  scenario: ProposalScenario;
  style: ProposalStyle;
  audience: ProposalAudience;
  title: string;
  city: string;
  submarkets: string[];
  targetClient: string | null;
  period: string | null;
  start: string | null;
  pages: number;
};

export type BusinessDataBinding = DataBinding & Pick<PitchDataSnapshot, 'dataVersion' | 'dataAsOf'>;

/** An opaque, pinned reference. The resolver owns bytes, authorization and license checks. */
export type VisualAssetReference = {
  kind: 'photo' | 'map' | 'stacking-plan';
  id: string;
  version: number;
  versionHash: string;
  buildingIds: string[];
  source: SourceReference;
  disclosure: SlideContent['disclosure'];
};

export type PitchContextSnapshot = {
  scope: PitchScope;
  brief: ProposalBrief;
  fingerprint: string;
  data: BusinessDataBinding[];
  visuals: VisualAssetReference[];
  isTestData: boolean;
};

/** Stable page intent and selected inputs. Only business composers emit SlideContent. */
export type SlideIntent = {
  id: string;
  pageKind: string;
  title: string;
  layoutId?: LayoutId;
  data: BusinessDataBinding[];
  visuals: VisualAssetReference[];
};

export type ProposalPlan = {
  id: string;
  version: number;
  title: string;
  contextFingerprint: PitchContextSnapshot['fingerprint'];
  slides: SlideIntent[];
  gaps: { pageKind: string; reason: string }[];
};

export type DocumentModificationPlan = Pick<WorkspaceSave, 'projectId' | 'expectedVersion' | 'pages'> & {
  id: string;
  basePageVersions: { id: string; version: number }[];
  refresh?: Pick<ProposalPlan, 'id' | 'version' | 'contextFingerprint'> | ReviewedDocumentRefresh;
};

/** Navigation or an explicit append action. The source ID must be resolved in the active session. */
export type AddToPitch = WorkspaceHandoffInput;
