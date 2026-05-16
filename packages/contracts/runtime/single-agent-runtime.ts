export const SINGLE_AGENT_RUNTIME_CONTRACT_ID = 'sciforge.single-agent-runtime.v1' as const;
export const TURN_PIPELINE_SCHEMA_VERSION = 'sciforge.turn-pipeline.v1' as const;
export const RUN_STATUS_EVENT_SCHEMA_VERSION = 'sciforge.run-status-event.v1' as const;
export const RUN_CHECKPOINT_EVENT_SCHEMA_VERSION = 'sciforge.run-checkpoint-event.v1' as const;
export const EVENT_RELAY_SCHEMA_VERSION = 'sciforge.event-relay.v1' as const;
export const WRITE_AHEAD_SPOOL_SCHEMA_VERSION = 'sciforge.write-ahead-spool.v1' as const;
export const FAILURE_NORMALIZER_SCHEMA_VERSION = 'sciforge.failure-normalizer.v1' as const;
export const HARNESS_POLICY_REFS_SCHEMA_VERSION = 'sciforge.harness-policy-refs.v1' as const;

export const TURN_PIPELINE_STAGES = [
  'registerTurn',
  'requestContext',
  'driveRun',
  'finalizeRun',
] as const;

export type TurnPipelineStage = typeof TURN_PIPELINE_STAGES[number];

export interface TurnPipelineDefinition {
  contract: typeof SINGLE_AGENT_RUNTIME_CONTRACT_ID;
  schemaVersion: typeof TURN_PIPELINE_SCHEMA_VERSION;
  stages: readonly TurnPipelineStage[];
  executorPolicy: {
    declarativeOnly: true;
    forbidBusinessBranching: true;
    forbidUserTextInspection: true;
  };
  failurePolicy: {
    failureSource: 'FailureNormalizer';
    repairDecisionOwner: 'TurnPipeline.onFailure+RepairPolicy';
  };
}

export type RunLifecycleStatus =
  | 'registered'
  | 'context-requested'
  | 'running'
  | 'checkpointed'
  | 'succeeded'
  | 'failed'
  | 'storage-unavailable';

export interface RunStatusEventPayload {
  schemaVersion: typeof RUN_STATUS_EVENT_SCHEMA_VERSION;
  status: RunLifecycleStatus;
  summary: string;
  failure?: NormalizedRuntimeFailure;
  checkpointRefs?: string[];
}

export interface RunCheckpointEventPayload {
  schemaVersion: typeof RUN_CHECKPOINT_EVENT_SCHEMA_VERSION;
  status: 'checkpointed';
  checkpointRefs: string[];
  summary: string;
}

export interface EventRelayIdentity {
  producerId: string;
  producerSeq: number;
  cursor: string;
}

export interface IdempotentToolCallKey {
  callId: string;
  inputDigest: string;
  routeDigest: string;
}

export interface EventRelayToolResult {
  resultRefs: string[];
  reused: boolean;
  identity: EventRelayIdentity;
}

export interface WriteAheadSpoolLimits {
  maxDepth: number;
  maxAgeMs: number;
}

export type RuntimeFailureClass =
  | 'validation'
  | 'contract-incompatible'
  | 'external'
  | 'runtime'
  | 'verification'
  | 'storage-unavailable';

export type RuntimeFailureRecoverability =
  | 'retryable'
  | 'repairable'
  | 'supplementable'
  | 'human-required'
  | 'fail-closed';

export type RuntimeFailureOwner =
  | 'agentserver'
  | 'gateway'
  | 'runtime'
  | 'verifier'
  | 'external-provider'
  | 'harness-policy';

export interface NormalizedRuntimeFailure {
  contract: typeof SINGLE_AGENT_RUNTIME_CONTRACT_ID;
  schemaVersion: typeof FAILURE_NORMALIZER_SCHEMA_VERSION;
  failureClass: RuntimeFailureClass;
  recoverability: RuntimeFailureRecoverability;
  owner: RuntimeFailureOwner;
  failureSignature: string;
  reason: string;
  evidenceRefs: string[];
}

export interface HarnessPolicyRefs {
  schemaVersion: typeof HARNESS_POLICY_REFS_SCHEMA_VERSION;
  decisionRef: string;
  contractRef: string;
  traceRef: string;
  contextRefs: string[];
}

export function createTurnPipelineDefinition(): TurnPipelineDefinition {
  return {
    contract: SINGLE_AGENT_RUNTIME_CONTRACT_ID,
    schemaVersion: TURN_PIPELINE_SCHEMA_VERSION,
    stages: TURN_PIPELINE_STAGES,
    executorPolicy: {
      declarativeOnly: true,
      forbidBusinessBranching: true,
      forbidUserTextInspection: true,
    },
    failurePolicy: {
      failureSource: 'FailureNormalizer',
      repairDecisionOwner: 'TurnPipeline.onFailure+RepairPolicy',
    },
  };
}

export function eventRelayIdempotencyKey(input: IdempotentToolCallKey): string {
  return `${input.callId}:${input.inputDigest}:${input.routeDigest}`;
}
