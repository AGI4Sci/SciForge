import { createVSCodeAppModule } from './vscode-app-module.js';

interface VSCodeVerifierObservation {
  refs: string[];
  invalidRefs: string[];
  windowRefs: string[];
  observationRefs: string[];
  editorRefs: string[];
  selectionRefs: string[];
  terminalRefs: string[];
  freshnessRefs: string[];
}

export type VSCodeAppVerifierResult =
  | {
    status: 'ready';
    evidenceRefs: string[];
  }
  | {
    status: 'blocked';
    reasonRef: string;
    evidenceRefs: string[];
  };

export function verifyVSCodeFocusedEditorEvidence(input: { refs: string[] }): VSCodeAppVerifierResult {
  const observation = normalizeVSCodeVerifierObservation(input.refs);
  if (observation.invalidRefs.length > 0) {
    return verifierBlocked('blocked:vscode-app-module:raw-ref-not-allowed', observation.refs);
  }
  if (!input.refs.some((ref) => ref.startsWith('action:vscode:focus-editor') || ref.startsWith('executor-event:vscode:focus-editor') || ref.startsWith('input-event:vscode:focus-editor'))) {
    return verifierBlocked('blocked:vscode-app-module:focus-action-ref-required', observation.refs);
  }
  if (observation.observationRefs.length === 0 || observation.freshnessRefs.length === 0) {
    return verifierBlocked('blocked:vscode-app-module:after-observe-ref-required', observation.refs);
  }
  if (observation.editorRefs.length === 0) {
    return verifierBlocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
  }
  if (observation.terminalRefs.length > 0 && observation.editorRefs.length === 0) {
    return verifierBlocked('blocked:vscode-app-module:terminal-is-not-editor', observation.refs);
  }
  const token = safeToken(uniqueStrings([
    observation.windowRefs[0],
    observation.observationRefs[0],
    observation.editorRefs[0],
    observation.freshnessRefs[0],
  ]).join(':')) || 'current';
  return {
    status: 'ready',
    evidenceRefs: uniqueStrings([
      ...observation.refs,
      `focused-editor:vscode:module:${token}`,
      `verifier:vscode-app-module:focus-editor:${token}`,
    ]),
  };
}

function normalizeVSCodeVerifierObservation(refs: string[]): VSCodeVerifierObservation {
  return createVSCodeAppModule().normalizeObservation({ refs }) as VSCodeVerifierObservation;
}

export function verifyVSCodeSameFileEvidence(input: { beforeRefs: string[]; afterRefs: string[] }): VSCodeAppVerifierResult {
  const beforeFiles = uniqueStrings(input.beforeRefs.filter(isVSCodeFileVerifierRef));
  const afterFiles = uniqueStrings(input.afterRefs.filter(isVSCodeFileVerifierRef));
  if (beforeFiles.length !== 1 || afterFiles.length !== 1) {
    return verifierBlocked('blocked:vscode-app-module:single-file-ref-required', uniqueStrings([...beforeFiles, ...afterFiles]));
  }
  if (beforeFiles[0] !== afterFiles[0]) {
    return verifierBlocked('blocked:vscode-app-module:file-ref-drift', uniqueStrings([...beforeFiles, ...afterFiles]));
  }
  return {
    status: 'ready',
    evidenceRefs: [
      beforeFiles[0],
      `verifier:vscode-app-module:same-file:${safeToken(beforeFiles[0]) || 'file'}`,
    ],
  };
}

export function verifyVSCodeMutationEvidence(input: {
  beforeRefs: string[];
  actionRefs: string[];
  afterRefs: string[];
}): VSCodeAppVerifierResult {
  if (!input.actionRefs.some((ref) => ref.startsWith('action:') || ref.startsWith('window-action:'))) {
    return verifierBlocked('blocked:vscode-app-module:mutation-action-ref-required', uniqueStrings([
      ...input.beforeRefs,
      ...input.afterRefs,
    ]));
  }
  const sameFile = verifyVSCodeSameFileEvidence({
    beforeRefs: input.beforeRefs,
    afterRefs: input.afterRefs,
  });
  if (sameFile.status === 'blocked') return sameFile;

  const sameWindow = verifySameMutationRef({
    beforeRefs: input.beforeRefs,
    afterRefs: input.afterRefs,
    match: (ref) => ref.startsWith('window:vscode:'),
    missingReasonRef: 'blocked:vscode-app-module:single-window-ref-required',
    driftReasonRef: 'blocked:vscode-app-module:window-ref-drift',
    verifierKind: 'same-window',
  });
  if (sameWindow.status === 'blocked') return sameWindow;

  const sameEditor = verifySameMutationRef({
    beforeRefs: input.beforeRefs,
    afterRefs: input.afterRefs,
    match: isVSCodeEditorVerifierRef,
    missingReasonRef: 'blocked:vscode-app-module:single-editor-ref-required',
    driftReasonRef: 'blocked:vscode-app-module:editor-ref-drift',
    verifierKind: 'same-editor',
  });
  if (sameEditor.status === 'blocked') return sameEditor;

  const sameSelection = verifySameMutationRef({
    beforeRefs: input.beforeRefs,
    afterRefs: input.afterRefs,
    match: (ref) => ref.startsWith('selection-ref:vscode:'),
    missingReasonRef: 'blocked:vscode-app-module:single-selection-ref-required',
    driftReasonRef: 'blocked:vscode-app-module:selection-ref-drift',
    verifierKind: 'same-selection',
  });
  if (sameSelection.status === 'blocked') return sameSelection;

  const afterObserve = verifyMutationAfterObserve(input.afterRefs);
  if (afterObserve.status === 'blocked') return afterObserve;

  if (!input.afterRefs.some((ref) => ref.startsWith('text:') || ref.startsWith('verifier:'))) {
    return verifierBlocked('blocked:vscode-app-module:mutation-after-text-ref-required', uniqueStrings([
      ...input.beforeRefs,
      ...input.actionRefs,
      ...input.afterRefs,
    ]));
  }
  const fileRef = sameFile.evidenceRefs[0];
  return {
    status: 'ready',
    evidenceRefs: uniqueStrings([
      fileRef,
      ...sameFile.evidenceRefs.slice(1),
      ...sameWindow.evidenceRefs,
      ...sameEditor.evidenceRefs,
      ...sameSelection.evidenceRefs,
      ...input.actionRefs,
      ...afterObserve.evidenceRefs,
      ...input.afterRefs.filter((ref) => ref.startsWith('text:')),
      `verifier:vscode-app-module:mutation:${safeToken(fileRef) || 'file'}`,
    ]),
  };
}

function verifySameMutationRef(input: {
  beforeRefs: string[];
  afterRefs: string[];
  match: (ref: string) => boolean;
  missingReasonRef: string;
  driftReasonRef: string;
  verifierKind: string;
}): VSCodeAppVerifierResult {
  const beforeRefs = uniqueStrings(input.beforeRefs.filter(input.match));
  const afterRefs = uniqueStrings(input.afterRefs.filter(input.match));
  if (beforeRefs.length !== 1 || afterRefs.length !== 1) {
    return verifierBlocked(input.missingReasonRef, uniqueStrings([...beforeRefs, ...afterRefs]));
  }
  if (beforeRefs[0] !== afterRefs[0]) {
    return verifierBlocked(input.driftReasonRef, uniqueStrings([...beforeRefs, ...afterRefs]));
  }
  return {
    status: 'ready',
    evidenceRefs: [
      beforeRefs[0],
      `verifier:vscode-app-module:${input.verifierKind}:${safeToken(beforeRefs[0]) || input.verifierKind}`,
    ],
  };
}

function verifyMutationAfterObserve(afterRefs: string[]): VSCodeAppVerifierResult {
  const observationRefs = uniqueStrings(afterRefs.filter((ref) => ref.startsWith('observation:vscode:')));
  const freshnessRefs = uniqueStrings(afterRefs.filter((ref) => ref.startsWith('freshness:vscode:')));
  if (observationRefs.length !== 1 || freshnessRefs.length !== 1) {
    return verifierBlocked('blocked:vscode-app-module:after-observe-ref-required', uniqueStrings([
      ...observationRefs,
      ...freshnessRefs,
    ]));
  }
  return {
    status: 'ready',
    evidenceRefs: [
      observationRefs[0],
      freshnessRefs[0],
      `verifier:vscode-app-module:after-observe:${safeToken(observationRefs[0]) || 'after-observe'}`,
    ],
  };
}

function isVSCodeEditorVerifierRef(ref: string): boolean {
  return ref.startsWith('element:vscode:editor:')
    || ref.startsWith('element:vscode:monaco:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('active-editor:vscode:');
}

function isVSCodeFileVerifierRef(ref: string): boolean {
  return ref.startsWith('file-ref:vscode:')
    || ref.startsWith('selected-file:vscode:');
}

function verifierBlocked(reasonRef: string, evidenceRefs: string[] = []): VSCodeAppVerifierResult {
  return {
    status: 'blocked',
    reasonRef,
    evidenceRefs,
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
