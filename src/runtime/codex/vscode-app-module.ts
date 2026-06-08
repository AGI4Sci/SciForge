import {
  validateComputerUseAppModuleReadiness,
  type ComputerUseAppModule,
  type ComputerUseAppModuleReadiness,
} from './computer-use-app-module-registry.js';

const VSCODE_CAPABILITIES = [
  'read-visible-text',
  'focus-editor',
  'move-cursor',
  'insert-draft',
  'replace-selection',
  'save-current-file',
  'undo-last-action',
  'redo-last-action',
  'show-problems',
  'read-diagnostics',
  'focus-terminal',
  'send-terminal-text',
  'observe-terminal',
  'submit-terminal-command',
  'interrupt-terminal-command',
  'clear-terminal',
  'focus-editor-from-terminal',
  'open-command-palette',
  'send-command-palette-query',
  'observe-command-palette-items',
  'select-command-palette-item',
  'close-command-palette',
] as const;

export interface VSCodeAppObservation {
  refs: string[];
  invalidRefs: string[];
  appRefs: string[];
  processRefs: string[];
  sessionRefs: string[];
  windowRefs: string[];
  frontmostRefs: string[];
  observationRefs: string[];
  fileRefs: string[];
  editorRefs: string[];
  terminalRefs: string[];
  commandPaletteRefs: string[];
  commandPaletteItemRefs: string[];
  diagnosticsRefs: string[];
  unknownWebviewRefs: string[];
  freshnessRefs: string[];
  focusedEditorRefs: string[];
  selectionRefs: string[];
  textRefRefs: string[];
  textRefs: string[];
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

export function createVSCodeAppModule(): ComputerUseAppModule {
  return {
    moduleId: 'vscode',
    canHandle: ({ refs }) => normalizeVSCodeObservationRefs(refs).hasVSCodeIdentity,
    normalizeObservation: ({ refs }) => normalizeVSCodeObservationRefs(refs),
    getCapabilities: () => [...VSCODE_CAPABILITIES],
    checkReadiness: ({ operation, refs }) => checkVSCodeReadiness(operation, refs),
  };
}

export function normalizeVSCodeObservationRefs(refs: string[]): VSCodeAppObservation & { hasVSCodeIdentity: boolean } {
  const invalidRefs = refs.filter(isRawRef);
  const safeRefs = uniqueStrings(refs.filter((ref) => !isRawRef(ref)));
  const observation: VSCodeAppObservation & { hasVSCodeIdentity: boolean } = {
    refs: safeRefs,
    invalidRefs,
    appRefs: safeRefs.filter((ref) => ref === 'macos-app:vscode' || ref.startsWith('macos-app:vscode:')),
    processRefs: safeRefs.filter((ref) => ref.startsWith('process:vscode')),
    sessionRefs: safeRefs.filter((ref) => ref.startsWith('window-action-session:vscode:') || ref.startsWith('computer-use-session:vscode:')),
    windowRefs: safeRefs.filter((ref) => ref.startsWith('window:vscode:')),
    frontmostRefs: safeRefs.filter((ref) => ref.startsWith('frontmost:vscode:')),
    observationRefs: safeRefs.filter((ref) => ref.startsWith('observation:vscode:')),
    fileRefs: safeRefs.filter((ref) => ref.startsWith('file-ref:vscode:')),
    editorRefs: safeRefs.filter(isEditorRef),
    terminalRefs: safeRefs.filter(isTerminalRef),
    commandPaletteRefs: safeRefs.filter(isCommandPaletteRef),
    commandPaletteItemRefs: safeRefs.filter((ref) => ref.startsWith('command-palette-item:vscode:')),
    diagnosticsRefs: safeRefs.filter(isDiagnosticsRef),
    unknownWebviewRefs: safeRefs.filter(isUnknownWebviewRef),
    freshnessRefs: safeRefs.filter((ref) => ref.startsWith('freshness:vscode:')),
    focusedEditorRefs: safeRefs.filter((ref) => ref.startsWith('focused-editor:vscode:')),
    selectionRefs: safeRefs.filter((ref) => ref.startsWith('selection-ref:vscode:')),
    textRefRefs: safeRefs.filter((ref) => ref.startsWith('text-ref:')),
    textRefs: safeRefs.filter((ref) => ref.startsWith('text:')),
    hasVSCodeIdentity: false,
  };
  observation.hasVSCodeIdentity = observation.appRefs.length > 0
    || observation.processRefs.length > 0
    || observation.windowRefs.length > 0
    || safeRefs.includes('intent:current-vscode-cowork');
  return observation;
}

function checkVSCodeReadiness(operation: string, refs: string[]): ComputerUseAppModuleReadiness {
  const observation = normalizeVSCodeObservationRefs(refs);
  if (observation.invalidRefs.length > 0) {
    return blocked('blocked:vscode-app-module:raw-ref-not-allowed', observation.refs);
  }
  if (!VSCODE_CAPABILITIES.includes(operation as typeof VSCODE_CAPABILITIES[number])) {
    return blocked('blocked:vscode-app-module:operation-not-supported', observation.refs);
  }
  if (observation.windowRefs.length === 0) {
    return blocked('blocked:vscode-app-module:window-ref-required', observation.refs);
  }
  if (observation.windowRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-window-ambiguous', observation.windowRefs);
  }
  if (operation === 'read-visible-text') {
    if (observation.editorRefs.length === 0) {
      return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
    }
    const commonGate = checkCommonObservationGate(observation);
    if (commonGate) return commonGate;
    if (observation.fileRefs.length === 0) {
      return blocked('blocked:vscode-app-module:file-ref-required', observation.refs);
    }
    if (observation.fileRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', observation.fileRefs);
    }
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          observation.editorRefs[0],
          observation.fileRefs[0],
          observation.freshnessRefs[0],
        ]),
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.observationRefs[0],
        observation.editorRefs[0],
        observation.fileRefs[0],
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (operation === 'read-diagnostics' || operation === 'show-problems') {
    if (observation.diagnosticsRefs.length === 0) {
      return blocked('blocked:vscode-app-module:diagnostics-ref-required', observation.refs);
    }
    const commonGate = checkCommonObservationGate(observation);
    if (commonGate) return commonGate;
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          observation.diagnosticsRefs[0],
          observation.freshnessRefs[0],
        ]),
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.observationRefs[0],
        observation.diagnosticsRefs[0],
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (operation === 'focus-editor') {
    if (observation.editorRefs.length === 0) {
      return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
    }
    const commonGate = checkCommonObservationGate(observation);
    if (commonGate) return commonGate;
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          observation.editorRefs[0],
          observation.freshnessRefs[0],
        ]),
        action: {
          kind: 'key',
          key: 'Meta+1',
        },
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.observationRefs[0],
        observation.editorRefs[0],
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (operation === 'insert-draft' || operation === 'replace-selection') {
    const mutationGate = checkEditorMutationGate(observation);
    if (mutationGate) return mutationGate;
    const textRef = observation.textRefRefs[0];
    if (!textRef) {
      return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
    }
    const selectionRef = operation === 'replace-selection' ? observation.selectionRefs[0] : undefined;
    if (operation === 'replace-selection' && !selectionRef) {
      return blocked('blocked:vscode-app-module:selection-ref-required', observation.refs);
    }
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          observation.editorRefs[0],
          observation.fileRefs[0],
          observation.focusedEditorRefs[0],
          selectionRef,
          textRef,
          observation.freshnessRefs[0],
        ]),
        action: {
          kind: 'type',
          textRef,
          ...(selectionRef ? { replaceSelectionRef: selectionRef } : {}),
        },
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.fileRefs[0],
        observation.focusedEditorRefs[0],
        selectionRef,
        textRef,
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (operation === 'save-current-file') {
    const commonGate = checkCommonObservationGate(observation);
    if (commonGate) return commonGate;
    if (observation.editorRefs.length === 0) {
      return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
    }
    if (observation.fileRefs.length !== 1) {
      return observation.fileRefs.length > 1
        ? needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', observation.fileRefs)
        : blocked('blocked:vscode-app-module:file-ref-required', observation.refs);
    }
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          observation.editorRefs[0],
          observation.fileRefs[0],
          observation.freshnessRefs[0],
        ]),
        action: {
          kind: 'key',
          key: 'Meta+S',
        },
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.fileRefs[0],
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (isTerminalOperation(operation)) {
    return checkTerminalReadiness(operation, observation);
  }
  if (isCommandPaletteOperation(operation)) {
    return checkCommandPaletteReadiness(operation, observation);
  }
  return blocked(`blocked:vscode-app-module:${safeToken(operation) || 'operation'}-readiness-not-implemented`, observation.refs);
}

export function verifyVSCodeFocusedEditorEvidence(input: { refs: string[] }): VSCodeAppVerifierResult {
  const observation = normalizeVSCodeObservationRefs(input.refs);
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

function checkEditorMutationGate(observation: VSCodeAppObservation): ComputerUseAppModuleReadiness | undefined {
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return commonGate;
  if (observation.editorRefs.length === 0) {
    return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
  }
  if (observation.fileRefs.length === 0) {
    return blocked('blocked:vscode-app-module:file-ref-required', observation.refs);
  }
  if (observation.fileRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', observation.fileRefs);
  }
  if (observation.focusedEditorRefs.length === 0) {
    return blocked('blocked:vscode-app-module:focused-editor-ref-required', observation.refs);
  }
  return undefined;
}

function checkTerminalReadiness(operation: string, observation: VSCodeAppObservation): ComputerUseAppModuleReadiness {
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return commonGate;
  if (observation.terminalRefs.length === 0) {
    return blocked('blocked:vscode-app-module:terminal-ref-required', observation.refs);
  }
  if (observation.terminalRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-terminal-ambiguous', observation.terminalRefs);
  }
  const terminalRef = observation.terminalRefs[0];
  if (operation === 'send-terminal-text') {
    const textRef = observation.textRefRefs[0];
    if (!textRef) return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
    return actReady(operation, observation, [terminalRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-terminal') {
    return observeReady(operation, observation, [terminalRef]);
  }
  if (operation === 'submit-terminal-command') {
    return actReady(operation, observation, [terminalRef], {
      kind: 'key',
      key: 'Enter',
    });
  }
  if (operation === 'interrupt-terminal-command') {
    return actReady(operation, observation, [terminalRef], {
      kind: 'key',
      key: 'Control+C',
    });
  }
  if (operation === 'clear-terminal') {
    return actReady(operation, observation, [terminalRef], {
      kind: 'key',
      key: 'Meta+K',
    });
  }
  if (operation === 'focus-terminal') {
    return actReady(operation, observation, [terminalRef], {
      kind: 'key',
      key: 'Control+Backquote',
    });
  }
  return actReady(operation, observation, [terminalRef], {
    kind: 'key',
    key: 'Meta+1',
  });
}

function checkCommandPaletteReadiness(operation: string, observation: VSCodeAppObservation): ComputerUseAppModuleReadiness {
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return commonGate;
  if (operation === 'open-command-palette') {
    return actReady(operation, observation, [], {
      kind: 'key',
      key: 'Meta+Shift+P',
    });
  }
  const paletteRef = observation.commandPaletteRefs.find((ref) => !ref.startsWith('command-palette-item:'));
  if (!paletteRef) {
    return blocked('blocked:vscode-app-module:command-palette-ref-required', observation.refs);
  }
  if (operation === 'send-command-palette-query') {
    const textRef = observation.textRefRefs[0];
    if (!textRef) return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
    return actReady(operation, observation, [paletteRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-command-palette-items') {
    return observeReady(operation, observation, [paletteRef]);
  }
  if (operation === 'select-command-palette-item') {
    const itemRef = observation.commandPaletteItemRefs.find((ref) => currentPaletteItemRef(ref, paletteRef));
    if (!itemRef) return blocked('blocked:vscode-app-module:current-palette-item-ref-required', observation.refs);
    return actReady(operation, observation, [paletteRef, itemRef], {
      kind: 'key',
      key: 'Enter',
      itemRef,
    });
  }
  return actReady(operation, observation, [paletteRef], {
    kind: 'key',
    key: 'Escape',
  });
}

function observeReady(operation: string, observation: VSCodeAppObservation, targetRefs: string[]): ComputerUseAppModuleReadiness {
  return validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.observe',
      inputRefs: uniqueStrings([
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.observationRefs[0],
        ...targetRefs,
        observation.freshnessRefs[0],
      ]),
    },
    evidenceRefs: uniqueStrings([
      'module:vscode-app',
      `capability:vscode:${operation}`,
      observation.sessionRefs[0],
      observation.windowRefs[0],
      ...targetRefs,
      observation.freshnessRefs[0],
    ]),
  });
}

function actReady(operation: string, observation: VSCodeAppObservation, targetRefs: string[], action: Record<string, unknown>): ComputerUseAppModuleReadiness {
  return validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.act',
      inputRefs: uniqueStrings([
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.observationRefs[0],
        ...targetRefs,
        observation.freshnessRefs[0],
      ]),
      action,
    },
    evidenceRefs: uniqueStrings([
      'module:vscode-app',
      `capability:vscode:${operation}`,
      observation.sessionRefs[0],
      observation.windowRefs[0],
      ...targetRefs,
      observation.freshnessRefs[0],
    ]),
  });
}

function currentPaletteItemRef(itemRef: string, paletteRef: string): boolean {
  const paletteToken = paletteRef.split(':')[2];
  return Boolean(paletteToken) && itemRef.startsWith(`command-palette-item:vscode:${paletteToken}:`);
}

function isTerminalOperation(operation: string): boolean {
  return operation === 'focus-terminal'
    || operation === 'send-terminal-text'
    || operation === 'observe-terminal'
    || operation === 'submit-terminal-command'
    || operation === 'interrupt-terminal-command'
    || operation === 'clear-terminal'
    || operation === 'focus-editor-from-terminal';
}

function isCommandPaletteOperation(operation: string): boolean {
  return operation === 'open-command-palette'
    || operation === 'send-command-palette-query'
    || operation === 'observe-command-palette-items'
    || operation === 'select-command-palette-item'
    || operation === 'close-command-palette';
}

function checkCommonObservationGate(observation: VSCodeAppObservation): ComputerUseAppModuleReadiness | undefined {
  if (observation.sessionRefs.length === 0) {
    return blocked('blocked:vscode-app-module:active-session-ref-required', observation.refs);
  }
  if (observation.appRefs.length === 0 || observation.processRefs.length === 0 || observation.frontmostRefs.length === 0) {
    return blocked('blocked:vscode-app-module:window-identity-refs-required', observation.refs);
  }
  if (observation.observationRefs.length === 0 || observation.freshnessRefs.length === 0) {
    return blocked('blocked:vscode-app-module:fresh-observation-required', observation.refs);
  }
  return undefined;
}

function blocked(reasonRef: string, evidenceRefs: string[] = []): ComputerUseAppModuleReadiness {
  return {
    status: 'blocked',
    reasonRef,
    evidenceRefs,
  };
}

function needsConfirmation(reasonRef: string, evidenceRefs: string[] = []): ComputerUseAppModuleReadiness {
  return {
    status: 'needs-confirmation',
    reasonRef,
    evidenceRefs,
  };
}

function verifierBlocked(reasonRef: string, evidenceRefs: string[] = []): VSCodeAppVerifierResult {
  return {
    status: 'blocked',
    reasonRef,
    evidenceRefs,
  };
}

function isEditorRef(ref: string): boolean {
  return ref.startsWith('element:vscode:editor:')
    || ref.startsWith('element:vscode:monaco:')
    || ref.startsWith('focused-editor:vscode:');
}

function isTerminalRef(ref: string): boolean {
  return ref.startsWith('element:vscode:terminal:') || ref.startsWith('terminal:vscode:');
}

function isCommandPaletteRef(ref: string): boolean {
  return ref.startsWith('element:vscode:command-palette:')
    || ref.startsWith('command-palette:vscode:')
    || ref.startsWith('command-palette-item:vscode:');
}

function isDiagnosticsRef(ref: string): boolean {
  return ref.startsWith('diagnostics:vscode:')
    || ref.startsWith('problems:vscode:')
    || ref.startsWith('element:vscode:problems:');
}

function isUnknownWebviewRef(ref: string): boolean {
  return ref.startsWith('element:vscode:webview:')
    && !isEditorRef(ref)
    && !isTerminalRef(ref)
    && !isCommandPaletteRef(ref)
    && !isDiagnosticsRef(ref);
}

function isRawRef(ref: string): boolean {
  return /(^|:)raw[-:]|base64|data:image|providerPayload|provider-payload|screenshot-path|file:\/\/|https?:\/\//i.test(ref);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
