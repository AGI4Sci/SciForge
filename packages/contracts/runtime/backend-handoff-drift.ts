export const BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION = 'sciforge.backend-handoff-drift.v1' as const;
export const BACKEND_HANDOFF_DRIFT_EVENT_TYPE = 'agentserver-handoff-drift' as const;

export type BackendHandoffDriftKind =
  | 'task-files'
  | 'direct-tool-payload'
  | 'plain-text-answer'
  | 'guarded-plain-text'
  | 'malformed-generation-response'
  | 'empty-output'
  | 'unknown-output';

export type BackendHandoffDriftStatus = 'accepted' | 'recovered' | 'needs-retry' | 'blocked';

export interface BackendHandoffDriftInput {
  raw?: unknown;
  text?: string;
  parsedGeneration?: boolean;
  parsedToolPayload?: boolean;
  plainTextClassificationKind?: string;
  source?: string;
  runId?: string;
}

export interface BackendHandoffDriftClassification {
  schemaVersion: typeof BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION;
  kind: BackendHandoffDriftKind;
  status: BackendHandoffDriftStatus;
  recoverable: boolean;
  shouldRetryStrictTaskFiles: boolean;
  shouldMaterializeDiagnostic: boolean;
  message: string;
  nextStep: string;
  signals: string[];
  source?: string;
  runId?: string;
}

export function backendHandoffDriftEvent(classification: BackendHandoffDriftClassification) {
  return {
    type: BACKEND_HANDOFF_DRIFT_EVENT_TYPE,
    source: 'workspace-runtime',
    status: runtimeEventStatusForBackendHandoffDrift(classification.status),
    message: classification.message,
    detail: [
      `kind=${classification.kind}`,
      `status=${classification.status}`,
      classification.nextStep,
    ].filter(Boolean).join(' · '),
    raw: classification,
  };
}

export function classifyBackendHandoffDrift(input: BackendHandoffDriftInput): BackendHandoffDriftClassification {
  const signals = backendHandoffDriftSignals(input);
  const source = normalizedString(input.source);
  const runId = normalizedString(input.runId);
  const base = { schemaVersion: BACKEND_HANDOFF_DRIFT_SCHEMA_VERSION, signals, source, runId };
  if (input.parsedGeneration) {
    return {
      ...base,
      kind: 'task-files',
      status: 'accepted',
      recoverable: true,
      shouldRetryStrictTaskFiles: false,
      shouldMaterializeDiagnostic: false,
      message: 'AgentServer handoff classified as runnable taskFiles.',
      nextStep: 'Materialize the generated task, execute it, and validate the ToolPayload output.',
    };
  }
  if (input.parsedToolPayload) {
    return {
      ...base,
      kind: 'direct-tool-payload',
      status: 'accepted',
      recoverable: true,
      shouldRetryStrictTaskFiles: false,
      shouldMaterializeDiagnostic: false,
      message: 'AgentServer handoff classified as a direct SciForge ToolPayload.',
      nextStep: 'Validate and materialize the direct payload without wrapping it as plain prose.',
    };
  }
  if (signals.includes('task-files-marker')) {
    return {
      ...base,
      kind: 'malformed-generation-response',
      status: 'needs-retry',
      recoverable: true,
      shouldRetryStrictTaskFiles: true,
      shouldMaterializeDiagnostic: false,
      message: 'AgentServer handoff looked like taskFiles JSON but was not a runnable generation response.',
      nextStep: 'Retry once with the strict taskFiles contract; if retry fails, return repair-needed.',
    };
  }
  const plainKind = normalizedString(input.plainTextClassificationKind);
  if (signals.includes('classified-plain-text')) {
    const humanAnswer = plainKind === 'human-answer';
    return {
      ...base,
      kind: humanAnswer ? 'plain-text-answer' : 'guarded-plain-text',
      status: humanAnswer ? 'recovered' : 'blocked',
      recoverable: true,
      shouldRetryStrictTaskFiles: false,
      shouldMaterializeDiagnostic: !humanAnswer,
      message: humanAnswer
        ? 'AgentServer handoff classified as plain text and recovered through the direct answer policy.'
        : 'AgentServer handoff plain text was blocked by the direct-text guard.',
      nextStep: humanAnswer
        ? 'Wrap the answer in a minimal audited ToolPayload.'
        : 'Preserve the raw output as a diagnostic and ask for structured artifacts/execution units.',
    };
  }
  if (signals.includes('tool-payload-marker')) {
    return {
      ...base,
      kind: 'unknown-output',
      status: 'blocked',
      recoverable: true,
      shouldRetryStrictTaskFiles: false,
      shouldMaterializeDiagnostic: true,
      message: 'AgentServer handoff referenced ToolPayload fields but could not be normalized.',
      nextStep: 'Return repair-needed with the preserved handoff excerpt.',
    };
  }
  if (signals.includes('empty-output')) {
    return {
      ...base,
      kind: 'empty-output',
      status: 'blocked',
      recoverable: false,
      shouldRetryStrictTaskFiles: false,
      shouldMaterializeDiagnostic: false,
      message: 'AgentServer handoff did not include taskFiles, a ToolPayload, or readable text.',
      nextStep: 'Return repair-needed and keep the AgentServer debug artifact as evidence.',
    };
  }
  return {
    ...base,
    kind: 'unknown-output',
    status: 'blocked',
    recoverable: true,
    shouldRetryStrictTaskFiles: false,
    shouldMaterializeDiagnostic: true,
    message: 'AgentServer handoff could not be classified as a supported output shape.',
    nextStep: 'Return repair-needed with a backend-handoff failure signature.',
  };
}

function runtimeEventStatusForBackendHandoffDrift(status: BackendHandoffDriftStatus) {
  if (status === 'accepted') return 'completed';
  if (status === 'recovered') return 'self-healed';
  if (status === 'needs-retry') return 'running';
  return 'failed-with-reason';
}

export function backendHandoffDriftSignals(input: BackendHandoffDriftInput): string[] {
  const signals = new Set<string>();
  if (input.parsedGeneration) signals.add('parsed-generation-response');
  if (input.parsedToolPayload) signals.add('parsed-tool-payload');
  const plainKind = normalizedString(input.plainTextClassificationKind);
  if (plainKind) signals.add('classified-plain-text');
  const text = [
    normalizedString(input.text),
  ].filter(Boolean).join('\n');
  if (!text.trim() && !input.raw) signals.add('empty-output');
  if (text.trim()) {
    if (plainKind) signals.add('plain-text');
    if (taskFilesMarkerPattern.test(text)) signals.add('task-files-marker');
    if (toolPayloadMarkerPattern.test(text)) signals.add('tool-payload-marker');
    if (runtimeTraceMarkerPattern.test(text)) signals.add('runtime-trace-marker');
  }
  if (rawHasKey(input.raw, 'taskFiles')) signals.add('task-files-marker');
  if (rawHasAnyKey(input.raw, ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'])) {
    signals.add('tool-payload-marker');
  }
  return Array.from(signals).sort();
}

const taskFilesMarkerPattern = /sciforge\.agentserver-generation-response\.v1|["']?taskFiles["']?\s*:|AgentServerGenerationResponse/i;
const toolPayloadMarkerPattern = /SciForge ToolPayload|["']?(?:message|claims|uiManifest|executionUnits|artifacts)["']?\s*:/i;
const runtimeTraceMarkerPattern = /\b(?:stdout|stderr|reasoningTrace|workEvidence|runtimeEvents|validationFailures)\b/i;

function normalizedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function rawHasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => rawHasKey(item, key));
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) return true;
  return ['result', 'output', 'data', 'payload', 'toolPayload', 'run', 'stages'].some((nestedKey) => rawHasKey(record[nestedKey], key));
}

function rawHasAnyKey(value: unknown, keys: string[]) {
  return keys.some((key) => rawHasKey(value, key));
}
