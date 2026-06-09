import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';
import {
  createVSCodeEditorPreview,
} from './vscode-editor-preview-provider.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'vscode-editor-preview-provider';
const PREVIEW_OPERATION = 'preview-current-selection';

export function createDefaultVSCodeEditorPreviewMaterializer(): CodexAgentHostComputerUseActMaterializer {
  return (input) => {
    const hostOperation = structuredPreviewOperation(input);
    if (!hostOperation) return undefined;

    const preview = createVSCodeEditorPreview({
      attemptId: input.attemptId,
      operationRef: hostOperation.operationRef,
      scopeRefs: collectPreviewRefs(input),
      draftArtifactRef: hostOperation.draftArtifactRef,
      diffArtifactRef: hostOperation.diffArtifactRef,
    });
    const outputRef = preview.previewArtifactRef
      ?? preview.evidenceRefs[0]
      ?? `blocked:vscode-editor-preview:${safeToken(input.attemptId) || 'attempt'}`;
    const result: CodexAgentHostComputerUseActMaterializerResult = {
      status: preview.status,
      message: preview.status === 'completed'
        ? 'VSCode editor preview provider returned refs-only preview artifact refs.'
        : 'VSCode editor preview provider blocked before producing preview artifact refs.',
      confidence: preview.status === 'completed' ? 0.76 : 0.68,
      claimType: preview.status === 'completed'
        ? 'vscode-editor-preview-artifact-refs'
        : 'vscode-editor-preview-blocked',
      reasoningTrace: 'Agent Host supplied one structured preview operation and current editor scope refs; the Host-owned preview provider returned artifact refs only. Computer Use core did not plan, act, write, verify, or produce final answer.',
      evidenceRefs: preview.evidenceRefs,
      executionUnits: [previewExecutionUnit(input, preview.status, outputRef)],
      artifacts: [previewArtifact(input, preview, hostOperation.operation)],
    };
    return sanitizePublicEvent(result) as CodexAgentHostComputerUseActMaterializerResult;
  };
}

function structuredPreviewOperation(input: CodexAgentHostComputerUseActMaterializerInput): {
  operation: typeof PREVIEW_OPERATION;
  operationRef: string;
  draftArtifactRef: string;
  diffArtifactRef?: string;
} | undefined {
  const target = isRecord(input.agentHostInput.target) ? input.agentHostInput.target : {};
  const records = [
    target,
    isRecord(target.computerUseAppModule) ? target.computerUseAppModule : undefined,
    isRecord(target.appModule) ? target.appModule : undefined,
    isRecord(target.vscodeEditorPreview) ? target.vscodeEditorPreview : undefined,
  ];
  const operation = records.map(operationFromRecord).find((value): value is string => typeof value === 'string');
  if (operation !== PREVIEW_OPERATION) return undefined;
  const operationRef = records.map(operationRefFromRecord).find((value): value is string => typeof value === 'string')
    ?? collectPreviewRefs(input).find((ref) => ref.startsWith(`operation-ref:vscode:${PREVIEW_OPERATION}:`));
  const draftArtifactRef = records.map(artifactRefFromRecord('draftArtifactRef')).find((value): value is string => typeof value === 'string');
  const diffArtifactRef = records.map(artifactRefFromRecord('diffArtifactRef')).find((value): value is string => typeof value === 'string');
  if (!operationRef || !draftArtifactRef) return undefined;
  return {
    operation,
    operationRef,
    draftArtifactRef,
    diffArtifactRef,
  };
}

function collectPreviewRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
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

function previewExecutionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  status: 'completed' | 'blocked',
  outputRef: string,
): Record<string, unknown> {
  return compactRecord({
    id: `EU-vscode-editor-preview-${safeToken(input.attemptId) || 'attempt'}`,
    tool: TOOL_ID,
    status: status === 'completed' ? 'artifact-preview' : 'blocked',
    operation: PREVIEW_OPERATION,
    outputRef,
    hash: safeToken(input.attemptId) || 'vscode-editor-preview',
  });
}

function previewArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  preview: ReturnType<typeof createVSCodeEditorPreview>,
  operation: string,
): Record<string, unknown> {
  return {
    id: `vscode-editor-preview-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'vscode-editor-preview',
    metadata: {
      source: TOOL_ID,
      status: preview.status,
    },
    data: {
      schemaVersion: 'sciforge.vscode-editor.preview-materializer.v1',
      hostOwnsPreview: true,
      computerUseCorePlanning: false,
      computerUsePrimitive: false,
      writesUserFile: false,
      operation,
      previewStatus: preview.previewStatus,
      artifactRefs: preview.artifactRefs,
      evidenceRefs: preview.evidenceRefs.slice(0, 16),
      scopeRefs: preview.scopeRefs,
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
  return ref && /^operation-ref:vscode:preview-[a-z0-9-]+:[A-Za-z0-9._:-]+$/u.test(ref) ? ref : undefined;
}

function artifactRefFromRecord(key: 'draftArtifactRef' | 'diffArtifactRef'): (value: Record<string, unknown> | undefined) => string | undefined {
  return (value) => {
    const ref = stringField(value?.[key]);
    return ref && /^artifact:[A-Za-z0-9._:-]+$/u.test(ref) ? ref : undefined;
  };
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
