import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { queryHttpDependencies } from "@/src/lib/intelligence/query/http";
import type { VerifiedQueryIdentity } from "@/src/lib/intelligence/query/serverAuthority";
import { proposalInterpretationReceiptSchema, proposalInterpretationSchema, proposalRequestSchema, type ConfirmedProposal,
  type ProposalInterpretation, type ProposalRequest } from "./proposal-brief";

const receiptSchema = z.strictObject({
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  fromProject: z.boolean(),
  expires: z.number().int(),
  slots: proposalInterpretationSchema,
});
const lifetimeMs = 30 * 60_000;

function binding(identity: VerifiedQueryIdentity, request: ProposalRequest, planId: string, fingerprint: string) {
  return createHash("sha256").update(JSON.stringify([identity.actorId, identity.effectiveUserId, identity.sessionId,
    proposalRequestSchema.parse(request), planId, fingerprint])).digest("hex");
}

function signature(encoded: string) {
  const { digestKey } = queryHttpDependencies().keys;
  return createHmac("sha256", digestKey).update(`pitch-proposal-interpretation/1:${encoded}`).digest();
}

export function sealProposalInterpretation(identity: VerifiedQueryIdentity, request: ProposalRequest,
  plan: { id: string; contextFingerprint: string }, slots: ProposalInterpretation) {
  const encoded = Buffer.from(JSON.stringify({ binding: binding(identity, request, plan.id, plan.contextFingerprint),
    fromProject: !!request.projectId, expires: Date.now() + lifetimeMs, slots })).toString("base64url");
  const token = proposalInterpretationReceiptSchema.safeParse(`${encoded}.${signature(encoded).toString("base64url")}`);
  // The workspace lease bounds the complete stored confirmation to 12 KB.
  // Reserve room for task metadata and the JSONB representation.
  if (token.success && Buffer.byteLength(JSON.stringify(request)) + token.data.length <= 11_500) return token.data;
}

export function openProposalInterpretation(identity: VerifiedQueryIdentity, input: ConfirmedProposal) {
  if (!input.interpretationReceipt) return;
  try {
    const [encoded, provided] = input.interpretationReceipt.split(".");
    const expected = signature(encoded);
    const actual = Buffer.from(provided, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual) || actual.toString("base64url") !== provided) throw new Error();
    const receipt = receiptSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    const now = Date.now();
    // An initial review without a project can be submitted into a newly opened
    // workspace. Its complete, freshly authorized plan must still match.
    const request = receipt.fromProject ? input.request : { ...input.request, projectId: undefined };
    if (receipt.expires <= now || identity.expiresAt <= now
      || receipt.binding !== binding(identity, request, input.planId, input.contextFingerprint)) throw new Error();
    return receipt.slots;
  } catch {
    throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
  }
}
