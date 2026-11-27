import type { SlideContent } from '../contracts/content';
import type { SlideScene } from '../contracts/scene';
import { digest, type PitchContext } from '../data/store';
import type { DesignTheme } from '../design/theme';
import type { StackingHandoffSource } from './protocol';

type StackingEvidence = {
  city: string;
  content: SlideContent;
  businessDate: string | null;
  dataVersion: string;
  permissionRevision: string;
  policyVersion: string;
};

export type StackingHandoffPort = {
  read(ctx: PitchContext, source: StackingHandoffSource): Promise<StackingEvidence>;
  render(ctx: PitchContext, content: SlideContent, theme: DesignTheme): Promise<{
    generated: { id: string; content: SlideContent; sha256: string }[];
    slides: { slideId: string; content: SlideContent; scene: SlideScene; assetId: string; assetVersion: number }[];
    changes: { group: number; reason: string }[];
  }>;
};

export function requireStackingHandoff(port: StackingHandoffPort | undefined) {
  if (!port) throw new Error('PITCH_HANDOFF_UNSUPPORTED');
  return port;
}

export function stackingReviewBinding(evidence: StackingEvidence) {
  return {
    domain: 'business' as const, disclosure: 'restricted' as const,
    dataAsOf: evidence.businessDate, dataVersion: evidence.dataVersion,
    ...(evidence.businessDate ? {} : { observedOn: evidence.content.dataAsOf }),
    permissionRevision: evidence.permissionRevision, policyVersion: evidence.policyVersion,
  };
}

export function stackingReviewFingerprint(evidence: StackingEvidence, source: StackingHandoffSource, projectId?: string) {
  return digest(Buffer.from(JSON.stringify([source, projectId, evidence.city, stackingReviewBinding(evidence)])));
}
