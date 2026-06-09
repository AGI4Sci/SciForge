import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

export type VSCodeEditorDecompositionOperation = 'bulk-replace' | 'cross-file-modify';

export interface VSCodeEditorDecompositionGuardInput {
  attemptId: string;
  operation: string;
  operationRef?: string;
  scopeRefs: string[];
  nextStepRefs?: string[];
  partialEvidenceRefs?: string[];
  requestedPrimitiveCount?: number;
}

export interface VSCodeEditorDecompositionGuardResult {
  schemaVersion: 'sciforge.vscode-editor.decomposition-guard.v1';
  status: 'blocked';
  message: string;
  maturity: 'unit-proven';
  productReady: false;
  evidenceRefs: string[];
  scopeRefs: string[];
  nextStepRefs: string[];
  partialEvidenceRefs: string[];
  primitiveCandidates: [];
  operation?: VSCodeEditorDecompositionOperation;
  reasonRef: string;
}

export function createVSCodeEditorDecompositionGuard(
  input: VSCodeEditorDecompositionGuardInput,
): VSCodeEditorDecompositionGuardResult {
  const attemptToken = safeToken(input.attemptId);
  const operation = safeDecompositionOperation(input.operation);
  const operationRef = safeOperationRef(input.operationRef, operation);
  const blocked = (reason: string, evidenceRefs: string[] = []): VSCodeEditorDecompositionGuardResult => {
    const reasonRef = `blocked:vscode-editor-decomposition:${reason}`;
    const nextStepRefs = safeNextStepRefs(input.nextStepRefs ?? []);
    const partialEvidenceRefs = safePartialEvidenceRefs(input.partialEvidenceRefs ?? []);
    return sanitizeDecompositionResult({
      schemaVersion: 'sciforge.vscode-editor.decomposition-guard.v1',
      status: 'blocked',
      message: 'VSCode editor non-atomic operation requires Host decomposition before Computer Use receives a primitive.',
      maturity: 'unit-proven',
      productReady: false,
      evidenceRefs: safeDecompositionPublicRefs([
        reasonRef,
        operationRef,
        attemptToken ? `decomposition:vscode-editor:single-primitive-only:${attemptToken}` : undefined,
        ...safeScopeRefs(input.scopeRefs),
        ...nextStepRefs,
        ...partialEvidenceRefs,
        ...evidenceRefs,
      ]),
      scopeRefs: safeScopeRefs(input.scopeRefs),
      nextStepRefs,
      partialEvidenceRefs,
      primitiveCandidates: [],
      operation,
      reasonRef,
    });
  };

  if (!attemptToken) return blocked('attempt-ref-required');
  if (!operation) return blocked('operation-not-supported');
  if (!operationRef) return blocked('operation-ref-required');
  if (input.requestedPrimitiveCount !== undefined && input.requestedPrimitiveCount !== 1) {
    return blocked('single-primitive-required');
  }
  if (safeScopeRefs(input.scopeRefs).length === 0) {
    return blocked('current-scope-ref-required');
  }
  return blocked('host-decomposition-required');
}

function sanitizeDecompositionResult(
  result: VSCodeEditorDecompositionGuardResult,
): VSCodeEditorDecompositionGuardResult {
  return sanitizePublicEvent(result) as VSCodeEditorDecompositionGuardResult;
}

function safeDecompositionOperation(operation: string | undefined): VSCodeEditorDecompositionOperation | undefined {
  return operation === 'bulk-replace' || operation === 'cross-file-modify' ? operation : undefined;
}

function safeOperationRef(ref: string | undefined, operation: VSCodeEditorDecompositionOperation | undefined): string | undefined {
  const value = ref?.trim();
  if (!value || !operation || value.length > 240 || unsafeString(value)) return undefined;
  const pattern = new RegExp(`^operation-ref:vscode:${operation}:[A-Za-z0-9._:-]+$`, 'u');
  return pattern.test(value) ? value : undefined;
}

function safeScopeRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter(isSafeScopeRef));
}

function isSafeScopeRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240 || unsafeString(ref)) return false;
  return ref.startsWith('element:vscode:editor:')
    || ref.startsWith('element:vscode:monaco:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('file-ref:vscode:')
    || ref.startsWith('selected-file:vscode:')
    || ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('range-ref:vscode:')
    || ref.startsWith('freshness:vscode:')
    || ref.startsWith('observation:vscode:');
}

function safeNextStepRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) => /^next-step:vscode-editor:[A-Za-z0-9._:-]+$/u.test(ref) && !unsafeString(ref))).slice(0, 16);
}

function safePartialEvidenceRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) => /^partial-evidence:vscode-editor:[A-Za-z0-9._:-]+$/u.test(ref) && !unsafeString(ref))).slice(0, 16);
}

function safeDecompositionPublicRefs(refs: Array<string | undefined>): string[] {
  return uniqueStrings(refs.filter((ref): ref is string => typeof ref === 'string' && (
    ref.startsWith('blocked:vscode-editor-decomposition:')
      || ref.startsWith('decomposition:vscode-editor:')
      || ref.startsWith('operation-ref:vscode:')
      || isSafeScopeRef(ref)
      || /^next-step:vscode-editor:[A-Za-z0-9._:-]+$/u.test(ref)
      || /^partial-evidence:vscode-editor:[A-Za-z0-9._:-]+$/u.test(ref)
  ))).slice(0, 64);
}

function unsafeString(value: string): boolean {
  return /https?:\/\/|data:image|base64|<html|secret|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|terminal-output|history|visible|selected-text/i.test(value)
    || /(^|[:/._-])raw([:/._-]|$)/i.test(value)
    || isUnsafeScopeRef(value);
}

function isUnsafeScopeRef(ref: string): boolean {
  const match = /^(?:selection-ref|cursor-ref|range-ref):(.+)$/i.exec(ref);
  if (!match) return false;
  const parts = match[1].split(':').filter(Boolean);
  return parts.length === 0 || parts.some((part) =>
    !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(part)
      || /raw|payload|selected|text|diff|path|file|url|http|secret|password|base64|provider|command/i.test(part),
  );
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
