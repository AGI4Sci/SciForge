import type { ToolPayload } from '../runtime-types.js';
import {
  VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION,
  decideVSCodeCoWorkNextPrimitive,
} from '../../../packages/actions/computer-use/vscode-cowork-acceptance.js';
import type {
  VSCodeCoWorkDecision,
  VSCodeCoWorkDecisionInput,
  VSCodeCoWorkObservationRefs,
  VSCodeCoWorkOperation,
  VSCodeCoWorkWindowCandidate,
} from '../../../packages/actions/computer-use/vscode-cowork-acceptance.js';

export interface VSCodeCoWorkChatBridgeInput {
  runtimeIntent?: unknown;
  commandId: string;
  attemptId: string;
}

export interface VSCodeCoWorkChatBridge {
  decision: VSCodeCoWorkDecision;
  payload: VSCodeCoWorkRoutePayload;
}

interface VSCodeCoWorkRoutePayload extends ToolPayload {
  status: VSCodeCoWorkDecision['status'];
  evidenceRefs: string[];
}

const UNSAFE_RUNTIME_STRING_PATTERN = /(?:\bBearer\s+|\b(?:sk|rk|pk|ghp|github_pat)[_-]|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization|credential|providerPayload|data:[^,\s]+;base64,|https?:\/\/)/i;
const BASE64ISH_RUNTIME_STRING_PATTERN = /^[A-Za-z0-9+/_=-]{160,}$/;
const SUPPORTED_OPERATIONS = new Set<VSCodeCoWorkOperation>([
  'focus-editor',
  'read-visible-text',
  'insert-draft',
  'save-current-file',
  'bulk-replace',
  'cross-file-modify',
  'undo-last-action',
]);

export function createVSCodeCoWorkChatBridge(input: VSCodeCoWorkChatBridgeInput): VSCodeCoWorkChatBridge | undefined {
  const runtimeIntent = isRecord(input.runtimeIntent) ? input.runtimeIntent : undefined;
  if (!isVSCodeCoWorkTask(runtimeIntent)) return undefined;

  const binding = sanitizeVSCodeCoWorkBinding(runtimeIntent?.vscodeCoWork);
  const requestRef = binding.requestRef ?? `chat-request:vscode-cowork:${input.commandId}:${input.attemptId}`;
  const decisionInput: VSCodeCoWorkDecisionInput = {
    requestRef,
    operation: binding.operation ?? 'read-visible-text',
    windowCandidates: binding.windowCandidates,
    invalidWindowCandidateCount: binding.invalidWindowCandidateCount,
    selectedWindowRef: binding.selectedWindowRef,
    selectedFileRef: binding.selectedFileRef,
    latestObservation: binding.latestObservation,
    draftTextRef: binding.draftTextRef,
    riskActionHash: binding.riskActionHash,
    confirmationRef: binding.confirmationRef,
  };
  const decision = binding.operation
    ? decideVSCodeCoWorkNextPrimitive(decisionInput)
    : missingOperationDecision(requestRef, binding.windowCandidates);

  return {
    decision,
    payload: payloadForDecision(decision),
  };
}

function isVSCodeCoWorkTask(runtimeIntent: Record<string, unknown> | undefined): boolean {
  if (runtimeIntent?.schemaVersion !== 'sciforge.runtime-codex.host-intent.v1') return false;
  if (runtimeIntent.kind !== 'computer-use-native-route') return false;
  if (runtimeIntent.source !== 'host-owned') return false;
  const computerUseNext = isRecord(runtimeIntent?.computerUseNext) ? runtimeIntent.computerUseNext : undefined;
  const semanticMarkers = safeRuntimeStringList(computerUseNext?.semanticMarkers) ?? [];
  return computerUseNext?.taskId === 'CU-NEXT-09'
    && semanticMarkers.includes('current-vscode-cowork')
    && semanticMarkers.includes('refs-first');
}

interface SanitizedVSCodeCoWorkBinding {
  requestRef?: string;
  operation?: VSCodeCoWorkOperation;
  windowCandidates: VSCodeCoWorkWindowCandidate[];
  invalidWindowCandidateCount: number;
  selectedWindowRef?: string;
  selectedFileRef?: string;
  latestObservation?: VSCodeCoWorkObservationRefs;
  draftTextRef?: string;
  riskActionHash?: string;
  confirmationRef?: string;
}

function sanitizeVSCodeCoWorkBinding(value: unknown): SanitizedVSCodeCoWorkBinding {
  if (!isRecord(value)) return { windowCandidates: [], invalidWindowCandidateCount: 0 };
  const windowCandidates = sanitizeWindowCandidates(value.windowCandidates);
  return {
    requestRef: safeRuntimeRef(value.requestRef, ['chat-request:']),
    operation: operationField(value.operation),
    windowCandidates: windowCandidates.candidates,
    invalidWindowCandidateCount: windowCandidates.invalidCount,
    selectedWindowRef: safeRuntimeRef(value.selectedWindowRef, ['window:']),
    selectedFileRef: safeRuntimeRef(value.selectedFileRef, ['file-ref:']),
    latestObservation: sanitizeObservation(value.latestObservation),
    draftTextRef: safeRuntimeRef(value.draftTextRef, ['text-ref:']),
    riskActionHash: safeRuntimeRef(value.riskActionHash, ['risk:']),
    confirmationRef: safeRuntimeRef(value.confirmationRef, ['approval:']),
  };
}

function sanitizeWindowCandidates(value: unknown): {
  candidates: VSCodeCoWorkWindowCandidate[];
  invalidCount: number;
} {
  if (!Array.isArray(value)) return { candidates: [], invalidCount: 0 };
  const candidates: VSCodeCoWorkWindowCandidate[] = [];
  let invalidCount = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      invalidCount += 1;
      continue;
    }
    const appRef = safeRuntimeRef(item.appRef, ['macos-app:']);
    const windowRef = safeRuntimeRef(item.windowRef, ['window:']);
    const processRef = safeRuntimeRef(item.processRef, ['process:']);
    const titleRef = safeRuntimeRef(item.titleRef, ['text:', 'window:']);
    const frontmostRef = safeRuntimeRef(item.frontmostRef, ['frontmost:', 'window:']);
    const optionalRefInvalid =
      (item.processRef !== undefined && !processRef)
      || (item.titleRef !== undefined && !titleRef)
      || (item.frontmostRef !== undefined && !frontmostRef);
    if (!appRef || !windowRef || optionalRefInvalid) {
      invalidCount += 1;
      continue;
    }
    candidates.push({
      appRef,
      windowRef,
      processRef,
      titleRef,
      frontmostRef,
      visibleFileRefs: safeRuntimeRefList(item.visibleFileRefs, ['file-ref:']),
    });
  }
  return { candidates, invalidCount };
}

function sanitizeObservation(value: unknown): VSCodeCoWorkObservationRefs | undefined {
  if (!isRecord(value)) return undefined;
  const windowRef = safeRuntimeRef(value.windowRef, ['window:']);
  if (!windowRef) return undefined;
  return {
    windowRef,
    observationRef: safeRuntimeRef(value.observationRef, ['observation:']) ?? '',
    screenshotRef: safeRuntimeRef(value.screenshotRef, ['image:']) ?? '',
    accessibilityRef: safeRuntimeRef(value.accessibilityRef, ['accessibility:']) ?? '',
    textRefs: safeRuntimeRefList(value.textRefs, ['text:']) ?? [],
    elementRefs: safeRuntimeRefList(value.elementRefs, ['element:']) ?? [],
    freshnessRef: safeRuntimeRef(value.freshnessRef, ['freshness:']) ?? '',
    stale: booleanField(value.stale),
    editorVisible: booleanField(value.editorVisible),
    visibleFileRefs: safeRuntimeRefList(value.visibleFileRefs, ['file-ref:']),
    userFile: booleanField(value.userFile),
  };
}

function operationField(value: unknown): VSCodeCoWorkOperation | undefined {
  if (typeof value !== 'string') return undefined;
  return SUPPORTED_OPERATIONS.has(value as VSCodeCoWorkOperation) ? value as VSCodeCoWorkOperation : undefined;
}

function safeRuntimeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = [...new Set(value.map(safeRuntimeString).filter(nonEmptyString))];
  return refs.length ? refs : undefined;
}

function safeRuntimeRefList(value: unknown, prefixes: string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = [...new Set(value.map((item) => safeRuntimeRef(item, prefixes)).filter(nonEmptyString))];
  return refs.length ? refs : undefined;
}

function safeRuntimeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 500) return undefined;
  if (UNSAFE_RUNTIME_STRING_PATTERN.test(text)) return undefined;
  if (BASE64ISH_RUNTIME_STRING_PATTERN.test(text)) return undefined;
  return text;
}

function safeRuntimeRef(value: unknown, prefixes: string[]): string | undefined {
  const text = safeRuntimeString(value);
  if (!text) return undefined;
  if (!/^[a-z][a-z0-9_-]*:[^\s/\\]+$/i.test(text)) return undefined;
  return prefixes.some((prefix) => text.startsWith(prefix)) ? text : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function missingOperationDecision(
  requestRef: string,
  windowCandidates: VSCodeCoWorkWindowCandidate[],
): VSCodeCoWorkDecision {
  return {
    schemaVersion: VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: true,
    refs: uniqueStrings([
      requestRef,
      ...windowCandidates.flatMap((candidate) => [
        candidate.appRef,
        candidate.processRef,
        candidate.windowRef,
        candidate.titleRef,
        candidate.frontmostRef,
        ...(candidate.visibleFileRefs ?? []),
      ]),
    ]),
    blockedReason: 'vscode_cowork_operation_required',
    repairHints: [{
      code: 'provide-host-selected-vscode-operation',
      message: 'Host must choose one supported VSCode co-work operation from current observe refs before Computer Use primitive execution.',
      suggestedPrimitive: 'observe',
    }],
  };
}

function payloadForDecision(decision: VSCodeCoWorkDecision): VSCodeCoWorkRoutePayload {
  return {
    status: decision.status,
    message: messageForDecision(decision),
    claimType: 'computer-use-vscode-cowork-host-decision',
    evidenceLevel: 'refs-first',
    reasoningTrace: 'Host-runtime consumed sanitized current VSCode refs and returned one primitive decision or fail-closed state; Computer Use core did not infer the user task.',
    claims: [{
      kind: 'computer-use-vscode-cowork-host-decision',
      status: decision.status,
      maturity: decision.maturity,
      productReady: false,
      targetWindowRef: decision.targetWindowRef,
      primitive: decision.primitive,
      actionType: decision.action?.type,
      blockedReason: decision.blockedReason,
    }],
    uiManifest: [{
      kind: 'computer-use-vscode-cowork',
      status: decision.status,
      maturity: decision.maturity,
      targetWindowRef: decision.targetWindowRef,
      blockedReason: decision.blockedReason,
      confirmation: decision.confirmation,
      repairHints: decision.repairHints,
      refsOnly: true,
    }],
    executionUnits: [{
      id: 'computer-use.vscode-cowork.host-decision',
      status: decision.status,
      capabilityId: 'CU-NEXT-09',
      maturity: decision.maturity,
      productReady: false,
      targetWindowRef: decision.targetWindowRef,
      primitive: decision.primitive,
      action: decision.action,
      risk: decision.risk,
      approvalRef: decision.approvalRef,
      blockedReason: decision.blockedReason,
      confirmation: decision.confirmation,
      repairHints: decision.repairHints,
      evidenceRefs: decision.refs,
    }],
    artifacts: [],
    logs: [{
      level: 'info',
      code: 'vscode-cowork-host-decision',
      status: decision.status,
      evidenceRefs: decision.refs,
    }],
    evidenceRefs: decision.refs,
  };
}

function messageForDecision(decision: VSCodeCoWorkDecision): string {
  if (decision.status === 'needs-confirmation') {
    return 'VSCode co-work requires Host confirmation before any Computer Use primitive is executed.';
  }
  if (decision.status === 'blocked') {
    return 'VSCode co-work is blocked before any Computer Use primitive is executed.';
  }
  return 'VSCode co-work selected one Host-owned Computer Use primitive from fresh observe refs.';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(nonEmptyString).map((value) => value.trim()))];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
