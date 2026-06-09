import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

import { createVSCodeAppModule } from './vscode-app-module.js';
import {
  verifyVSCodeMutationEvidence,
  type VSCodeAppVerifierResult,
} from './vscode-app-verifiers.js';
import type {
  ComputerUseAppModulePrimitiveCandidate,
} from './computer-use-app-module-registry.js';

export type VSCodeEditorNarrowApplyPrimitiveOperation = 'replace-selection' | 'insert-draft';

export interface VSCodeEditorNarrowApplyInput {
  attemptId: string;
  operationRef: string;
  primitiveOperation: VSCodeEditorNarrowApplyPrimitiveOperation;
  scopeRefs: string[];
  draftTextRef: string;
  requestedPrimitiveCount?: number;
}

export interface VSCodeEditorNarrowApplyPrimitiveCandidate {
  operation: VSCodeEditorNarrowApplyPrimitiveOperation;
  primitive: ComputerUseAppModulePrimitiveCandidate;
}

export interface VSCodeEditorNarrowApplyResult {
  schemaVersion: 'sciforge.vscode-editor.narrow-apply-provider.v1';
  status: 'completed' | 'blocked' | 'needs-confirmation';
  message: string;
  maturity: 'unit-proven';
  productReady: false;
  evidenceRefs: string[];
  scopeRefs: string[];
  draftTextRef?: string;
  primitiveOperation?: VSCodeEditorNarrowApplyPrimitiveOperation;
  primitiveCandidates: VSCodeEditorNarrowApplyPrimitiveCandidate[];
  reasonRef?: string;
}

export interface VSCodeEditorNarrowApplyVerificationInput {
  attemptId: string;
  beforeRefs: string[];
  actionRefs: string[];
  afterRefs: string[];
  cleanupRefs: string[];
}

export type VSCodeEditorNarrowApplyVerificationResult = VSCodeAppVerifierResult;

export function createVSCodeEditorNarrowApply(
  input: VSCodeEditorNarrowApplyInput,
): VSCodeEditorNarrowApplyResult {
  const attemptToken = safeToken(input.attemptId);
  const blocked = (
    reason: string,
    evidenceRefs: string[] = [],
    status: 'blocked' | 'needs-confirmation' = 'blocked',
  ): VSCodeEditorNarrowApplyResult => sanitizeApplyResult({
    schemaVersion: 'sciforge.vscode-editor.narrow-apply-provider.v1',
    status,
    message: status === 'needs-confirmation'
      ? 'VSCode editor narrow apply needs Host confirmation before creating a primitive candidate.'
      : 'VSCode editor narrow apply blocked before creating a primitive candidate.',
    maturity: 'unit-proven',
    productReady: false,
    evidenceRefs: safeApplyPublicRefs([
      `${status}:vscode-editor-narrow-apply:${reason}`,
      ...evidenceRefs,
    ]),
    scopeRefs: safeApplyScopeRefs(input.scopeRefs),
    draftTextRef: safeTextRef(input.draftTextRef),
    primitiveOperation: safePrimitiveOperation(input.primitiveOperation),
    primitiveCandidates: [],
    reasonRef: `${status}:vscode-editor-narrow-apply:${reason}`,
  });

  if (!attemptToken) return blocked('attempt-ref-required');
  if (!safeApplyOperationRef(input.operationRef)) return blocked('operation-ref-required');
  if (input.requestedPrimitiveCount !== undefined && input.requestedPrimitiveCount !== 1) {
    return blocked('single-primitive-required');
  }
  if (hasUnsafeApplyRef(input.scopeRefs)) return blocked('unsafe-scope-ref-not-allowed');
  const primitiveOperation = safePrimitiveOperation(input.primitiveOperation);
  if (!primitiveOperation) return blocked('primitive-operation-required');
  const draftTextRef = safeTextRef(input.draftTextRef);
  if (!draftTextRef) return blocked('text-ref-required');

  const primitiveOperationRef = `operation-ref:vscode:${primitiveOperation}:${attemptToken}`;
  const readiness = createVSCodeAppModule().checkReadiness({
    operation: primitiveOperation,
    operationRef: primitiveOperationRef,
    refs: uniqueStrings([
      ...input.scopeRefs,
      draftTextRef,
    ]),
  });
  if (readiness.status !== 'ready') {
    return blocked(
      readiness.reasonRef.replace(/^(?:blocked|needs-confirmation):/u, ''),
      readiness.evidenceRefs,
      readiness.status,
    );
  }

  const evidenceRefs = safeApplyPublicRefs([
    ...readiness.evidenceRefs,
    draftTextRef,
    `verifier:vscode-editor-narrow-apply:${attemptToken}:one-primitive`,
  ]);
  const primitive: ComputerUseAppModulePrimitiveCandidate = {
    name: readiness.primitive.name,
    inputRefs: evidenceRefs,
    ...(Object.hasOwn(readiness.primitive, 'action') ? { action: readiness.primitive.action } : {}),
  };
  return sanitizeApplyResult({
    schemaVersion: 'sciforge.vscode-editor.narrow-apply-provider.v1',
    status: 'completed',
    message: 'VSCode editor narrow apply created one refs-first primitive candidate.',
    maturity: 'unit-proven',
    productReady: false,
    evidenceRefs,
    scopeRefs: safeApplyScopeRefs(input.scopeRefs),
    draftTextRef,
    primitiveOperation,
    primitiveCandidates: [{
      operation: primitiveOperation,
      primitive,
    }],
  });
}

export function verifyVSCodeEditorNarrowApply(
  input: VSCodeEditorNarrowApplyVerificationInput,
): VSCodeEditorNarrowApplyVerificationResult {
  const attemptToken = safeToken(input.attemptId) || 'attempt';
  const mutation = verifyVSCodeMutationEvidence({
    beforeRefs: input.beforeRefs,
    actionRefs: input.actionRefs,
    afterRefs: input.afterRefs,
  });
  if (mutation.status === 'blocked') {
    return {
      status: 'blocked',
      reasonRef: mutation.reasonRef,
      evidenceRefs: safeApplyVerifierRefs(mutation.evidenceRefs),
    };
  }
  const cleanupRefs = safeCleanupRefs(input.cleanupRefs);
  if (cleanupRefsBlockedReason(cleanupRefs)) {
    return {
      status: 'blocked',
      reasonRef: 'blocked:vscode-editor-narrow-apply:cleanup-refs-required',
      evidenceRefs: cleanupRefs,
    };
  }
  return {
    status: 'ready',
    evidenceRefs: uniqueStrings([
      ...safeApplyVerifierRefs(mutation.evidenceRefs),
      ...cleanupRefs,
      `verifier:vscode-editor-narrow-apply:${attemptToken}:cleanup-release`,
      `verifier:vscode-editor-narrow-apply:${attemptToken}:verified`,
    ]),
  };
}

function sanitizeApplyResult(result: VSCodeEditorNarrowApplyResult): VSCodeEditorNarrowApplyResult {
  return sanitizePublicEvent(result) as VSCodeEditorNarrowApplyResult;
}

function safeApplyScopeRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter(isSafeApplyScopeRef));
}

function safeApplyPublicRefs(refs: Array<string | undefined>): string[] {
  return uniqueStrings(refs.filter((ref): ref is string => typeof ref === 'string' && (
    isSafeApplyScopeRef(ref)
      || safeTextRef(ref) !== undefined
      || ref.startsWith('blocked:vscode-editor-narrow-apply:')
      || ref.startsWith('needs-confirmation:vscode-editor-narrow-apply:')
      || ref.startsWith('blocked:vscode-app-module:')
      || ref.startsWith('needs-confirmation:vscode-app-module:')
      || ref.startsWith('verifier:vscode-editor-narrow-apply:')
  ))).slice(0, 64);
}

function safeApplyVerifierRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) =>
    isSafeApplyScopeRef(ref)
      || safeTextRef(ref) !== undefined
      || ref.startsWith('text:vscode:after:')
      || ref.startsWith('action:vscode:')
      || ref.startsWith('executor-event:vscode:')
      || ref.startsWith('input-event:vscode:')
      || ref.startsWith('verifier:vscode-app-module:')
  )).slice(0, 64);
}

function isSafeApplyScopeRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (unsafeApplyString(ref)) return false;
  return ref.startsWith('element:vscode:editor:')
    || ref.startsWith('element:vscode:monaco:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('file-ref:vscode:')
    || ref.startsWith('selected-file:vscode:')
    || ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('range-ref:vscode:')
    || ref.startsWith('freshness:vscode:');
}

function safeTextRef(ref: string | undefined): string | undefined {
  const value = ref?.trim();
  if (!value || value.length > 240) return undefined;
  if (unsafeApplyString(value)) return undefined;
  return /^text-ref:[A-Za-z0-9._:-]+$/u.test(value) ? value : undefined;
}

function safeApplyOperationRef(ref: string | undefined): string | undefined {
  const value = ref?.trim();
  if (!value || value.length > 240) return undefined;
  if (unsafeApplyString(value)) return undefined;
  return /^operation-ref:vscode:apply-current-selection:[A-Za-z0-9._:-]+$/u.test(value) ? value : undefined;
}

function safePrimitiveOperation(
  operation: string | undefined,
): VSCodeEditorNarrowApplyPrimitiveOperation | undefined {
  return operation === 'replace-selection' || operation === 'insert-draft' ? operation : undefined;
}

function hasUnsafeApplyRef(refs: string[]): boolean {
  return refs.some((ref) =>
    typeof ref !== 'string'
      || ref !== ref.trim()
      || unsafeApplyString(ref)
      || (isApplyScopeFamily(ref) && !isSafeApplyScopeRef(ref))
  );
}

function isApplyScopeFamily(ref: string): boolean {
  return ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('range-ref:vscode:');
}

function unsafeApplyString(value: string): boolean {
  return /https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(value)
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

function safeCleanupRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) => {
    if (ref !== ref.trim() || ref.length > 240) return false;
    if (unsafeApplyString(ref)) return false;
    return (ref.startsWith('control:current-vscode-cowork:') && ref.endsWith(':release'))
      || ref.startsWith('scoped-input-lease:current-vscode-cowork:')
      || ref.startsWith('scoped-input-adapter:current-vscode-cowork:')
      || ref.startsWith('cursor-marker:current-vscode-cowork:')
      || ref.startsWith('front-app-restore:current-vscode-cowork:')
      || ref.startsWith('mouse-position-restore:current-vscode-cowork:');
  }));
}

function cleanupRefsBlockedReason(refs: string[]): string | undefined {
  const requiredPrefixes = [
    'control:current-vscode-cowork:',
    'scoped-input-lease:current-vscode-cowork:',
    'scoped-input-adapter:current-vscode-cowork:',
    'cursor-marker:current-vscode-cowork:',
    'front-app-restore:current-vscode-cowork:',
    'mouse-position-restore:current-vscode-cowork:',
  ];
  return requiredPrefixes.some((prefix) => !refs.some((ref) => ref.startsWith(prefix)))
    ? 'cleanup-refs-required'
    : undefined;
}

function safeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
