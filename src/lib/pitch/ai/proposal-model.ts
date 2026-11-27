import { randomUUID } from "node:crypto";
import { createModelRuntime, modelAvailability } from "@/src/lib/intelligence/agent/modelRuntime";
import { ModelProviderError } from "@/src/lib/intelligence/agent/modelProvider";
import { externalModelForbidden, modelContextEnvelope } from "@/src/lib/intelligence/agent/modelContext";
import { selectConfiguredModel } from "@/src/lib/intelligence/control/config";
import { bindRuntimeControl } from "@/src/lib/intelligence/control/runtimeControl";
import { redactSubmittedCredentials } from "@/src/lib/intelligence/query/auditCrypto";
import { createRpcAuditPort } from "@/src/lib/intelligence/query/auditStore";
import { queryHttpDependencies } from "@/src/lib/intelligence/query/http";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { pitchRpc, type PitchContext } from "../data/store";
import { configSchema } from "./protocol";
import { readProposalBrief, type ProposalRequest } from "./proposal-brief";
import type { ProposalModel } from "./proposal-interpretation";
import { resolveProposalScope } from "./proposal-runtime";

/** Authorize only the prompt submitted by the requesting user. The normal query
 * runtime owns the provider, live model control, reservations and accounting. */
export async function authorizedProposalModel(ctx: PitchContext, input: ProposalRequest): Promise<ProposalModel | undefined> {
  const brief = readProposalBrief(input);
  if (!brief.requiresInterpretation || brief.periodConflict || externalModelForbidden(input.question)
    || redactSubmittedCredentials(input.question).redacted || process.env.AI_QUERY_HTTP_ENABLED !== "true") return;
  try {
    const { grant, scope } = await resolveProposalScope(ctx, input, brief.city);
    if (!grant.canExternalAi) return;
    const settings = configSchema.safeParse(await pitchRpc(ctx, { action: "ai_config" }));
    if (!settings.success || !settings.data.enabled || !settings.data.enabledTasks.includes("natural-language")) return;
    const config = settings.data;
    const profile = config.analysis ?? config.default;
    if (!profile || !modelAvailability(ctx.identity.actorId, profile)[profile.provider]) return;
    const { identity, client } = ctx;
    const initial = await loadDataAuthority(client, identity, ctx.signal);
    if (!initial.grants.includes("query:catalog")) return;
    const requestId = randomUUID();
    const control = await bindRuntimeControl(client, identity, ctx.signal, requestId);
    if (!control.snapshot) return;
    const selected = selectConfiguredModel(control.snapshot, "quick", "semantic_intent", false);
    if (!selected.structured || !selected.enabled || selected.model !== profile.model || selected.provider !== profile.provider) return;
    const { limits } = control.snapshot.config.modes.quick;
    const scopedProfile = {
      ...profile,
      maxTokens: Math.min(profile.maxTokens, limits.tokens, selected.contextLimit ?? Infinity, 6_000),
      maxOutputTokens: Math.min(profile.maxOutputTokens, limits.outputTokens, selected.outputLimit ?? Infinity, 768),
      maxUsd: Math.min(profile.maxUsd, limits.usd, config.batchUsd, config.dailyUsd, config.monthlyUsd, .01),
      timeoutMs: Math.min(profile.timeoutMs, limits.timeoutMs, 7_500),
      inputRate: Math.max(profile.inputRate, selected.inputRate),
      outputRate: Math.max(profile.outputRate, selected.outputRate),
    };
    const audit = createRpcAuditPort(client, identity, queryHttpDependencies().keys);
    const revalidate = async (signal: AbortSignal) => {
      const freshCtx = { ...ctx, signal };
      const current = await loadDataAuthority(client, identity, signal);
      const fresh = await resolveProposalScope(freshCtx, input, brief.city);
      const settings = configSchema.safeParse(await pitchRpc(freshCtx, { action: "ai_config" }));
      if (!current.grants.includes("query:catalog") || current.permissionRevision !== initial.permissionRevision
        || current.policyVersion !== initial.policyVersion || !fresh.grant.canExternalAi
        || JSON.stringify(fresh.scope) !== JSON.stringify(scope)
        || !settings.success || settings.data.revision !== config.revision) throw new Error("QUERY_DENIED");
    };
    const runtime = createModelRuntime({
      mode: "quick", question: input.question, actorId: identity.actorId, scopedProfile,
      control: {
        ...control,
        beforeCall: (provider, model, signal, reservation) => control.beforeCall(provider, model, signal,
          reservation ? { ...reservation, modelId: selected.id } : undefined),
      },
      revalidate,
      admit: async signal => {
        const { data, error } = await client.rpc("ai_query_model_budget", { p_actor: identity.actorId,
          p_effective: identity.effectiveUserId, p_session: identity.sessionId, p_request_id: requestId }).abortSignal(signal);
        if (error || data?.allowed !== true) throw new ModelProviderError("budget_exceeded", error ? "admission_service_unavailable" : "account_admission");
      },
      onAttempt: attempt => audit.append(requestId, "accounting", attempt),
    });
    let consumed = false;
    return {
      cacheScope: { actorId: identity.actorId, sessionId: identity.sessionId,
        configurationVersion: `${control.snapshot.version}/${config.revision}/${initial.permissionRevision}/${selected.id}` },
      invoke: async (messages, signal) => {
        if (consumed) throw new ModelProviderError("budget_exceeded", "attempt_limit");
        consumed = true;
        if (modelContextEnvelope(profile.provider, messages, []).inputUpperTokens > config.maxInputBytes) {
          throw new ModelProviderError("budget_exceeded", "token_reservation");
        }
        signal.throwIfAborted();
        await audit.receive({ requestId, submittedText: input.question, authority: initial, plan: { resolution: "pitch-proposal/1" } });
        try {
          await audit.append(requestId, "running", { phase: "pitch_proposal_intent" });
          const response = await runtime.interpret(messages, signal);
          await audit.append(requestId, "succeeded", { phase: "pitch_proposal_intent", operations: runtime.summary() });
          return response;
        } catch (error) {
          await audit.append(requestId, signal.aborted ? "cancelled" : "failed", { phase: "pitch_proposal_intent",
            reason: error instanceof ModelProviderError ? error.code : "unavailable", operations: runtime.summary() });
          throw error;
        }
      },
    };
  } catch {
    ctx.signal.throwIfAborted();
    return;
  }
}
