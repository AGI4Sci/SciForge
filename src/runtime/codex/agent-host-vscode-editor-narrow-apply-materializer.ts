import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

import {
  createVSCodeEditorNarrowApply,
  type VSCodeEditorNarrowApplyPrimitiveOperation,
} from './vscode-editor-narrow-apply-provider.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'vscode-editor-narrow-apply-provider';
const APPLY_OPERATION = 'apply-current-selection';

export function createDefaultVSCodeEditorNarrowApplyMaterializer(): CodexAgentHostComputerUseActMaterializer {
  return (input) => {
    const hostOperation = structuredNarrowApplyOperation(input);
    if (!hostOperation) return undefined;

    const apply = createVSCodeEditorNarrowApply({
      attemptId: input.attemptId,
      operationRef: hostOperation.operationRef,
      primitiveOperation: hostOperation.primitiveOperation,
      scopeRefs: collectApplyRefs(input),
      draftTextRef: hostOperation.draftTextRef,
      requestedPrimitiveCount: hostOperation.requestedPrimitiveCount,
    });
    const outputRef = apply.evidenceRefs[0]
      ?? `blocked:vscode-editor-narrow-apply:${safeToken(input.attemptId) || 'attempt'}`;
    const result: CodexAgentHostComputerUseActMaterializerResult = {
      status: apply.status,
      message: apply.status === 'completed'
        ? 'VSCode editor narrow apply provider returned one refs-first primitive candidate.'
        : apply.status === 'needs-confirmation'
          ? 'VSCode editor narrow apply provider needs Host confirmation before returning a primitive candidate.'
          : 'VSCode editor narrow apply provider blocked before returning a primitive candidate.',
      confidence: apply.status === 'completed' ? 0.76 : apply.status === 'needs-confirmation' ? 0.72 : 0.68,
      claimType: apply.status === 'completed'
        ? 'vscode-editor-narrow-apply-primitive-candidate'
        : apply.status === 'needs-confirmation'
          ? 'vscode-editor-narrow-apply-needs-confirmation'
          : 'vscode-editor-narrow-apply-blocked',
      reasoningTrace: 'Agent Host supplied one structured narrow apply operation and current editor scope refs; the Host-owned narrow apply bridge returned at most one Computer Use primitive candidate. Computer Use core did not plan, verify, repair, or produce final answer.',
      evidenceRefs: apply.evidenceRefs,
      executionUnits: [applyExecutionUnit(input, apply.status, outputRef, hostOperation.primitiveOperation, apply.primitiveCandidates[0]?.primitive.name)],
      artifacts: [applyArtifact(input, apply, hostOperation)],
    };
    return sanitizePublicEvent(result) as CodexAgentHostComputerUseActMaterializerResult;
  };
}

function structuredNarrowApplyOperation(input: CodexAgentHostComputerUseActMaterializerInput): {
  operation: typeof APPLY_OPERATION;
  operationRef: string;
  primitiveOperation: VSCodeEditorNarrowApplyPrimitiveOperation;
  draftTextRef: string;
  requestedPrimitiveCount?: number;
} | undefined {
  const target = isRecord(input.agentHostInput.target) ? input.agentHostInput.target : {};
  const records = [
    target,
    isRecord(target.computerUseAppModule) ? target.computerUseAppModule : undefined,
    isRecord(target.appModule) ? target.appModule : undefined,
    isRecord(target.vscodeEditorNarrowApply) ? target.vscodeEditorNarrowApply : undefined,
  ];
  const operation = records.map(operationFromRecord).find((value): value is string => typeof value === 'string');
  if (operation !== APPLY_OPERATION) return undefined;
  const operationRef = records.map(operationRefFromRecord).find((value): value is string => typeof value === 'string')
    ?? collectApplyRefs(input).find((ref) => ref.startsWith(`operation-ref:vscode:${APPLY_OPERATION}:`));
  const primitiveOperation = records.map(primitiveOperationFromRecord).find((value): value is VSCodeEditorNarrowApplyPrimitiveOperation => typeof value === 'string');
  const draftTextRef = records.map(textRefFromRecord).find((value): value is string => typeof value === 'string')
    ?? collectApplyRefs(input).find((ref) => ref.startsWith('text-ref:'));
  if (!operationRef || !primitiveOperation || !draftTextRef) return undefined;
  return {
    operation,
    operationRef,
    primitiveOperation,
    draftTextRef,
    requestedPrimitiveCount: records.map(requestedPrimitiveCountFromRecord).find((value): value is number => typeof value === 'number'),
  };
}

function collectApplyRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
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

function applyExecutionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  status: 'completed' | 'blocked' | 'needs-confirmation',
  outputRef: string,
  primitiveOperation: VSCodeEditorNarrowApplyPrimitiveOperation,
  primitive: string | undefined,
): Record<string, unknown> {
  return compactRecord({
    id: `EU-vscode-editor-narrow-apply-${safeToken(input.attemptId) || 'attempt'}`,
    tool: TOOL_ID,
    status: status === 'completed' ? 'candidate' : status,
    operation: APPLY_OPERATION,
    primitiveOperation,
    primitive,
    outputRef,
    hash: safeToken(input.attemptId) || 'vscode-editor-narrow-apply',
  });
}

function applyArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  apply: ReturnType<typeof createVSCodeEditorNarrowApply>,
  hostOperation: {
    operation: typeof APPLY_OPERATION;
    primitiveOperation: VSCodeEditorNarrowApplyPrimitiveOperation;
  },
): Record<string, unknown> {
  return {
    id: `vscode-editor-narrow-apply-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'vscode-editor-narrow-apply',
    metadata: {
      source: TOOL_ID,
      status: apply.status,
    },
    data: {
      schemaVersion: 'sciforge.vscode-editor.narrow-apply-materializer.v1',
      hostOwnsApplyDecision: true,
      computerUseCorePlanning: false,
      operation: hostOperation.operation,
      primitiveOperation: hostOperation.primitiveOperation,
      primitiveCount: apply.primitiveCandidates.length,
      evidenceRefs: apply.evidenceRefs.slice(0, 16),
      scopeRefs: apply.scopeRefs,
    },
  };
}

function operationFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  return stringField(value?.operation)
    ?? stringField(value?.computerUseOperation)
    ?? stringField(value?.primitiveOperation);
}

function operationRefFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  const ref = stringField(value?.operationRef)
    ?? stringField(value?.computerUseOperationRef)
    ?? stringField(value?.primitiveOperationRef);
  return ref && /^operation-ref:vscode:apply-current-selection:[A-Za-z0-9._:-]+$/u.test(ref) ? ref : undefined;
}

function primitiveOperationFromRecord(value: Record<string, unknown> | undefined): VSCodeEditorNarrowApplyPrimitiveOperation | undefined {
  const operation = stringField(value?.primitiveOperation)
    ?? stringField(value?.applyPrimitiveOperation)
    ?? stringField(value?.narrowApplyPrimitiveOperation);
  return operation === 'replace-selection' || operation === 'insert-draft' ? operation : undefined;
}

function textRefFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  const ref = stringField(value?.draftTextRef)
    ?? stringField(value?.textRef)
    ?? stringField(value?.replacementTextRef);
  return ref && /^text-ref:[A-Za-z0-9._:-]+$/u.test(ref) ? ref : undefined;
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

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
