import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

import {
  createVSCodeEditorDecompositionGuard,
  type VSCodeEditorDecompositionOperation,
} from './vscode-editor-decomposition-guard-provider.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'vscode-editor-decomposition-guard-provider';

export function createDefaultVSCodeEditorDecompositionGuardMaterializer(): CodexAgentHostComputerUseActMaterializer {
  return (input) => {
    const hostOperation = structuredDecompositionOperation(input);
    if (!hostOperation) return undefined;

    const guard = createVSCodeEditorDecompositionGuard({
      attemptId: input.attemptId,
      operation: hostOperation.operation,
      operationRef: hostOperation.operationRef,
      scopeRefs: collectDecompositionRefs(input),
      nextStepRefs: hostOperation.nextStepRefs,
      partialEvidenceRefs: hostOperation.partialEvidenceRefs,
      requestedPrimitiveCount: hostOperation.requestedPrimitiveCount,
    });
    const outputRef = guard.evidenceRefs[0]
      ?? `blocked:vscode-editor-decomposition:${safeToken(input.attemptId) || 'attempt'}`;
    const result: CodexAgentHostComputerUseActMaterializerResult = {
      status: guard.status,
      message: 'VSCode editor non-atomic operation requires Host decomposition before returning a Computer Use primitive candidate.',
      confidence: 0.72,
      claimType: 'vscode-editor-decomposition-blocked',
      reasoningTrace: 'Agent Host supplied one structured non-atomic VSCode operation; the Host-owned decomposition guard blocked it before Computer Use core could receive a batch task. Computer Use core did not plan, verify, repair, or produce final answer.',
      evidenceRefs: guard.evidenceRefs,
      executionUnits: [decompositionExecutionUnit(input, outputRef, hostOperation.operation)],
      artifacts: [decompositionArtifact(input, guard, hostOperation)],
    };
    return sanitizePublicEvent(result) as CodexAgentHostComputerUseActMaterializerResult;
  };
}

function structuredDecompositionOperation(input: CodexAgentHostComputerUseActMaterializerInput): {
  operation: VSCodeEditorDecompositionOperation;
  operationRef: string;
  requestedPrimitiveCount?: number;
  nextStepRefs: string[];
  partialEvidenceRefs: string[];
} | undefined {
  const target = isRecord(input.agentHostInput.target) ? input.agentHostInput.target : {};
  const records = [
    target,
    isRecord(target.computerUseAppModule) ? target.computerUseAppModule : undefined,
    isRecord(target.appModule) ? target.appModule : undefined,
    isRecord(target.vscodeEditorDecomposition) ? target.vscodeEditorDecomposition : undefined,
  ];
  const operation = records.map(operationFromRecord).find((value): value is VSCodeEditorDecompositionOperation => value === 'bulk-replace' || value === 'cross-file-modify');
  if (!operation) return undefined;
  const operationRef = records.map((record) => operationRefFromRecord(record, operation)).find((value): value is string => typeof value === 'string')
    ?? collectDecompositionRefs(input).find((ref) => ref.startsWith(`operation-ref:vscode:${operation}:`));
  if (!operationRef) return undefined;
  return {
    operation,
    operationRef,
    requestedPrimitiveCount: records.map(requestedPrimitiveCountFromRecord).find((value): value is number => typeof value === 'number'),
    nextStepRefs: uniqueStrings(records.flatMap((record) => stringList(record?.nextStepRefs))),
    partialEvidenceRefs: uniqueStrings(records.flatMap((record) => stringList(record?.partialEvidenceRefs))),
  };
}

function collectDecompositionRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return uniqueStrings([
    ...stringList(input.agentHostInput.refs),
    ...stringList(input.agentHostInput.target.refs),
    ...stringList(input.agentHostInput.observation.refs),
    ...stringList(input.agentHostInput.permissions.refs),
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.permissions?.refs ?? []),
    ...(input.runtimeTruth?.permissions?.permissionRefs ?? []),
    ...(input.runtimeTruth?.permissions?.scopedExecutorRefs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
  ]);
}

function decompositionExecutionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  outputRef: string,
  operation: VSCodeEditorDecompositionOperation,
): Record<string, unknown> {
  return {
    id: `EU-vscode-editor-decomposition-${safeToken(input.attemptId) || 'attempt'}`,
    tool: TOOL_ID,
    status: 'blocked',
    operation,
    outputRef,
    hash: safeToken(input.attemptId) || 'vscode-editor-decomposition',
  };
}

function decompositionArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  guard: ReturnType<typeof createVSCodeEditorDecompositionGuard>,
  hostOperation: {
    operation: VSCodeEditorDecompositionOperation;
  },
): Record<string, unknown> {
  return {
    id: `vscode-editor-decomposition-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'vscode-editor-decomposition-guard',
    metadata: {
      source: TOOL_ID,
      status: guard.status,
    },
    data: {
      schemaVersion: 'sciforge.vscode-editor.decomposition-materializer.v1',
      hostOwnsDecomposition: true,
      computerUseCorePlanning: false,
      operation: hostOperation.operation,
      primitiveCount: guard.primitiveCandidates.length,
      evidenceRefs: guard.evidenceRefs.slice(0, 16),
      nextStepRefs: guard.nextStepRefs,
      partialEvidenceRefs: guard.partialEvidenceRefs,
      scopeRefs: guard.scopeRefs,
    },
  };
}

function operationFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  return stringField(value?.operation)
    ?? stringField(value?.computerUseOperation)
    ?? stringField(value?.primitiveOperation);
}

function operationRefFromRecord(value: Record<string, unknown> | undefined, operation: VSCodeEditorDecompositionOperation): string | undefined {
  const ref = stringField(value?.operationRef)
    ?? stringField(value?.computerUseOperationRef)
    ?? stringField(value?.primitiveOperationRef);
  return ref && new RegExp(`^operation-ref:vscode:${operation}:[A-Za-z0-9._:-]+$`, 'u').test(ref) ? ref : undefined;
}

function requestedPrimitiveCountFromRecord(value: Record<string, unknown> | undefined): number | undefined {
  return typeof value?.requestedPrimitiveCount === 'number' && Number.isFinite(value.requestedPrimitiveCount)
    ? value.requestedPrimitiveCount
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function safeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
