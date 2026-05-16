import { createHash } from 'node:crypto';

import {
  eventRelayIdempotencyKey,
  RUN_CHECKPOINT_EVENT_SCHEMA_VERSION,
  RUN_STATUS_EVENT_SCHEMA_VERSION,
  SINGLE_AGENT_RUNTIME_CONTRACT_ID,
  FAILURE_NORMALIZER_SCHEMA_VERSION,
  WRITE_AHEAD_SPOOL_SCHEMA_VERSION,
  createTurnPipelineDefinition,
  type EventRelayIdentity,
  type EventRelayToolResult,
  type HarnessPolicyRefs,
  type IdempotentToolCallKey,
  type NormalizedRuntimeFailure,
  type RunLifecycleStatus,
  type RuntimeFailureClass,
  type RuntimeFailureOwner,
  type RuntimeFailureRecoverability,
  type TurnPipelineDefinition,
  type WriteAheadSpoolLimits,
} from '@sciforge-ui/runtime-contract';
import type { WorkspaceAppendResult, WorkspaceKernel } from './workspace-kernel';
import type { ConversationEvent, ConversationProjection, ConversationRef } from './types';

export interface RuntimeFailureInput {
  failureClass?: RuntimeFailureClass;
  recoverability?: RuntimeFailureRecoverability;
  owner?: RuntimeFailureOwner;
  reason?: string;
  evidenceRefs?: string[];
  error?: unknown;
}

export interface RunStateSnapshot {
  runId: string;
  status: RunLifecycleStatus;
  projectionVersion?: number;
  checkpointRefs: string[];
  failure?: NormalizedRuntimeFailure;
}

export interface RunStatusTransitionInput {
  eventId?: string;
  runId: string;
  turnId?: string;
  status: RunLifecycleStatus;
  summary?: string;
  failure?: NormalizedRuntimeFailure;
  checkpointRefs?: string[];
  refs?: ConversationRef[];
}

export interface RunCheckpointInput {
  eventId?: string;
  runId: string;
  turnId?: string;
  checkpointRefs: ConversationRef[];
  summary?: string;
}

export interface RunStateMachine {
  appendStatus(input: RunStatusTransitionInput): WorkspaceAppendResult;
  appendCheckpoint(input: RunCheckpointInput): WorkspaceAppendResult;
  recoverFromProjection(projection: ConversationProjection): RunStateSnapshot | undefined;
}

export interface RuntimeContextRequestResult {
  contextRef: string;
  contextDigest?: string;
  contextRefs?: string[];
}

export interface RuntimeDriveRunResult {
  resultRefs: string[];
  status?: 'succeeded' | 'failed';
  failure?: RuntimeFailureInput | NormalizedRuntimeFailure;
}

export interface RuntimeFinalizeResult {
  text?: string;
  artifactRefs?: string[];
  status?: 'satisfied' | 'repair-needed';
}

export interface TurnPipelineRunInput {
  turnId: string;
  runId: string;
  currentTurnRef: string;
  summary?: string;
  harnessPolicyRefs?: HarnessPolicyRefs;
}

export interface TurnPipelineHooks {
  requestContext(input: TurnPipelineRunInput): Promise<RuntimeContextRequestResult> | RuntimeContextRequestResult;
  driveRun(input: TurnPipelineRunInput & RuntimeContextRequestResult): Promise<RuntimeDriveRunResult> | RuntimeDriveRunResult;
  finalizeRun(input: TurnPipelineRunInput & RuntimeContextRequestResult & RuntimeDriveRunResult): Promise<RuntimeFinalizeResult> | RuntimeFinalizeResult;
  onFailure?(failure: NormalizedRuntimeFailure, input: TurnPipelineRunInput): Promise<RuntimeFinalizeResult> | RuntimeFinalizeResult;
}

export interface TurnPipeline {
  definition: TurnPipelineDefinition;
  execute(input: TurnPipelineRunInput): Promise<WorkspaceAppendResult>;
}

export interface EventRelayEnvelope<T> {
  identity: EventRelayIdentity;
  event: T;
}

export interface EventRelay<T> {
  emit(event: T): EventRelayEnvelope<T>;
  replayAfter(cursor?: string): Array<EventRelayEnvelope<T>>;
  executeToolCall(
    key: IdempotentToolCallKey,
    execute: () => { resultRefs: string[] },
  ): EventRelayToolResult;
}

export interface WriteAheadSpoolRecord {
  id: string;
  createdAt: number;
  refs: string[];
}

export type WriteAheadSpoolAppendResult =
  | { ok: true; record: WriteAheadSpoolRecord; depth: number }
  | { ok: false; failure: NormalizedRuntimeFailure; depth: number };

export interface WriteAheadSpool {
  contract: typeof WRITE_AHEAD_SPOOL_SCHEMA_VERSION;
  append(input: Omit<WriteAheadSpoolRecord, 'createdAt'> & { createdAt?: number }): WriteAheadSpoolAppendResult;
  drain(): WriteAheadSpoolRecord[];
  entries(): WriteAheadSpoolRecord[];
}

export function createRunStateMachine(input: {
  kernel: WorkspaceKernel;
  now?: () => string;
}): RunStateMachine {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    appendStatus(transition: RunStatusTransitionInput): WorkspaceAppendResult {
      return input.kernel.appendEvent(runStatusEvent(transition, now()));
    },
    appendCheckpoint(checkpoint: RunCheckpointInput): WorkspaceAppendResult {
      return input.kernel.appendEvent(runCheckpointEvent(checkpoint, now()));
    },
    recoverFromProjection(projection: ConversationProjection): RunStateSnapshot | undefined {
      const activeRun = projection.activeRun;
      if (!activeRun) return undefined;
      const status = runLifecycleStatusFromProjectionStatus(activeRun.status);
      return {
        runId: activeRun.id,
        status,
        projectionVersion: projection.projectionVersion,
        checkpointRefs: projection.backgroundState?.checkpointRefs ?? [],
      };
    },
  };
}

export function createTurnPipeline(input: {
  kernel: WorkspaceKernel;
  hooks: TurnPipelineHooks;
  now?: () => string;
}): TurnPipeline {
  const now = input.now ?? (() => new Date().toISOString());
  const runState = createRunStateMachine({ kernel: input.kernel, now });
  const definition = createTurnPipelineDefinition();
  return {
    definition,
    async execute(turn: TurnPipelineRunInput): Promise<WorkspaceAppendResult> {
      input.kernel.appendEvent({
        id: `turn:${turn.turnId}:registered`,
        type: 'TurnReceived',
        storage: 'inline',
        actor: 'user',
        timestamp: now(),
        turnId: turn.turnId,
        runId: turn.runId,
        payload: {
          summary: turn.summary ?? 'turn registered',
          currentTurnRef: turn.currentTurnRef,
          harnessPolicyRefs: turn.harnessPolicyRefs,
        },
      });
      runState.appendStatus({ runId: turn.runId, turnId: turn.turnId, status: 'registered', summary: 'turn registered' });
      try {
        const context = await input.hooks.requestContext(turn);
        runState.appendStatus({
          runId: turn.runId,
          turnId: turn.turnId,
          status: 'context-requested',
          summary: 'context requested',
          refs: refsFromIds(context.contextRefs ?? [context.contextRef]),
        });
        const driven = await input.hooks.driveRun({ ...turn, ...context });
        runState.appendStatus({
          runId: turn.runId,
          turnId: turn.turnId,
          status: driven.status === 'failed' ? 'failed' : 'running',
          summary: driven.status === 'failed' ? 'run failed' : 'run driven',
          failure: driven.failure ? normalizeRuntimeFailure(driven.failure) : undefined,
          refs: refsFromIds(driven.resultRefs),
        });
        const final = driven.status === 'failed'
          ? await runFailureHandler(input.hooks, normalizeRuntimeFailure(driven.failure), turn)
          : await input.hooks.finalizeRun({ ...turn, ...context, ...driven });
        return appendFinalEvent(input.kernel, turn, final, driven, now());
      } catch (error) {
        const failure = normalizeRuntimeFailure({ error, owner: 'runtime', failureClass: 'runtime' });
        runState.appendStatus({ runId: turn.runId, turnId: turn.turnId, status: 'failed', summary: failure.reason, failure });
        const final = await runFailureHandler(input.hooks, failure, turn);
        return appendFinalEvent(input.kernel, turn, final, { resultRefs: [], status: 'failed', failure }, now());
      }
    },
  };
}

export function createEventRelay<T>(input: {
  producerId: string;
  startSeq?: number;
}): EventRelay<T> {
  let producerSeq = input.startSeq ?? 0;
  const events: Array<EventRelayEnvelope<T>> = [];
  const toolResults = new Map<string, EventRelayToolResult>();
  return {
    emit(event: T): EventRelayEnvelope<T> {
      producerSeq += 1;
      const identity = relayIdentity(input.producerId, producerSeq);
      const envelope = { identity, event };
      events.push(envelope);
      return envelope;
    },
    replayAfter(cursor?: string): Array<EventRelayEnvelope<T>> {
      const cursorSeq = seqFromCursor(cursor);
      return events.filter((event) => event.identity.producerSeq > cursorSeq);
    },
    executeToolCall(key: IdempotentToolCallKey, execute: () => { resultRefs: string[] }): EventRelayToolResult {
      const idempotencyKey = eventRelayIdempotencyKey(key);
      const existing = toolResults.get(idempotencyKey);
      if (existing) return { ...existing, reused: true };
      producerSeq += 1;
      const result = execute();
      const stored: EventRelayToolResult = {
        resultRefs: [...result.resultRefs],
        reused: false,
        identity: relayIdentity(input.producerId, producerSeq),
      };
      toolResults.set(idempotencyKey, stored);
      return stored;
    },
  };
}

export function createWriteAheadSpool(input: {
  limits: WriteAheadSpoolLimits;
  now?: () => number;
}): WriteAheadSpool {
  const now = input.now ?? (() => Date.now());
  const records: WriteAheadSpoolRecord[] = [];
  return {
    contract: WRITE_AHEAD_SPOOL_SCHEMA_VERSION,
    append(record: Omit<WriteAheadSpoolRecord, 'createdAt'> & { createdAt?: number }): WriteAheadSpoolAppendResult {
      const createdAt = record.createdAt ?? now();
      const overflow = records.length >= input.limits.maxDepth
        || records.some((entry) => createdAt - entry.createdAt > input.limits.maxAgeMs);
      if (overflow) {
        return {
          ok: false,
          depth: records.length,
          failure: normalizeRuntimeFailure({
            failureClass: 'storage-unavailable',
            recoverability: 'fail-closed',
            owner: 'runtime',
            reason: 'WriteAheadSpool bounded buffer exceeded depth or age limits.',
            evidenceRefs: records.map((entry) => entry.id),
          }),
        };
      }
      const stored = { id: record.id, refs: [...record.refs], createdAt };
      records.push(stored);
      return { ok: true, record: stored, depth: records.length };
    },
    drain(): WriteAheadSpoolRecord[] {
      return records.splice(0).map((entry) => ({ ...entry, refs: [...entry.refs] }));
    },
    entries(): WriteAheadSpoolRecord[] {
      return records.map((entry) => ({ ...entry, refs: [...entry.refs] }));
    },
  };
}

export function normalizeRuntimeFailure(input: RuntimeFailureInput | NormalizedRuntimeFailure | undefined): NormalizedRuntimeFailure {
  if (isNormalizedRuntimeFailure(input)) return input;
  const reason = input?.reason?.trim() || errorMessage(input?.error) || 'Runtime failure did not include a reason.';
  const failureClass = input?.failureClass ?? failureClassForReason(reason);
  const recoverability = input?.recoverability ?? recoverabilityForClass(failureClass);
  const owner = input?.owner ?? ownerForClass(failureClass);
  const evidenceRefs = uniqueStrings(input?.evidenceRefs ?? []);
  return {
    contract: SINGLE_AGENT_RUNTIME_CONTRACT_ID,
    schemaVersion: FAILURE_NORMALIZER_SCHEMA_VERSION,
    failureClass,
    recoverability,
    owner,
    failureSignature: failureSignature({ failureClass, recoverability, owner, reason, evidenceRefs }),
    reason,
    evidenceRefs,
  };
}

export function normalizeHarnessPolicyRefs(input: HarnessPolicyRefs): HarnessPolicyRefs {
  return {
    schemaVersion: input.schemaVersion,
    decisionRef: input.decisionRef,
    contractRef: input.contractRef,
    traceRef: input.traceRef,
    contextRefs: uniqueStrings([input.decisionRef, input.contractRef, input.traceRef, ...input.contextRefs]),
  };
}

export function runStatusEvent(input: RunStatusTransitionInput, timestamp: string): ConversationEvent {
  const refs = input.refs ?? [];
  const payload = {
    schemaVersion: RUN_STATUS_EVENT_SCHEMA_VERSION,
    status: input.status,
    summary: input.summary ?? input.status,
    failure: input.failure,
    checkpointRefs: input.checkpointRefs,
    ...(refs.length ? { refs } : {}),
  };
  return {
    id: input.eventId ?? `run:${input.runId}:status:${input.status}`,
    type: 'RunStatusRecorded',
    storage: refs.length ? 'ref' : 'inline',
    actor: 'runtime',
    timestamp,
    turnId: input.turnId,
    runId: input.runId,
    payload,
  } as ConversationEvent;
}

export function runCheckpointEvent(input: RunCheckpointInput, timestamp: string): ConversationEvent {
  return {
    id: input.eventId ?? `run:${input.runId}:checkpoint:${input.checkpointRefs.map((ref) => ref.ref).join(':')}`,
    type: 'RunCheckpointRecorded',
    storage: 'ref',
    actor: 'runtime',
    timestamp,
    turnId: input.turnId,
    runId: input.runId,
    payload: {
      schemaVersion: RUN_CHECKPOINT_EVENT_SCHEMA_VERSION,
      status: 'checkpointed',
      summary: input.summary ?? 'run checkpoint recorded',
      checkpointRefs: input.checkpointRefs.map((ref) => ref.ref),
      refs: input.checkpointRefs,
    },
  };
}

function appendFinalEvent(
  kernel: WorkspaceKernel,
  turn: TurnPipelineRunInput,
  final: RuntimeFinalizeResult,
  driven: RuntimeDriveRunResult,
  timestamp: string,
): WorkspaceAppendResult {
  const status = final.status ?? (driven.status === 'failed' ? 'repair-needed' : 'satisfied');
  return kernel.appendEvent({
    id: `run:${turn.runId}:finalize:${status}`,
    type: status === 'repair-needed' ? 'RepairNeeded' : 'Satisfied',
    storage: (final.artifactRefs?.length ?? driven.resultRefs.length) > 0 ? 'ref' : 'inline',
    actor: 'runtime',
    timestamp,
    turnId: turn.turnId,
    runId: turn.runId,
    payload: {
      summary: final.text ?? status,
      text: final.text,
      ...(driven.failure ? { reason: normalizeRuntimeFailure(driven.failure).reason } : {}),
      refs: refsFromIds(final.artifactRefs ?? driven.resultRefs),
    },
  } as ConversationEvent);
}

async function runFailureHandler(
  hooks: TurnPipelineHooks,
  failure: NormalizedRuntimeFailure,
  turn: TurnPipelineRunInput,
): Promise<RuntimeFinalizeResult> {
  return hooks.onFailure
    ? await hooks.onFailure(failure, turn)
    : { status: 'repair-needed', text: failure.reason };
}

function refsFromIds(refs: string[]): ConversationRef[] {
  return uniqueStrings(refs).map((ref) => ({ ref }));
}

function relayIdentity(producerId: string, producerSeq: number): EventRelayIdentity {
  return {
    producerId,
    producerSeq,
    cursor: `${producerId}:${producerSeq}`,
  };
}

function seqFromCursor(cursor: string | undefined): number {
  const raw = cursor?.split(':').at(-1);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function runLifecycleStatusFromProjectionStatus(status: NonNullable<ConversationProjection['activeRun']>['status']): RunLifecycleStatus {
  switch (status) {
    case 'planned':
      return 'registered';
    case 'dispatched':
    case 'partial-ready':
    case 'output-materialized':
    case 'validated':
    case 'background-running':
      return 'running';
    case 'satisfied':
    case 'degraded-result':
      return 'succeeded';
    case 'external-blocked':
    case 'repair-needed':
    case 'needs-human':
      return 'failed';
    case 'idle':
      return 'registered';
  }
}

function failureClassForReason(reason: string): RuntimeFailureClass {
  if (/storage|spool|buffer/i.test(reason)) return 'storage-unavailable';
  if (/schema|contract|malformed|validation/i.test(reason)) return 'validation';
  if (/verification|verifier/i.test(reason)) return 'verification';
  if (/429|timeout|network|econn|provider|service unavailable/i.test(reason)) return 'external';
  if (/incompatible|payload/i.test(reason)) return 'contract-incompatible';
  return 'runtime';
}

function recoverabilityForClass(failureClass: RuntimeFailureClass): RuntimeFailureRecoverability {
  switch (failureClass) {
    case 'external':
      return 'retryable';
    case 'validation':
    case 'contract-incompatible':
    case 'runtime':
      return 'repairable';
    case 'verification':
      return 'supplementable';
    case 'storage-unavailable':
      return 'fail-closed';
  }
}

function ownerForClass(failureClass: RuntimeFailureClass): RuntimeFailureOwner {
  switch (failureClass) {
    case 'external':
      return 'external-provider';
    case 'validation':
    case 'contract-incompatible':
      return 'gateway';
    case 'verification':
      return 'verifier';
    case 'runtime':
    case 'storage-unavailable':
      return 'runtime';
  }
}

function failureSignature(input: {
  failureClass: RuntimeFailureClass;
  recoverability: RuntimeFailureRecoverability;
  owner: RuntimeFailureOwner;
  reason: string;
  evidenceRefs: string[];
}): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

function isNormalizedRuntimeFailure(value: unknown): value is NormalizedRuntimeFailure {
  return Boolean(value && typeof value === 'object'
    && (value as NormalizedRuntimeFailure).schemaVersion === FAILURE_NORMALIZER_SCHEMA_VERSION
    && typeof (value as NormalizedRuntimeFailure).failureSignature === 'string');
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' && error.trim() ? error : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
