/**
 * Single-invocation batch entry point for the Python conversation policy bridge.
 *
 * Replaces 11+ separate tsx subprocess spawns with one call, reducing tsx overhead
 * from ~3 seconds to ~0.3 seconds per request. Used exclusively by
 * packages/reasoning/conversation-policy/src/sciforge_conversation/batch.py.
 *
 * Input shape (JSON object):
 *   request          – original ConversationPolicyRequest (schema-versioned)
 *   goalSnapshot     – output of Python build_goal_snapshot()
 *   capabilityBrief  – output of Python build_capability_brief()
 *   handoffBudget    – optional budget hints
 *
 * Output shape:
 *   policyInput, contextPolicy, contextProjection, currentReferenceDigests,
 *   artifactIndex, turnComposition, executionModePlan, latencyPolicy, handoffPlan,
 *   responsePlan, backgroundPlan, cachePolicy, servicePlan,
 *   recoveryPlan, currentReferences, recentFailures
 */

import { buildConversationContextPolicy } from './conversation-context-policy.js';
import { buildConversationContextProjection } from './conversation-handoff-projection.js';
import { buildConversationReferenceDigestsFromRequest } from './conversation-reference-digest.js';
import { buildConversationArtifactIndexFromRequest } from './conversation-artifact-index.js';
import {
  buildConversationPolicyInput,
  buildConversationServicePlan,
  buildConversationTurnComposition,
} from './conversation-service-plan.js';
import { buildConversationLatencyPolicy } from './conversation-latency-policy.js';
import { planConversationHandoff } from './conversation-handoff-planner.js';
import { buildConversationResponsePlan, buildConversationBackgroundPlan } from './conversation-response-plan.js';
import { buildConversationCachePolicy } from './conversation-cache-policy.js';

type JsonMap = Record<string, unknown>;

function isRecord(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): JsonMap {
  return isRecord(value) ? value : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mappingFrom(plan: JsonMap, key: string): JsonMap {
  return recordOf(plan[key]);
}

function listFrom(plan: JsonMap, key: string): unknown[] {
  return arrayOf(plan[key]);
}

export function runConversationPolicyBatch(input: unknown): JsonMap {
  const data = recordOf(input);

  // goalSnapshot and capabilityBrief are computed in Python (pure-Python logic)
  const goalSnapshot = recordOf(data['goalSnapshot']);
  const capabilityBrief = recordOf(data['capabilityBrief']);
  const handoffBudget = recordOf(data['handoffBudget']);

  // Step 1 – normalise the raw request into policy input format
  const policyInput = buildConversationPolicyInput(recordOf(data['request']));

  // Step 2 – context policy (mode: fresh / continue / repair / isolate)
  const contextPolicy = buildConversationContextPolicy({ ...policyInput, goalSnapshot });

  // Step 3 – context projection (workspace ledger / compaction hints)
  const contextProjection = buildConversationContextProjection({
    ...policyInput,
    goalSnapshot,
    contextPolicy,
  });

  // Step 4 – reference digests (bounded workspace file excerpts)
  const currentReferenceDigests = buildConversationReferenceDigestsFromRequest(policyInput);

  // Step 5 – turn composition (context session, current refs, recovery plan, etc.)
  const turnExecutionConstraints = recordOf(
    goalSnapshot['turnExecutionConstraints'] ?? data['turnExecutionConstraints'],
  );
  const turnCompositionInput = {
    policyInput,
    goalSnapshot,
    contextPolicy,
    contextProjection,
    currentReferenceDigests,
    capabilityBrief,
    turnExecutionConstraints,
  };
  const turnComposition = buildConversationTurnComposition(turnCompositionInput);
  const turnCompositionMap = turnComposition as unknown as JsonMap;

  // Step 6 – artifact index (clickable refs for UI)
  const contextSession = mappingFrom(turnCompositionMap, 'contextSession');
  const artifactIndex = buildConversationArtifactIndexFromRequest({
    ...policyInput,
    session: isRecord(contextSession) ? contextSession : recordOf(policyInput['session']),
    currentReferenceDigests,
  });

  // Step 7 – execution mode plan (pure-Python classify_execution_mode result passed in)
  const executionModePlan = recordOf(data['executionModePlan']);

  // Step 8 – handoff plan
  const recoveryPlan = mappingFrom(turnCompositionMap, 'recoveryPlan');
  const handoffPlan = planConversationHandoff({
    prompt: typeof policyInput['prompt'] === 'string' ? policyInput['prompt'] : '',
    goal: goalSnapshot,
    policy: contextPolicy,
    contextProjection,
    currentReferenceDigests,
    artifacts: arrayOf(contextSession['artifacts']),
    requiredArtifacts: arrayOf(goalSnapshot['requiredArtifacts']),
    budget: handoffBudget,
  });

  // Step 9 – response plan, background plan, cache policy
  const currentReferences = listFrom(turnCompositionMap, 'currentReferences');
  const recentFailures = listFrom(turnCompositionMap, 'recentFailures');
  const policyOutputs = {
    policyInput,
    goalSnapshot,
    contextPolicy,
    contextProjection,
    currentReferences,
    currentReferenceDigests,
    artifactIndex,
    capabilityBrief,
    executionModePlan,
    turnExecutionConstraints,
    handoffPlan,
    recoveryPlan,
    recentFailures,
  };
  const responsePlan = buildConversationResponsePlan(policyOutputs);
  const backgroundPlan = buildConversationBackgroundPlan(policyOutputs);
  const cachePolicy = buildConversationCachePolicy(policyOutputs);

  // Step 10 – service plan (acceptance, user-visible plan, audit trace)
  const servicePlan = buildConversationServicePlan({
    ...policyOutputs,
    responsePlan,
    backgroundPlan,
    cachePolicy,
  });

  // Step 11 – latency policy (depends on service plan outputs)
  const latencyPolicy = buildConversationLatencyPolicy({
    policyInput,
    goalSnapshot,
    contextPolicy,
    executionModePlan,
    capabilityBrief,
    recoveryPlan,
  });

  return {
    policyInput,
    contextPolicy,
    contextProjection,
    currentReferenceDigests,
    artifactIndex,
    turnComposition: turnCompositionMap,
    executionModePlan,
    latencyPolicy,
    handoffPlan,
    responsePlan,
    backgroundPlan,
    cachePolicy,
    servicePlan,
    recoveryPlan,
    currentReferences,
    recentFailures,
  };
}
