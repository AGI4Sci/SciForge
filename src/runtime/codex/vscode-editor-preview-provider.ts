import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

export interface VSCodeEditorPreviewProviderInput {
  attemptId: string;
  operationRef: string;
  scopeRefs: string[];
  draftArtifactRef: string;
  diffArtifactRef?: string;
}

export interface VSCodeEditorPreviewProviderResult {
  schemaVersion: 'sciforge.vscode-editor.preview-provider.v1';
  status: 'completed' | 'blocked';
  message: string;
  maturity: 'unit-proven';
  productReady: false;
  previewStatus?: 'ready';
  artifactRefs: string[];
  evidenceRefs: string[];
  scopeRefs: string[];
  draftArtifactRef?: string;
  diffArtifactRef?: string;
  previewArtifactRef?: string;
  primitiveCandidates: [];
}

export function createVSCodeEditorPreview(
  input: VSCodeEditorPreviewProviderInput,
): VSCodeEditorPreviewProviderResult {
  const attemptToken = safeToken(input.attemptId);
  const blocked = (reason: string, evidenceRefs: string[] = []): VSCodeEditorPreviewProviderResult =>
    sanitizeResult({
      schemaVersion: 'sciforge.vscode-editor.preview-provider.v1',
      status: 'blocked',
      message: 'VSCode editor preview provider blocked before creating preview artifact refs.',
      maturity: 'unit-proven',
      productReady: false,
      artifactRefs: [],
      evidenceRefs: uniqueStrings([
        `blocked:vscode-editor-preview:${reason}`,
        ...safePreviewEvidenceRefs(evidenceRefs),
      ]),
      scopeRefs: safePreviewScopeRefs(input.scopeRefs),
      primitiveCandidates: [],
    });

  if (!attemptToken) return blocked('attempt-ref-required');
  const operationRef = safePreviewOperationRef(input.operationRef);
  if (!operationRef) return blocked('operation-ref-required');
  if (hasUnsafePreviewRef(input.scopeRefs)) return blocked('unsafe-scope-ref-not-allowed');

  const scopeRefs = safePreviewScopeRefs(input.scopeRefs);
  const scopeReason = previewScopeBlockedReason(scopeRefs);
  if (scopeReason) return blocked(scopeReason, scopeRefs);

  const draftArtifactRef = safePreviewArtifactRef(input.draftArtifactRef);
  if (!draftArtifactRef) return blocked('draft-artifact-ref-required', scopeRefs);

  const diffArtifactRef = input.diffArtifactRef === undefined
    ? `artifact:vscode-editor-preview-diff:${attemptToken}`
    : safePreviewArtifactRef(input.diffArtifactRef);
  if (!diffArtifactRef) return blocked('diff-artifact-ref-required', scopeRefs);

  const previewArtifactRef = `artifact:vscode-editor-preview:${attemptToken}`;
  const verifierRef = `verifier:vscode-editor-preview:${attemptToken}:refs-only`;
  const artifactRefs = uniqueStrings([
    draftArtifactRef,
    previewArtifactRef,
    diffArtifactRef,
  ]);
  const evidenceRefs = uniqueStrings([
    ...scopeRefs,
    ...artifactRefs,
    verifierRef,
  ]);
  return sanitizeResult({
    schemaVersion: 'sciforge.vscode-editor.preview-provider.v1',
    status: 'completed',
    message: 'VSCode editor preview provider created refs-only preview artifact refs.',
    maturity: 'unit-proven',
    productReady: false,
    previewStatus: 'ready',
    artifactRefs,
    evidenceRefs,
    scopeRefs,
    draftArtifactRef,
    diffArtifactRef,
    previewArtifactRef,
    primitiveCandidates: [],
  });
}

function sanitizeResult(result: VSCodeEditorPreviewProviderResult): VSCodeEditorPreviewProviderResult {
  return sanitizePublicEvent(result) as VSCodeEditorPreviewProviderResult;
}

function safePreviewScopeRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter(isSafePreviewScopeRef));
}

function safePreviewEvidenceRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) =>
    isSafePreviewScopeRef(ref)
      || safePreviewArtifactRef(ref) !== undefined
      || safePreviewOperationRef(ref) !== undefined
      || ref.startsWith('blocked:vscode-editor-preview:')
      || ref.startsWith('needs-confirmation:vscode-editor-preview:')
      || ref.startsWith('verifier:vscode-editor-preview:')
  ));
}

function isSafePreviewScopeRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (unsafePreviewString(ref)) return false;
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

function safePreviewArtifactRef(ref: string | undefined): string | undefined {
  const value = ref?.trim();
  if (!value || value.length > 240) return undefined;
  if (unsafePreviewString(value)) return undefined;
  return /^artifact:[A-Za-z0-9._:-]+$/u.test(value) ? value : undefined;
}

function safePreviewOperationRef(ref: string | undefined): string | undefined {
  const value = ref?.trim();
  if (!value || value.length > 240) return undefined;
  if (unsafePreviewString(value)) return undefined;
  return /^operation-ref:vscode:preview-[a-z0-9-]+:[A-Za-z0-9._:-]+$/u.test(value) ? value : undefined;
}

function previewScopeBlockedReason(refs: string[]): string | undefined {
  if (!refs.some((ref) => ref.startsWith('element:vscode:editor:') || ref.startsWith('element:vscode:monaco:') || ref.startsWith('focused-editor:vscode:'))) {
    return 'editor-scope-editor-ref-required';
  }
  if (!refs.some((ref) => ref.startsWith('file-ref:vscode:') || ref.startsWith('selected-file:vscode:'))) {
    return 'editor-scope-file-ref-required';
  }
  if (!refs.some((ref) => ref.startsWith('selection-ref:vscode:'))) {
    return 'editor-scope-selection-ref-required';
  }
  if (!refs.some((ref) => ref.startsWith('cursor-ref:vscode:'))) {
    return 'editor-scope-cursor-ref-required';
  }
  if (!refs.some((ref) => ref.startsWith('range-ref:vscode:'))) {
    return 'editor-scope-range-ref-required';
  }
  if (!refs.some((ref) => ref.startsWith('freshness:vscode:'))) {
    return 'editor-scope-freshness-ref-required';
  }
  return undefined;
}

function hasUnsafePreviewRef(refs: string[]): boolean {
  return refs.some((ref) =>
    typeof ref !== 'string'
      || ref !== ref.trim()
      || unsafePreviewString(ref)
      || (isPreviewScopeFamily(ref) && !isSafePreviewScopeRef(ref))
  );
}

function isPreviewScopeFamily(ref: string): boolean {
  return ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('range-ref:vscode:');
}

function unsafePreviewString(value: string): boolean {
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
