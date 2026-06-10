export type CurrentVSCodeOperationId =
  | 'observe-current-vscode'
  | 'read-editor-context'
  | 'editor-scope'
  | 'preview-current-selection'
  | 'apply-current-selection'
  | 'verify-current-selection-apply'
  | 'save-current-file'
  | 'release-current-vscode';

export type CurrentVSCodePrimitive =
  | 'observe'
  | 'read-context'
  | 'preview'
  | 'replace-selection'
  | 'key:Meta+S'
  | 'verify'
  | 'release';

export interface CurrentVSCodeOperationTranscriptStep {
  operationId: CurrentVSCodeOperationId;
  operationRef?: string;
  primitive?: CurrentVSCodePrimitive;
  refs: string[];
}

export interface CurrentVSCodeOperationTranscriptCandidateStep {
  operationId?: string;
  operationRef?: string;
  primitive?: string;
  refs?: string[];
}

export interface CurrentVSCodePreviewApplySaveTranscriptInput {
  runRef: string;
  contextRefs: string[];
  draftTextRef: string;
  previewArtifactRef: string;
  verifierRefs: string[];
  cleanupRefs: string[];
}

export interface CurrentVSCodeSelectionTransformDogfoodTranscriptInput {
  runRef: string;
  contextRefs: string[];
  providerRefs: string[];
  verifierRefs: string[];
  cleanupRefs: string[];
}

export type CurrentVSCodeOperationTranscriptValidation =
  | { status: 'ready'; evidenceRefs: string[] }
  | { status: 'blocked'; reasonRefs: string[]; evidenceRefs: string[] };

const GENERIC_OPERATION_IDS = new Set<string>([
  'observe-current-vscode',
  'read-editor-context',
  'editor-scope',
  'preview-current-selection',
  'apply-current-selection',
  'verify-current-selection-apply',
  'save-current-file',
  'release-current-vscode',
]);

const REQUIRED_UI_APPLY_SAVE_SEQUENCE: readonly CurrentVSCodeOperationId[] = [
  'preview-current-selection',
  'apply-current-selection',
  'observe-current-vscode',
  'verify-current-selection-apply',
  'save-current-file',
  'release-current-vscode',
];

const SAFE_REF_PREFIXES = [
  'operation-ref:',
  'text-ref:',
  'artifact:',
  'verifier:',
  'selection-ref:',
  'cursor-ref:',
  'range-ref:',
  'file-ref:',
  'selected-file:',
  'window:',
  'observation:',
  'freshness:',
  'cleanup:',
] as const;

const TASK_SPECIFIC_OPERATION_PATTERN = String.raw`paper[-_. ]?polish|polish[-_. ]?paper`;
const UNSAFE_REF_PATTERN = new RegExp(
  `(?:${TASK_SPECIFIC_OPERATION_PATTERN}|rawSelectedText|selectedText|selected text|rawDraft|rawDiff|@@|/Users/|https?://|providerPayload|base64|terminal output|history|completed action)`,
  'i',
);
const SAFE_REF_TOKEN_PATTERN = /^[a-z][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$/u;

export function buildCurrentVSCodePreviewApplySaveTranscript(
  input: CurrentVSCodePreviewApplySaveTranscriptInput,
): CurrentVSCodeOperationTranscriptStep[] {
  const contextRefs = sanitizeRefs(input.contextRefs);
  const runRef = firstSafeRef([input.runRef]);
  const draftTextRef = firstSafeRef([input.draftTextRef]);
  const previewArtifactRef = firstSafeRef([input.previewArtifactRef]);
  const verifierRefs = sanitizeRefs(input.verifierRefs).filter((ref) => ref.startsWith('verifier:'));
  const cleanupRefs = sanitizeRefs(input.cleanupRefs).filter((ref) => ref.startsWith('cleanup:'));

  return buildGenericTranscript({
    runRef,
    contextRefs,
    draftTextRef,
    previewArtifactRef,
    verifierRefs,
    cleanupRefs,
  });
}

export function buildCurrentVSCodeSelectionTransformDogfoodTranscript(
  input: CurrentVSCodeSelectionTransformDogfoodTranscriptInput,
): CurrentVSCodeOperationTranscriptStep[] {
  const providerRefs = sanitizeRefs(input.providerRefs);
  const draftTextRef = providerRefs.find((ref) => ref.startsWith('text-ref:'));
  const previewArtifactRef = providerRefs.find((ref) => ref.startsWith('artifact:'));

  return buildGenericTranscript({
    runRef: firstSafeRef([input.runRef]),
    contextRefs: sanitizeRefs(input.contextRefs),
    draftTextRef,
    previewArtifactRef,
    verifierRefs: sanitizeRefs(input.verifierRefs).filter((ref) => ref.startsWith('verifier:')),
    cleanupRefs: sanitizeRefs(input.cleanupRefs).filter((ref) => ref.startsWith('cleanup:')),
  });
}

export function validateCurrentVSCodeOperationTranscript(
  transcript: ReadonlyArray<CurrentVSCodeOperationTranscriptCandidateStep>,
): CurrentVSCodeOperationTranscriptValidation {
  const reasonRefs: string[] = [];
  const evidenceRefs: string[] = [];
  let applyPrimitiveCount = 0;
  let savePrimitiveCount = 0;

  for (const step of transcript) {
    if (!GENERIC_OPERATION_IDS.has(String(step.operationId))) {
      reasonRefs.push('blocked:current-vscode-operation-transcript:operation-not-generic');
    }

    const refs = [
      ...(Array.isArray(step.refs) ? step.refs : []),
      ...(typeof step.operationRef === 'string' ? [step.operationRef] : []),
    ];
    for (const ref of refs) {
      if (isSafeRef(ref)) {
        evidenceRefs.push(ref);
      } else {
        reasonRefs.push('blocked:current-vscode-operation-transcript:unsafe-ref');
      }
    }

    if (step.operationId === 'apply-current-selection' && step.primitive === 'replace-selection') {
      applyPrimitiveCount += 1;
    }
    if (step.operationId === 'save-current-file' && step.primitive === 'key:Meta+S') {
      savePrimitiveCount += 1;
    }
  }

  if (applyPrimitiveCount > 1) {
    reasonRefs.push('blocked:current-vscode-operation-transcript:apply-not-single-primitive');
  }
  if (savePrimitiveCount > 1) {
    reasonRefs.push('blocked:current-vscode-operation-transcript:save-not-single-primitive');
  }
  if (hasUiApplySaveIntent(transcript)) {
    if (!hasRequiredUiApplySaveSequence(transcript)) {
      reasonRefs.push('blocked:current-vscode-operation-transcript:ui-sequence-incomplete');
    } else {
      reasonRefs.push(...currentEditorScopeBlockedReasonRefs(evidenceRefs));
    }
  }

  const uniqueReasons = uniqueStrings(reasonRefs);
  if (uniqueReasons.length > 0) {
    return {
      status: 'blocked',
      reasonRefs: uniqueReasons,
      evidenceRefs: uniqueStrings(evidenceRefs),
    };
  }

  return {
    status: 'ready',
    evidenceRefs: uniqueStrings(evidenceRefs),
  };
}

function hasUiApplySaveIntent(transcript: ReadonlyArray<CurrentVSCodeOperationTranscriptCandidateStep>): boolean {
  return transcript.some((step) => REQUIRED_UI_APPLY_SAVE_SEQUENCE.includes(step.operationId as CurrentVSCodeOperationId));
}

function hasRequiredUiApplySaveSequence(
  transcript: ReadonlyArray<CurrentVSCodeOperationTranscriptCandidateStep>,
): boolean {
  const previewIndex = transcript.findIndex((step) => step.operationId === 'preview-current-selection');
  if (previewIndex < 0) {
    return false;
  }

  const sequence = transcript.slice(previewIndex, previewIndex + REQUIRED_UI_APPLY_SAVE_SEQUENCE.length);
  return REQUIRED_UI_APPLY_SAVE_SEQUENCE.every((operationId, index) => sequence[index]?.operationId === operationId);
}

function buildGenericTranscript(input: {
  runRef?: string;
  contextRefs: string[];
  draftTextRef?: string;
  previewArtifactRef?: string;
  verifierRefs: string[];
  cleanupRefs: string[];
}): CurrentVSCodeOperationTranscriptStep[] {
  const contextRefs = input.contextRefs;
  const beforeRefs = contextRefs.filter((ref) =>
    ref.startsWith('window:')
      || ref.startsWith('observation:')
      || ref.startsWith('freshness:')
      || ref.startsWith('file-ref:')
      || ref.startsWith('selected-file:')
      || ref.startsWith('selection-ref:')
      || ref.startsWith('cursor-ref:')
      || ref.startsWith('range-ref:')
  );
  const draftRefs = [input.draftTextRef, input.previewArtifactRef].filter(isDefined);
  const afterRefs = replaceObservationRefs(beforeRefs, 'after');

  return [
    step('observe-current-vscode', input.runRef, 'observe', beforeRefs),
    step('read-editor-context', input.runRef, 'read-context', beforeRefs),
    step('editor-scope', input.runRef, 'observe', beforeRefs),
    step('preview-current-selection', input.runRef, 'preview', [
      ...beforeRefs.filter(isSelectionScopeRef),
      ...draftRefs,
    ]),
    step('apply-current-selection', input.runRef, 'replace-selection', [
      ...beforeRefs.filter(isSelectionScopeRef),
      ...draftRefs.filter((ref) => ref.startsWith('text-ref:')),
    ]),
    step('observe-current-vscode', input.runRef, 'observe', afterRefs),
    step('verify-current-selection-apply', input.runRef, 'verify', [
      ...beforeRefs.filter(isSelectionScopeRef),
      ...afterRefs,
      ...input.verifierRefs,
    ]),
    step('save-current-file', input.runRef, 'key:Meta+S', [
      ...afterRefs.filter((ref) => ref.startsWith('window:') || ref.startsWith('file-ref:') || ref.startsWith('selected-file:')),
      ...input.verifierRefs,
    ]),
    step('release-current-vscode', input.runRef, 'release', input.cleanupRefs),
  ];
}

function step(
  operationId: CurrentVSCodeOperationId,
  runRef: string | undefined,
  primitive: CurrentVSCodePrimitive,
  refs: string[],
): CurrentVSCodeOperationTranscriptStep {
  const operationRef = operationRefFor(operationId, runRef);
  return {
    operationId,
    operationRef,
    primitive,
    refs: uniqueStrings([operationRef, ...sanitizeRefs(refs)]),
  };
}

function operationRefFor(operationId: CurrentVSCodeOperationId, runRef: string | undefined): string {
  const token = runRef?.split(':').at(-1) ?? 'unit';
  return `operation-ref:vscode:${operationId}:${token}`;
}

function sanitizeRefs(refs: readonly string[]): string[] {
  return uniqueStrings(refs.filter(isSafeRef));
}

function firstSafeRef(refs: readonly string[]): string | undefined {
  return sanitizeRefs(refs)[0];
}

function isSafeRef(ref: unknown): ref is string {
  return typeof ref === 'string'
    && ref.length <= 240
    && SAFE_REF_TOKEN_PATTERN.test(ref)
    && SAFE_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))
    && !UNSAFE_REF_PATTERN.test(ref);
}

function isSelectionScopeRef(ref: string): boolean {
  return ref.startsWith('window:')
    || ref.startsWith('file-ref:')
    || ref.startsWith('selected-file:')
    || ref.startsWith('selection-ref:')
    || ref.startsWith('cursor-ref:')
    || ref.startsWith('range-ref:')
    || ref.startsWith('freshness:');
}

function currentEditorScopeBlockedReasonRefs(refs: readonly string[]): string[] {
  const reasonRefs: string[] = [];
  const hasFileRef = refs.some((ref) => ref.startsWith('file-ref:') || ref.startsWith('selected-file:'));
  const hasSelectionRef = refs.some((ref) => ref.startsWith('selection-ref:'));
  const hasCursorRef = refs.some((ref) => ref.startsWith('cursor-ref:'));
  const hasRangeRef = refs.some((ref) => ref.startsWith('range-ref:'));
  const hasFreshnessRef = refs.some((ref) => ref.startsWith('freshness:'));
  if (!hasFileRef) reasonRefs.push('blocked:current-vscode-operation-transcript:file-ref-required');
  if (!hasSelectionRef) reasonRefs.push('blocked:current-vscode-operation-transcript:selection-ref-required');
  if (!hasCursorRef) reasonRefs.push('blocked:current-vscode-operation-transcript:cursor-ref-required');
  if (!hasRangeRef) reasonRefs.push('blocked:current-vscode-operation-transcript:range-ref-required');
  if (!hasFreshnessRef) reasonRefs.push('blocked:current-vscode-operation-transcript:freshness-ref-required');
  return reasonRefs;
}

function replaceObservationRefs(refs: string[], suffix: string): string[] {
  return refs.map((ref) => {
    if (ref.startsWith('observation:') || ref.startsWith('freshness:')) {
      return ref.replace(/:[^:]+$/u, `:${suffix}`);
    }
    return ref;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isDefined(value: string | undefined): value is string {
  return typeof value === 'string';
}
