import { createVSCodeAppModule } from './vscode-app-module.js';

interface VSCodeVerifierObservation {
  refs: string[];
  invalidRefs: string[];
  windowRefs: string[];
  observationRefs: string[];
  editorRefs: string[];
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
  const beforeFiles = uniqueStrings(input.beforeRefs.filter((ref) => ref.startsWith('file-ref:vscode:')));
  const afterFiles = uniqueStrings(input.afterRefs.filter((ref) => ref.startsWith('file-ref:vscode:')));
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
  const sameFile = verifyVSCodeSameFileEvidence({
    beforeRefs: input.beforeRefs,
    afterRefs: input.afterRefs,
  });
  if (sameFile.status === 'blocked') return sameFile;
  if (!input.actionRefs.some((ref) => ref.startsWith('action:') || ref.startsWith('window-action:'))) {
    return verifierBlocked('blocked:vscode-app-module:mutation-action-ref-required', uniqueStrings([
      ...input.beforeRefs,
      ...input.afterRefs,
    ]));
  }
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
      ...input.actionRefs,
      ...input.afterRefs.filter((ref) => ref.startsWith('text:')),
      `verifier:vscode-app-module:mutation:${safeToken(fileRef) || 'file'}`,
    ]),
  };
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
