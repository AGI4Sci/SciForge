import { isRecord } from '../gateway-utils.js';
import { normalizeWorkspaceProcessEvents } from './workspace-event-normalizer.js';

export const CONVERSATION_ACCEPTANCE_PLAN_SCHEMA_VERSION = 'sciforge.conversation.acceptance-plan.v1' as const;

type JsonMap = Record<string, unknown>;

export interface ConversationServicePlan {
  acceptancePlan: JsonMap;
  userVisiblePlan: JsonMap[];
  processStage: JsonMap;
  auditTrace: JsonMap[];
  metadata: JsonMap;
}

export function buildConversationServicePlan(request: unknown): ConversationServicePlan {
  const data = recordValue(request);
  const policyInput = recordValue(data.policyInput);
  const goalSnapshot = recordValue(data.goalSnapshot);
  const contextPolicy = recordValue(data.contextPolicy);
  const handoffPlan = recordValue(data.handoffPlan);

  return {
    acceptancePlan: acceptancePlan(goalSnapshot, handoffPlan),
    userVisiblePlan: userVisiblePlan(policyInput, goalSnapshot, contextPolicy, handoffPlan),
    processStage: {
      phase: 'planning',
      summary: 'Conversation policy request evaluated.',
      visibleDetail: 'Goal, context, references, capabilities, handoff, and recovery plans are ready.',
    },
    auditTrace: auditTrace(data),
    metadata: { service: 'sciforge_conversation.service' },
  };
}

export const buildConversationServicePlanFromRequest = buildConversationServicePlan;

function acceptancePlan(goalSnapshot: JsonMap, handoffPlan: JsonMap): JsonMap {
  return {
    schemaVersion: CONVERSATION_ACCEPTANCE_PLAN_SCHEMA_VERSION,
    deferEvaluationUntilOutput: true,
    criteria: arrayValue(goalSnapshot.acceptanceCriteria),
    requiredArtifacts: arrayValue(handoffPlan.requiredArtifacts),
    policy: 'do-not-mark-success-until-required-artifacts-and-refs-pass',
  };
}

function userVisiblePlan(
  policyInput: JsonMap,
  goalSnapshot: JsonMap,
  contextPolicy: JsonMap,
  handoffPlan: JsonMap,
): JsonMap[] {
  const metadata = recordValue(policyInput.metadata);
  const rawEvents = metadata.rawEvents;
  if (Array.isArray(rawEvents) || isRecord(rawEvents)) {
    return normalizeWorkspaceProcessEvents(rawEvents).events.map((event) => recordValue({ ...event }));
  }
  return [
    {
      phase: 'plan',
      title: '识别当前目标',
      detail: stringValue(goalSnapshot.normalizedPrompt) ?? stringValue(policyInput.prompt) ?? '',
    },
    {
      phase: 'plan',
      title: '选择上下文策略',
      detail: stringValue(recordValue(contextPolicy.pollutionGuard).reason) ?? stringValue(contextPolicy.mode),
    },
    {
      phase: 'plan',
      title: '准备执行交接',
      detail: stringValue(handoffPlan.status) ?? 'ready',
    },
  ];
}

function auditTrace(data: JsonMap): JsonMap[] {
  const requestSchemaVersion = stringValue(data.requestSchemaVersion)
    ?? stringValue(recordValue(data.policyInput).schemaVersion);
  const responseSchemaVersion = stringValue(data.responseSchemaVersion)
    ?? 'sciforge.conversation-policy.response.v1';
  const goalSnapshot = recordValue(data.goalSnapshot);
  const contextPolicy = recordValue(data.contextPolicy);
  const memoryPlan = recordValue(data.memoryPlan);
  const capabilityBrief = recordValue(data.capabilityBrief);
  const executionModePlan = recordValue(data.executionModePlan);
  const handoffPlan = recordValue(data.handoffPlan);
  const latencyPolicy = recordValue(data.latencyPolicy);
  const responsePlan = recordValue(data.responsePlan);
  const backgroundPlan = recordValue(data.backgroundPlan);
  const cachePolicy = recordValue(data.cachePolicy);

  return [
    {
      event: 'schema.accepted',
      requestSchemaVersion,
      responseSchemaVersion,
    },
    { event: 'module.goal_snapshot', schemaVersion: goalSnapshot.schemaVersion },
    { event: 'module.context_policy', schemaVersion: contextPolicy.schemaVersion },
    { event: 'module.memory', schemaVersion: memoryPlan.schemaVersion },
    { event: 'module.current_refs', count: arrayValue(data.currentReferenceDigests).length },
    { event: 'module.capability_broker', selected: arrayValue(capabilityBrief.selected).length },
    { event: 'module.execution_classifier', mode: executionModePlan.executionMode },
    { event: 'module.handoff_planner', status: handoffPlan.status },
    { event: 'module.latency_policy', schemaVersion: latencyPolicy.schemaVersion },
    { event: 'module.response_plan', schemaVersion: responsePlan.schemaVersion },
    { event: 'module.background_plan', schemaVersion: backgroundPlan.schemaVersion },
    { event: 'module.cache_policy', schemaVersion: cachePolicy.schemaVersion },
  ];
}

function recordValue(value: unknown): JsonMap {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
