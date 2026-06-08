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

interface VSCodeAppObservation {
  refs: string[];
  invalidRefs: string[];
  identityRefs: string[];
  appRefs: string[];
  processRefs: string[];
  sessionRefs: string[];
  windowRefs: string[];
  titleRefs: string[];
  frontmostRefs: string[];
  observationRefs: string[];
  currentObservationRefs: string[];
  staleObservationRefs: string[];
  fileRefs: string[];
  selectedFileRefs: string[];
  editorRefs: string[];
  activeEditorRefs: string[];
  editorGroupRefs: string[];
  cursorRefs: string[];
  terminalRefs: string[];
  commandPaletteRefs: string[];
  commandPaletteItemRefs: string[];
  diagnosticsRefs: string[];
  problemsPanelRefs: string[];
  workspaceRefs: string[];
  unknownWebviewRefs: string[];
  operationRefRefs: string[];
  freshnessRefs: string[];
  focusedEditorRefs: string[];
  selectionRefs: string[];
  textRefRefs: string[];
  textRefs: string[];
  reasonRefs: string[];
  evidenceRefs: string[];
  safeSummary: {
    identity: string;
    freshness: string;
    concepts: string[];
  };
}

export function createVSCodeAppModule(): ComputerUseAppModule {
  return {
    moduleId: 'vscode',
    canHandle: ({ refs }) => normalizeVSCodeObservationRefs(refs).hasVSCodeIdentity,
    normalizeObservation: ({ refs }) => normalizeVSCodeObservationRefs(refs),
    getCapabilities: () => [...VSCODE_CAPABILITIES],
    checkReadiness: ({ operation, refs, operationRef }) => checkVSCodeReadiness(operation, refs, operationRef),
  };
}

function normalizeVSCodeObservationRefs(refs: string[]): VSCodeAppObservation & { hasVSCodeIdentity: boolean } {
  const invalidRefs = refs.some(isRawRef) ? ['blocked:vscode-app-module:raw-ref-not-allowed'] : [];
  const safeRefs = uniqueStrings(refs.filter((ref) => !isRawRef(ref) && isVSCodeObservationRef(ref)));
  const appRefs = safeRefs.filter((ref) => ref === 'macos-app:vscode' || ref.startsWith('macos-app:vscode:'));
  const processRefs = safeRefs.filter((ref) => ref.startsWith('process:vscode'));
  const windowRefs = safeRefs.filter((ref) => ref.startsWith('window:vscode:'));
  const titleRefs = safeRefs.filter((ref) => ref.startsWith('text:title:vscode:') || ref.startsWith('title:vscode:'));
  const frontmostRefs = safeRefs.filter((ref) => ref.startsWith('frontmost:vscode:'));
  const observationRefs = safeRefs.filter((ref) => ref.startsWith('observation:vscode:'));
  const staleObservationRefs = safeRefs.filter((ref) => ref.startsWith('stale-invalidation:vscode:'));
  const fileRefs = safeRefs.filter((ref) => ref.startsWith('file-ref:vscode:'));
  const selectedFileRefs = safeRefs.filter((ref) => ref.startsWith('selected-file:vscode:') || ref.startsWith('file-ref:vscode:current'));
  const editorRefs = safeRefs.filter(isEditorRef);
  const activeEditorRefs = safeRefs.filter((ref) => ref.startsWith('active-editor:vscode:'));
  const editorGroupRefs = safeRefs.filter((ref) => ref.startsWith('editor-group:vscode:'));
  const cursorRefs = safeRefs.filter((ref) => ref.startsWith('cursor-ref:vscode:'));
  const terminalRefs = safeRefs.filter(isTerminalRef);
  const commandPaletteRefs = safeRefs.filter(isCommandPaletteRef);
  const diagnosticsRefs = safeRefs.filter(isDiagnosticsRef);
  const problemsPanelRefs = safeRefs.filter(isProblemsPanelRef);
  const workspaceRefs = safeRefs.filter((ref) => ref.startsWith('workspace-ref:vscode:') || ref.startsWith('workspace:vscode:'));
  const unknownWebviewRefs = safeRefs.filter(isUnknownWebviewRef);
  const reasonRefs = uniqueStrings([
    ...invalidRefs,
    ...(staleObservationRefs.length > 0 ? ['blocked:vscode-app-module:stale-observation'] : []),
  ]);
  const evidenceRefs = conceptEvidenceRefs({
    workspaceRefs,
    fileRefs: selectedFileRefs.length ? selectedFileRefs : fileRefs,
    editorRefs,
    editorGroupRefs,
    activeEditorRefs,
    selectionRefs: safeRefs.filter((ref) => ref.startsWith('selection-ref:vscode:')),
    cursorRefs,
    terminalRefs,
    commandPaletteRefs,
    problemsPanelRefs,
    unknownWebviewRefs,
  });
  const observation: VSCodeAppObservation & { hasVSCodeIdentity: boolean } = {
    refs: safeRefs,
    invalidRefs,
    identityRefs: uniqueStrings([
      ...appRefs,
      ...processRefs,
      ...windowRefs,
      ...titleRefs,
      ...frontmostRefs,
    ]),
    appRefs,
    processRefs,
    sessionRefs: safeRefs.filter((ref) => ref.startsWith('window-action-session:vscode:') || ref.startsWith('computer-use-session:vscode:')),
    windowRefs,
    titleRefs,
    frontmostRefs,
    observationRefs,
    currentObservationRefs: observationRefs,
    staleObservationRefs,
    fileRefs,
    selectedFileRefs,
    editorRefs,
    activeEditorRefs,
    editorGroupRefs,
    cursorRefs,
    terminalRefs,
    commandPaletteRefs,
    commandPaletteItemRefs: safeRefs.filter((ref) => ref.startsWith('command-palette-item:vscode:')),
    diagnosticsRefs,
    problemsPanelRefs,
    workspaceRefs,
    unknownWebviewRefs,
    operationRefRefs: safeRefs.filter((ref) => ref.startsWith('operation-ref:vscode:')),
    freshnessRefs: safeRefs.filter((ref) => ref.startsWith('freshness:vscode:')),
    focusedEditorRefs: safeRefs.filter((ref) => ref.startsWith('focused-editor:vscode:')),
    selectionRefs: safeRefs.filter((ref) => ref.startsWith('selection-ref:vscode:')),
    textRefRefs: safeRefs.filter((ref) => ref.startsWith('text-ref:')),
    textRefs: safeRefs.filter((ref) => ref.startsWith('text:')),
    reasonRefs,
    evidenceRefs,
    safeSummary: {
      identity: appRefs.length > 0 && processRefs.length > 0 && windowRefs.length > 0 && titleRefs.length > 0 && frontmostRefs.length > 0
        ? 'vscode-window-identity:ready'
        : 'vscode-window-identity:incomplete',
      freshness: staleObservationRefs.length > 0
        ? 'vscode-observation:stale'
        : observationRefs.length > 0 && safeRefs.some((ref) => ref.startsWith('freshness:vscode:'))
          ? 'vscode-observation:fresh'
          : 'vscode-observation:missing',
      concepts: conceptSummary({
        workspaceRefs,
        fileRefs: selectedFileRefs.length ? selectedFileRefs : fileRefs,
        editorRefs,
        editorGroupRefs,
        activeEditorRefs,
        selectionRefs: safeRefs.filter((ref) => ref.startsWith('selection-ref:vscode:')),
        cursorRefs,
        terminalRefs,
        commandPaletteRefs,
        problemsPanelRefs,
        unknownWebviewRefs,
      }),
    },
    hasVSCodeIdentity: false,
  };
  observation.hasVSCodeIdentity = observation.appRefs.length > 0
    || observation.processRefs.length > 0
    || observation.windowRefs.length > 0;
  return observation;
}

function checkVSCodeReadiness(operation: string, refs: string[], operationRef: string | undefined): ComputerUseAppModuleReadiness {
  const normalizedOperationRef = hostStructuredOperationRef(operation, operationRef, refs);
  const observation = normalizeVSCodeObservationRefs(uniqueStrings([
    ...refs,
    normalizedOperationRef,
  ]));
  if (observation.invalidRefs.length > 0) {
    return blocked('blocked:vscode-app-module:raw-ref-not-allowed', observation.refs);
  }
  if (!VSCODE_CAPABILITIES.includes(operation as typeof VSCODE_CAPABILITIES[number])) {
    return blocked('blocked:vscode-app-module:operation-not-supported', observation.refs);
  }
  if (!normalizedOperationRef) {
    return blocked('blocked:vscode-app-module:operation-ref-required', observation.refs);
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
          normalizedOperationRef,
        ]),
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        normalizedOperationRef,
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
          normalizedOperationRef,
        ]),
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        normalizedOperationRef,
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
          normalizedOperationRef,
        ]),
        action: {
          kind: 'key',
          key: 'Meta+1',
        },
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        normalizedOperationRef,
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
          normalizedOperationRef,
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
        normalizedOperationRef,
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
          normalizedOperationRef,
        ]),
        action: {
          kind: 'key',
          key: 'Meta+S',
        },
      },
      evidenceRefs: uniqueStrings([
        'module:vscode-app',
        `capability:vscode:${operation}`,
        normalizedOperationRef,
        observation.sessionRefs[0],
        observation.windowRefs[0],
        observation.fileRefs[0],
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (isTerminalOperation(operation)) {
    return checkTerminalReadiness(operation, observation, normalizedOperationRef);
  }
  if (isCommandPaletteOperation(operation)) {
    return checkCommandPaletteReadiness(operation, observation, normalizedOperationRef);
  }
  return blocked(`blocked:vscode-app-module:${safeToken(operation) || 'operation'}-readiness-not-implemented`, observation.refs);
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

function checkTerminalReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
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
    return actReady(operation, operationRef, observation, [terminalRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-terminal') {
    return observeReady(operation, operationRef, observation, [terminalRef]);
  }
  if (operation === 'submit-terminal-command') {
    return actReady(operation, operationRef, observation, [terminalRef], {
      kind: 'key',
      key: 'Enter',
    });
  }
  if (operation === 'interrupt-terminal-command') {
    return actReady(operation, operationRef, observation, [terminalRef], {
      kind: 'key',
      key: 'Control+C',
    });
  }
  if (operation === 'clear-terminal') {
    return actReady(operation, operationRef, observation, [terminalRef], {
      kind: 'key',
      key: 'Meta+K',
    });
  }
  if (operation === 'focus-terminal') {
    return actReady(operation, operationRef, observation, [terminalRef], {
      kind: 'key',
      key: 'Control+Backquote',
    });
  }
  return actReady(operation, operationRef, observation, [terminalRef], {
    kind: 'key',
    key: 'Meta+1',
  });
}

function checkCommandPaletteReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return commonGate;
  if (operation === 'open-command-palette') {
    return actReady(operation, operationRef, observation, [], {
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
    return actReady(operation, operationRef, observation, [paletteRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-command-palette-items') {
    return observeReady(operation, operationRef, observation, [paletteRef]);
  }
  if (operation === 'select-command-palette-item') {
    const itemRef = observation.commandPaletteItemRefs.find((ref) => currentPaletteItemRef(ref, paletteRef));
    if (!itemRef) return blocked('blocked:vscode-app-module:current-palette-item-ref-required', observation.refs);
    return actReady(operation, operationRef, observation, [paletteRef, itemRef], {
      kind: 'key',
      key: 'Enter',
      itemRef,
    });
  }
  return actReady(operation, operationRef, observation, [paletteRef], {
    kind: 'key',
    key: 'Escape',
  });
}

function observeReady(operation: string, operationRef: string, observation: VSCodeAppObservation, targetRefs: string[]): ComputerUseAppModuleReadiness {
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
        operationRef,
      ]),
    },
    evidenceRefs: uniqueStrings([
      'module:vscode-app',
      `capability:vscode:${operation}`,
      operationRef,
      observation.sessionRefs[0],
      observation.windowRefs[0],
      ...targetRefs,
      observation.freshnessRefs[0],
    ]),
  });
}

function actReady(operation: string, operationRef: string, observation: VSCodeAppObservation, targetRefs: string[], action: Record<string, unknown>): ComputerUseAppModuleReadiness {
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
        operationRef,
      ]),
      action,
    },
    evidenceRefs: uniqueStrings([
      'module:vscode-app',
      `capability:vscode:${operation}`,
      operationRef,
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

interface VSCodeConceptBuckets {
  workspaceRefs: string[];
  fileRefs: string[];
  editorRefs: string[];
  editorGroupRefs: string[];
  activeEditorRefs: string[];
  selectionRefs: string[];
  cursorRefs: string[];
  terminalRefs: string[];
  commandPaletteRefs: string[];
  problemsPanelRefs: string[];
  unknownWebviewRefs: string[];
}

function conceptSummary(concepts: VSCodeConceptBuckets): string[] {
  return [
    concepts.workspaceRefs.length > 0 ? 'workspace' : undefined,
    concepts.fileRefs.length > 0 ? 'file' : undefined,
    concepts.editorRefs.length > 0 ? 'editor' : undefined,
    concepts.editorGroupRefs.length > 0 ? 'editor-group' : undefined,
    concepts.activeEditorRefs.length > 0 ? 'active-editor' : undefined,
    concepts.selectionRefs.length > 0 ? 'selection' : undefined,
    concepts.cursorRefs.length > 0 ? 'cursor' : undefined,
    concepts.terminalRefs.length > 0 ? 'terminal' : undefined,
    concepts.commandPaletteRefs.length > 0 ? 'command-palette' : undefined,
    concepts.problemsPanelRefs.length > 0 ? 'problems-panel' : undefined,
    concepts.unknownWebviewRefs.length > 0 ? 'unknown-webview' : undefined,
  ].filter((concept): concept is string => typeof concept === 'string');
}

function conceptEvidenceRefs(concepts: VSCodeConceptBuckets): string[] {
  return conceptSummary(concepts).map((concept) => `concept:vscode:${concept}`);
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
  if (
    observation.appRefs.length === 0
    || observation.processRefs.length === 0
    || observation.windowRefs.length === 0
    || observation.titleRefs.length === 0
    || observation.frontmostRefs.length === 0
  ) {
    return blocked('blocked:vscode-app-module:window-identity-refs-required', observation.refs);
  }
  if (observation.staleObservationRefs.length > 0) {
    return blocked('blocked:vscode-app-module:stale-observation', uniqueStrings([
      ...observation.currentObservationRefs,
      ...observation.staleObservationRefs,
      ...observation.freshnessRefs,
    ]));
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

function isProblemsPanelRef(ref: string): boolean {
  return ref.startsWith('problems:vscode:')
    || ref.startsWith('element:vscode:problems:')
    || ref.startsWith('diagnostics:vscode:problems');
}

function isUnknownWebviewRef(ref: string): boolean {
  return ref.startsWith('element:vscode:webview:')
    && !isEditorRef(ref)
    && !isTerminalRef(ref)
    && !isCommandPaletteRef(ref)
    && !isDiagnosticsRef(ref);
}

function hostStructuredOperationRef(operation: string, operationRef: string | undefined, refs: string[]): string | undefined {
  const candidates = uniqueStrings([
    operationRef,
    ...refs.filter((ref) => ref.startsWith('operation-ref:vscode:')),
  ]);
  const expectedPrefix = `operation-ref:vscode:${operation}:`;
  const exact = candidates.filter((ref) => ref.startsWith(expectedPrefix));
  return exact.length === 1 ? exact[0] : undefined;
}

function isVSCodeObservationRef(ref: string): boolean {
  return ref === 'macos-app:vscode'
    || ref.startsWith('macos-app:vscode:')
    || ref.startsWith('process:vscode')
    || ref.startsWith('window:vscode:')
    || ref.startsWith('title:vscode:')
    || ref.startsWith('text:title:vscode:')
    || ref.startsWith('frontmost:vscode:')
    || ref.startsWith('observation:vscode:')
    || ref.startsWith('file-ref:vscode:')
    || ref.startsWith('selected-file:vscode:')
    || ref.startsWith('workspace-ref:vscode:')
    || ref.startsWith('workspace:vscode:')
    || ref.startsWith('editor-group:vscode:')
    || ref.startsWith('active-editor:vscode:')
    || ref.startsWith('element:vscode:')
    || ref.startsWith('terminal:vscode:')
    || ref.startsWith('command-palette:vscode:')
    || ref.startsWith('command-palette-item:vscode:')
    || ref.startsWith('diagnostics:vscode:')
    || ref.startsWith('problems:vscode:')
    || ref.startsWith('freshness:vscode:')
    || ref.startsWith('stale-invalidation:vscode:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('text-ref:')
    || ref.startsWith('text:vscode:')
    || ref.startsWith('image:vscode:')
    || ref.startsWith('accessibility:vscode:')
    || ref.startsWith('operation-ref:vscode:')
    || ref.startsWith('window-action-session:vscode:')
    || ref.startsWith('computer-use-session:vscode:');
}

function isRawRef(ref: string): boolean {
  return /(^|:)raw[-:]|base64|data:image|providerPayload|provider-payload|screenshot-path|file:\/\/|https?:\/\/|(^|:)\/(?:Users|Applications|Volumes|private|tmp)\/|\\|<[^>]+>|secret|password|api[-_]?key|bearer|[A-Za-z0-9+/]{64,}={0,2}/i.test(ref);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
