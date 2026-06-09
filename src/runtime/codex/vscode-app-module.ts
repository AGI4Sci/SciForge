import {
  validateComputerUseAppModuleReadiness,
  type ComputerUseAppModule,
  type ComputerUseAppModuleReadiness,
} from './computer-use-app-module-registry.js';

const VSCODE_CAPABILITIES = [
  'read-visible-text',
  'editor-scope',
  'focus-editor',
  'insert-draft',
  'replace-selection',
  'save-current-file',
  'show-problems',
  'read-diagnostics',
  'focus-terminal',
  'send-terminal-text',
  'observe-terminal',
  'submit-terminal-command',
  'open-command-palette',
  'send-command-palette-query',
  'observe-command-palette-items',
  'select-command-palette-item',
  'close-command-palette',
] as const;

const FOCUS_EDITOR_ACTION_REF = 'action:vscode-app-module:focus-editor:meta-1';
const SAVE_CURRENT_FILE_ACTION_REF = 'action:vscode-app-module:save-current-file:meta-s';
const OPEN_COMMAND_PALETTE_ACTION_REF = 'action:vscode-app-module:open-command-palette:meta-shift-p';
const CLOSE_COMMAND_PALETTE_ACTION_REF = 'action:vscode-app-module:close-command-palette:escape';

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
  rangeRefs: string[];
  terminalRefs: string[];
  terminalSessionRefs: string[];
  terminalInputRefs: string[];
  terminalOutputRefs: string[];
  terminalOutputHashRefs: string[];
  commandPaletteRootRefs: string[];
  commandPaletteInputRefs: string[];
  commandPaletteItemsRefs: string[];
  commandPaletteRefs: string[];
  commandPaletteItemRefs: string[];
  commandPaletteItemRankRefs: string[];
  commandPaletteItemHashRefs: string[];
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
  visibleTextRefs: string[];
  actionRefs: string[];
  verifierRefs: string[];
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
  const invalidRefs = uniqueStrings([
    ...(refs.some(isRawRef) ? ['blocked:vscode-app-module:raw-ref-not-allowed'] : []),
    ...(refs.some(isUnsafeTerminalObservationRef) ? ['blocked:vscode-app-module:unsafe-terminal-ref-not-allowed'] : []),
    ...(refs.some(isUnsafeCommandPaletteObservationRef) ? ['blocked:vscode-app-module:unsafe-command-palette-ref-not-allowed'] : []),
    ...(refs.some(isUnsafeEditorScopeObservationRef) ? ['blocked:vscode-app-module:unsafe-editor-scope-ref-not-allowed'] : []),
  ]);
  const safeRefs = uniqueStrings(refs.filter((ref) =>
    !isRawRef(ref)
      && !isUnsafeTerminalObservationRef(ref)
      && !isUnsafeCommandPaletteObservationRef(ref)
      && !isUnsafeEditorScopeObservationRef(ref)
      && isVSCodeObservationRef(ref)
  ));
  const appRefs = safeRefs.filter((ref) =>
    ref === 'macos-app:vscode'
      || ref.startsWith('macos-app:vscode:')
      || ref === 'macos-app:com.microsoft.VSCode'
  );
  const processRefs = safeRefs.filter((ref) => ref.startsWith('process:vscode'));
  const windowRefs = safeRefs.filter((ref) => ref.startsWith('window:vscode:'));
  const titleRefs = safeRefs.filter((ref) =>
    ref.startsWith('text:title:vscode:')
      || ref.startsWith('title:vscode:')
      || ref.startsWith('text:title:')
  );
  const frontmostRefs = safeRefs.filter((ref) => ref.startsWith('frontmost:vscode:'));
  const observationRefs = safeRefs.filter((ref) => ref.startsWith('observation:vscode:'));
  const staleObservationRefs = safeRefs.filter((ref) => ref.startsWith('stale-invalidation:vscode:'));
  const fileRefs = safeRefs.filter((ref) => ref.startsWith('file-ref:vscode:'));
  const selectedFileRefs = safeRefs.filter((ref) => ref.startsWith('selected-file:vscode:') || ref.startsWith('file-ref:vscode:current'));
  const editorRefs = safeRefs.filter(isEditorRef);
  const activeEditorRefs = safeRefs.filter((ref) => ref.startsWith('active-editor:vscode:'));
  const editorGroupRefs = safeRefs.filter((ref) => ref.startsWith('editor-group:vscode:'));
  const cursorRefs = safeRefs.filter((ref) => ref.startsWith('cursor-ref:vscode:'));
  const rangeRefs = safeRefs.filter((ref) => ref.startsWith('range-ref:vscode:'));
  const terminalRefs = safeRefs.filter(isTerminalRef);
  const terminalSessionRefs = safeRefs.filter((ref) => ref.startsWith('terminal-session:vscode:'));
  const terminalInputRefs = safeRefs.filter((ref) => ref.startsWith('terminal-input:vscode:'));
  const terminalOutputRefs = safeRefs.filter((ref) => ref.startsWith('terminal-output:vscode:'));
  const terminalOutputHashRefs = safeRefs.filter((ref) => ref.startsWith('terminal-output-hash:vscode:'));
  const commandPaletteRootRefs = safeRefs.filter(isCommandPaletteRootRef);
  const commandPaletteInputRefs = safeRefs.filter((ref) => ref.startsWith('command-palette-input:vscode:'));
  const commandPaletteItemsRefs = safeRefs.filter((ref) => ref.startsWith('command-palette-items:vscode:'));
  const commandPaletteItemRefs = safeRefs.filter((ref) => ref.startsWith('command-palette-item:vscode:'));
  const commandPaletteItemRankRefs = safeRefs.filter((ref) => ref.startsWith('command-palette-item-rank:vscode:'));
  const commandPaletteItemHashRefs = safeRefs.filter((ref) => ref.startsWith('command-palette-item-hash:vscode:'));
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
    rangeRefs,
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
    sessionRefs: safeRefs.filter((ref) =>
      ref.startsWith('window-action-session:vscode:')
        || ref.startsWith('computer-use-session:vscode:')
        || ref.startsWith('window-action-session:current-vscode-cowork:')
        || ref.startsWith('computer-use-session:current-vscode-cowork:')
    ),
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
    rangeRefs,
    terminalRefs,
    terminalSessionRefs,
    terminalInputRefs,
    terminalOutputRefs,
    terminalOutputHashRefs,
    commandPaletteRootRefs,
    commandPaletteInputRefs,
    commandPaletteItemsRefs,
    commandPaletteRefs,
    commandPaletteItemRefs,
    commandPaletteItemRankRefs,
    commandPaletteItemHashRefs,
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
    visibleTextRefs: safeRefs.filter((ref) => ref.startsWith('text:vscode:visible:')),
    actionRefs: safeRefs.filter(isVSCodeActionEvidenceRef),
    verifierRefs: safeRefs.filter(isVSCodeVerifierRef),
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
        rangeRefs,
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
    return blocked(observation.invalidRefs[0], observation.invalidRefs);
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
  if (observation.frontmostRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-window-ambiguous', observation.frontmostRefs);
  }
  if (observation.unknownWebviewRefs.length > 0 && isEditorOrTerminalTargetOperation(operation)) {
    return blocked('blocked:vscode-app-module:unknown-webview-target-unresolved', observation.unknownWebviewRefs);
  }
  if (operation === 'read-visible-text') {
    const editorRefs = editorTargetRefs(observation);
    if (editorRefs.length === 0) {
      return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
    }
    if (editorRefs.length > 1 || observation.editorGroupRefs.length > 1 || observation.activeEditorRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-editor-ambiguous', uniqueStrings([
        ...editorRefs,
        ...observation.editorGroupRefs,
        ...observation.activeEditorRefs,
      ]));
    }
    const commonGate = checkCommonObservationGate(observation);
    if (commonGate) return commonGate;
    if (observation.fileRefs.length === 0) {
      return blocked('blocked:vscode-app-module:file-ref-required', observation.refs);
    }
    if (observation.fileRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', observation.fileRefs);
    }
    if (observation.visibleTextRefs.length === 0) {
      return blocked('blocked:vscode-app-module:visible-text-ref-required', observation.refs);
    }
    return validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: uniqueStrings([
          observation.sessionRefs[0],
          observation.windowRefs[0],
          observation.observationRefs[0],
          editorRefs[0],
          observation.fileRefs[0],
          ...observation.visibleTextRefs,
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
        editorRefs[0],
        observation.fileRefs[0],
        ...observation.visibleTextRefs,
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (operation === 'editor-scope') {
    return checkEditorScopeReadiness(operation, observation, normalizedOperationRef);
  }
  if (operation === 'read-diagnostics' || operation === 'show-problems') {
    if (observation.diagnosticsRefs.length === 0) {
      return blocked('blocked:vscode-app-module:diagnostics-ref-required', observation.refs);
    }
    if (observation.diagnosticsRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-diagnostics-ambiguous', observation.diagnosticsRefs);
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
    const editorRefs = editorTargetRefs(observation);
    if (editorRefs.length === 0) {
      return blocked('blocked:vscode-app-module:editor-ref-required', observation.refs);
    }
    if (editorRefs.length > 1 || observation.editorGroupRefs.length > 1 || observation.activeEditorRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-editor-ambiguous', uniqueStrings([
        ...editorRefs,
        ...observation.editorGroupRefs,
        ...observation.activeEditorRefs,
      ]));
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
          editorRefs[0],
          FOCUS_EDITOR_ACTION_REF,
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
        editorRefs[0],
        FOCUS_EDITOR_ACTION_REF,
        observation.freshnessRefs[0],
      ]),
    });
  }
  if (isEditorMutationOperation(operation)) {
    return checkEditorMutationReadiness(operation, observation, normalizedOperationRef);
  }
  if (operation === 'save-current-file') {
    return checkSaveCurrentFileReadiness(operation, observation, normalizedOperationRef);
  }
  if (isTerminalOperation(operation)) {
    return checkTerminalReadiness(operation, observation, normalizedOperationRef);
  }
  if (isCommandPaletteOperation(operation)) {
    return checkCommandPaletteReadiness(operation, observation, normalizedOperationRef);
  }
  return blocked(`blocked:vscode-app-module:${safeToken(operation) || 'operation'}-readiness-not-implemented`, observation.refs);
}

function checkEditorScopeReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
  const targetRefs = editorScopeTargetRefs(observation);
  if (targetRefs.status !== 'ready') return targetRefs.readiness;
  return observeReady(operation, operationRef, observation, targetRefs.refs);
}

function checkEditorMutationReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
  const targetRefs = editorScopeTargetRefs(observation);
  if (targetRefs.status !== 'ready') return targetRefs.readiness;
  if (observation.textRefRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-text-ref-ambiguous', observation.textRefRefs);
  }
  const textRef = observation.textRefRefs[0];
  if (!textRef) return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
  return actReady(operation, operationRef, observation, [
    ...targetRefs.refs,
    textRef,
  ], {
    kind: 'type',
    textRef,
  });
}

function checkSaveCurrentFileReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
  const targetRefs = editorFileTargetRefs(observation);
  if (targetRefs.status !== 'ready') return targetRefs.readiness;
  const fileToken = safeToken(targetRefs.fileRef);
  const sameFileRef = `verifier:vscode-app-module:same-file:${fileToken || 'file'}`;
  const mutationRef = `verifier:vscode-app-module:mutation:${fileToken || 'file'}`;
  if (!observation.verifierRefs.includes(sameFileRef)) {
    return blocked(
      observation.verifierRefs.some((ref) => ref.startsWith('verifier:vscode-app-module:same-file:'))
        ? 'blocked:vscode-app-module:same-file-verifier-file-drift'
        : 'blocked:vscode-app-module:same-file-verifier-ref-required',
      observation.refs,
    );
  }
  if (!observation.verifierRefs.includes(mutationRef)) {
    return blocked(
      observation.verifierRefs.some((ref) => ref.startsWith('verifier:vscode-app-module:mutation:'))
        ? 'blocked:vscode-app-module:mutation-verifier-file-drift'
        : 'blocked:vscode-app-module:mutation-verifier-ref-required',
      observation.refs,
    );
  }
  const actionEvidenceRefs = observation.actionRefs.filter(isVSCodeEditorMutationActionEvidenceRef);
  if (actionEvidenceRefs.length === 0) {
    return blocked('blocked:vscode-app-module:host-action-evidence-ref-required', observation.refs);
  }
  return actReady(operation, operationRef, observation, [
    ...targetRefs.refs,
    sameFileRef,
    mutationRef,
    ...actionEvidenceRefs,
    SAVE_CURRENT_FILE_ACTION_REF,
  ], {
    kind: 'key',
    key: 'Meta+S',
  });
}

function editorScopeTargetRefs(
  observation: VSCodeAppObservation,
): { status: 'ready'; refs: string[] } | { status: 'blocked'; readiness: ComputerUseAppModuleReadiness } {
  const editorRefs = editorTargetRefs(observation);
  if (editorRefs.length === 0) {
    return { status: 'blocked', readiness: blocked('blocked:vscode-app-module:editor-ref-required', observation.refs) };
  }
  if (editorRefs.length > 1 || observation.editorGroupRefs.length > 1 || observation.activeEditorRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-editor-ambiguous', uniqueStrings([
      ...editorRefs,
      ...observation.editorGroupRefs,
      ...observation.activeEditorRefs,
    ])) };
  }
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return { status: 'blocked', readiness: commonGate };
  const fileRefs = observation.selectedFileRefs.length > 0 ? observation.selectedFileRefs : observation.fileRefs;
  if (fileRefs.length === 0) {
    return { status: 'blocked', readiness: blocked('blocked:vscode-app-module:file-ref-required', observation.refs) };
  }
  if (fileRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', fileRefs) };
  }
  if (observation.selectionRefs.length === 0) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:editor-scope-selection-required', observation.refs) };
  }
  if (observation.cursorRefs.length === 0) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:editor-scope-cursor-required', observation.refs) };
  }
  if (observation.rangeRefs.length === 0) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:editor-scope-range-required', observation.refs) };
  }
  if (observation.selectionRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-selection-ambiguous', observation.selectionRefs) };
  }
  if (observation.cursorRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-cursor-ambiguous', observation.cursorRefs) };
  }
  if (observation.rangeRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-range-ambiguous', observation.rangeRefs) };
  }
  return {
    status: 'ready',
    refs: [
      editorRefs[0],
      fileRefs[0],
      observation.selectionRefs[0],
      observation.cursorRefs[0],
      observation.rangeRefs[0],
    ],
  };
}

function editorFileTargetRefs(
  observation: VSCodeAppObservation,
): { status: 'ready'; refs: string[]; fileRef: string } | { status: 'blocked'; readiness: ComputerUseAppModuleReadiness } {
  const editorRefs = editorTargetRefs(observation);
  if (editorRefs.length === 0) {
    return { status: 'blocked', readiness: blocked('blocked:vscode-app-module:editor-ref-required', observation.refs) };
  }
  if (editorRefs.length > 1 || observation.editorGroupRefs.length > 1 || observation.activeEditorRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-editor-ambiguous', uniqueStrings([
      ...editorRefs,
      ...observation.editorGroupRefs,
      ...observation.activeEditorRefs,
    ])) };
  }
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return { status: 'blocked', readiness: commonGate };
  const fileRefs = observation.selectedFileRefs.length > 0 ? observation.selectedFileRefs : observation.fileRefs;
  if (fileRefs.length === 0) {
    return { status: 'blocked', readiness: blocked('blocked:vscode-app-module:file-ref-required', observation.refs) };
  }
  if (fileRefs.length > 1) {
    return { status: 'blocked', readiness: needsConfirmation('needs-confirmation:vscode-app-module:target-file-ambiguous', fileRefs) };
  }
  return {
    status: 'ready',
    refs: [
      editorRefs[0],
      fileRefs[0],
    ],
    fileRef: fileRefs[0],
  };
}

function checkCommandPaletteReadiness(operation: string, observation: VSCodeAppObservation, operationRef: string): ComputerUseAppModuleReadiness {
  const commonGate = checkCommonObservationGate(observation);
  if (commonGate) return commonGate;
  if (operation === 'open-command-palette') {
    return actReady(operation, operationRef, observation, [OPEN_COMMAND_PALETTE_ACTION_REF], {
      kind: 'key',
      key: 'Meta+Shift+P',
    });
  }
  if (observation.commandPaletteRootRefs.length === 0) {
    return blocked('blocked:vscode-app-module:command-palette-ref-required', observation.refs);
  }
  if (observation.commandPaletteRootRefs.length > 1) {
    return needsConfirmation('needs-confirmation:vscode-app-module:target-command-palette-ambiguous', observation.commandPaletteRootRefs);
  }
  const paletteRef = observation.commandPaletteRootRefs[0];
  if (!commandPaletteRootIsCurrent(paletteRef)) {
    return blocked('blocked:vscode-app-module:command-palette-current-ref-required', [paletteRef]);
  }
  if (commandPaletteWindowDrift(observation.windowRefs[0], paletteRef)) {
    return blocked('blocked:vscode-app-module:command-palette-window-drift', [observation.windowRefs[0], paletteRef]);
  }
  if (operation === 'send-command-palette-query') {
    if (observation.commandPaletteInputRefs.length === 0) {
      return blocked('blocked:vscode-app-module:command-palette-input-ref-required', observation.refs);
    }
    if (observation.commandPaletteInputRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-command-palette-input-ambiguous', observation.commandPaletteInputRefs);
    }
    const inputRef = observation.commandPaletteInputRefs[0];
    if (!commandPaletteScopedRef(inputRef, paletteRef)) {
      return blocked('blocked:vscode-app-module:command-palette-input-drift', [paletteRef, inputRef]);
    }
    if (observation.textRefRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-text-ref-ambiguous', observation.textRefRefs);
    }
    const textRef = observation.textRefRefs[0];
    if (!textRef) return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
    return actReady(operation, operationRef, observation, [paletteRef, inputRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-command-palette-items') {
    if (observation.commandPaletteInputRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-command-palette-input-ambiguous', observation.commandPaletteInputRefs);
    }
    const inputRefs = observation.commandPaletteInputRefs.filter((ref) => commandPaletteScopedRef(ref, paletteRef));
    if (observation.commandPaletteInputRefs.length > 0 && inputRefs.length === 0) {
      return blocked('blocked:vscode-app-module:command-palette-input-drift', [paletteRef, ...observation.commandPaletteInputRefs]);
    }
    const currentItemListRefs = currentCommandPaletteRefs(observation.commandPaletteItemsRefs, paletteRef, observation);
    return observeReady(operation, operationRef, observation, [
      paletteRef,
      ...inputRefs,
      ...currentItemListRefs,
    ]);
  }
  if (operation === 'select-command-palette-item') {
    if (observation.commandPaletteItemRefs.length === 0) {
      return blocked('blocked:vscode-app-module:command-palette-item-ref-required', observation.refs);
    }
    const currentItems = currentCommandPaletteItemRefs(observation, paletteRef);
    if (currentItems.length === 0) {
      return blocked('blocked:vscode-app-module:command-palette-item-observation-drift', [observation.observationRefs[0], ...observation.commandPaletteItemRefs]);
    }
    if (currentItems.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-command-palette-item-ambiguous', currentItems);
    }
    if (currentItems.length !== observation.commandPaletteItemRefs.length) {
      return blocked('blocked:vscode-app-module:command-palette-item-observation-drift', [observation.observationRefs[0], ...observation.commandPaletteItemRefs]);
    }
    const itemRef = currentItems[0];
    if (!commandPaletteScopedRef(itemRef, paletteRef)) {
      return blocked('blocked:vscode-app-module:command-palette-item-drift', [paletteRef, itemRef]);
    }
    if (!commandPaletteCurrentObservationRef(itemRef, observation)) {
      return blocked('blocked:vscode-app-module:command-palette-item-observation-drift', [observation.observationRefs[0], itemRef]);
    }
    const verifierToken = commandPaletteVerifierToken(paletteRef, itemRef, observation);
    return actReady(operation, operationRef, observation, [paletteRef, itemRef], {
      kind: 'key',
      key: 'Enter',
    }, [
      `verifier:vscode-app-module:palette-current-observation:${verifierToken.currentObservation}`,
      `verifier:vscode-app-module:palette-same-item:${verifierToken.item}`,
    ]);
  }
  if (operation === 'close-command-palette') {
    return actReady(operation, operationRef, observation, [paletteRef, CLOSE_COMMAND_PALETTE_ACTION_REF], {
      kind: 'key',
      key: 'Escape',
    });
  }
  return blocked('blocked:vscode-app-module:operation-not-supported', observation.refs);
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
    if (observation.textRefRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-text-ref-ambiguous', observation.textRefRefs);
    }
    const textRef = observation.textRefRefs[0];
    if (!textRef) return blocked('blocked:vscode-app-module:text-ref-required', observation.refs);
    return actReady(operation, operationRef, observation, [terminalRef, textRef], {
      kind: 'type',
      textRef,
    });
  }
  if (operation === 'observe-terminal') {
    const outputRefs = terminalScopedRefs(observation.terminalOutputRefs, terminalRef);
    const outputHashRefs = terminalScopedRefs(observation.terminalOutputHashRefs, terminalRef);
    if (outputRefs.length === 0 && outputHashRefs.length === 0) {
      return blocked('blocked:vscode-app-module:terminal-output-ref-required', observation.refs);
    }
    return observeReady(operation, operationRef, observation, [
      terminalRef,
      ...outputRefs,
      ...outputHashRefs,
    ]);
  }
  if (operation === 'submit-terminal-command') {
    if (terminalWindowDrift(observation.windowRefs[0], terminalRef)) {
      return blocked('blocked:vscode-app-module:terminal-window-drift', [observation.windowRefs[0], terminalRef]);
    }
    if (observation.terminalInputRefs.length === 0) {
      return blocked('blocked:vscode-app-module:terminal-input-ref-required', observation.refs);
    }
    if (observation.terminalInputRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-terminal-input-ambiguous', observation.terminalInputRefs);
    }
    const inputRef = observation.terminalInputRefs[0];
    if (!terminalScopedRef(inputRef, terminalRef)) {
      return blocked('blocked:vscode-app-module:terminal-input-drift', [terminalRef, inputRef]);
    }
    if (observation.terminalSessionRefs.length === 0) {
      return blocked('blocked:vscode-app-module:terminal-session-ref-required', observation.refs);
    }
    if (observation.terminalSessionRefs.length > 1) {
      return needsConfirmation('needs-confirmation:vscode-app-module:target-terminal-session-ambiguous', observation.terminalSessionRefs);
    }
    const terminalSessionRef = observation.terminalSessionRefs[0];
    if (!terminalScopedRef(terminalSessionRef, terminalRef)) {
      return blocked('blocked:vscode-app-module:terminal-session-drift', [terminalRef, terminalSessionRef]);
    }
    const verifierToken = safeToken(terminalIdentityToken(terminalRef));
    return actReady(operation, operationRef, observation, [terminalRef, terminalSessionRef, inputRef], {
      kind: 'key',
      key: 'Enter',
    }, [
      `verifier:vscode-app-module:terminal-same-session:${verifierToken}`,
      `verifier:vscode-app-module:terminal-same-input:${verifierToken}`,
    ]);
  }
  if (operation === 'focus-terminal') {
    return actReady(operation, operationRef, observation, [terminalRef], {
      kind: 'key',
      key: 'Control+Backquote',
    });
  }
  return blocked('blocked:vscode-app-module:operation-not-supported', observation.refs);
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

function actReady(
  operation: string,
  operationRef: string,
  observation: VSCodeAppObservation,
  targetRefs: string[],
  action: Record<string, unknown>,
  additionalEvidenceRefs: string[] = [],
): ComputerUseAppModuleReadiness {
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
      ...additionalEvidenceRefs,
      observation.freshnessRefs[0],
    ]),
  });
}

function editorTargetRefs(observation: VSCodeAppObservation): string[] {
  const elementRefs = observation.editorRefs.filter((ref) => !ref.startsWith('focused-editor:vscode:'));
  return elementRefs.length > 0 ? elementRefs : observation.focusedEditorRefs;
}

interface VSCodeConceptBuckets {
  workspaceRefs: string[];
  fileRefs: string[];
  editorRefs: string[];
  editorGroupRefs: string[];
  activeEditorRefs: string[];
  selectionRefs: string[];
  cursorRefs: string[];
  rangeRefs: string[];
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
    concepts.rangeRefs.length > 0 ? 'range' : undefined,
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
    || operation === 'submit-terminal-command';
}

function isCommandPaletteOperation(operation: string): boolean {
  return operation === 'open-command-palette'
    || operation === 'send-command-palette-query'
    || operation === 'observe-command-palette-items'
    || operation === 'select-command-palette-item'
    || operation === 'close-command-palette';
}

function isEditorMutationOperation(operation: string): boolean {
  return operation === 'insert-draft'
    || operation === 'replace-selection';
}

function isEditorOrTerminalTargetOperation(operation: string): boolean {
  return operation === 'read-visible-text'
    || operation === 'editor-scope'
    || operation === 'focus-editor'
    || operation === 'save-current-file'
    || isEditorMutationOperation(operation)
    || isTerminalOperation(operation);
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
  return isCommandPaletteRootRef(ref)
    || ref.startsWith('command-palette-input:vscode:')
    || ref.startsWith('command-palette-items:vscode:')
    || ref.startsWith('command-palette-item:vscode:')
    || ref.startsWith('command-palette-item-rank:vscode:')
    || ref.startsWith('command-palette-item-hash:vscode:');
}

function isCommandPaletteRootRef(ref: string): boolean {
  return ref.startsWith('element:vscode:command-palette:')
    || ref.startsWith('command-palette:vscode:');
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
    || ref === 'macos-app:com.microsoft.VSCode'
    || ref.startsWith('process:vscode')
    || ref.startsWith('window:vscode:')
    || ref.startsWith('title:vscode:')
    || ref.startsWith('text:title:')
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
    || ref.startsWith('terminal-session:vscode:')
    || ref.startsWith('terminal-input:vscode:')
    || ref.startsWith('terminal-output:vscode:')
    || ref.startsWith('terminal-output-hash:vscode:')
    || ref.startsWith('command-palette:vscode:')
    || ref.startsWith('command-palette-input:vscode:')
    || ref.startsWith('command-palette-items:vscode:')
    || ref.startsWith('command-palette-item:vscode:')
    || ref.startsWith('command-palette-item-rank:vscode:')
    || ref.startsWith('command-palette-item-hash:vscode:')
    || ref.startsWith('diagnostics:vscode:')
    || ref.startsWith('problems:vscode:')
    || ref.startsWith('freshness:vscode:')
    || ref.startsWith('stale-invalidation:vscode:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('range-ref:vscode:')
    || ref.startsWith('text-ref:')
    || ref.startsWith('text:vscode:')
    || ref.startsWith('image:vscode:')
    || ref.startsWith('accessibility:vscode:')
    || isVSCodeActionEvidenceRef(ref)
    || isVSCodeVerifierRef(ref)
    || ref.startsWith('operation-ref:vscode:')
    || ref.startsWith('window-action-session:vscode:')
    || ref.startsWith('computer-use-session:vscode:')
    || ref.startsWith('window-action-session:current-vscode-cowork:')
    || ref.startsWith('computer-use-session:current-vscode-cowork:');
}

function isVSCodeActionEvidenceRef(ref: string): boolean {
  return /^action:vscode:(?:insert-draft|replace-selection):[A-Za-z0-9._:-]+$/u.test(ref)
    || /^executor-event:vscode:(?:insert-draft|replace-selection):[A-Za-z0-9._:-]+$/u.test(ref)
    || /^input-event:vscode:(?:insert-draft|replace-selection):[A-Za-z0-9._:-]+$/u.test(ref);
}

function isVSCodeEditorMutationActionEvidenceRef(ref: string): boolean {
  return isVSCodeActionEvidenceRef(ref);
}

function isVSCodeVerifierRef(ref: string): boolean {
  return /^verifier:vscode-app-module:(?:same-file|mutation|same-window|same-editor|same-selection|after-observe):[A-Za-z0-9._:-]+$/u.test(ref)
    || /^verifier:vscode-editor-narrow-apply:[A-Za-z0-9._:-]+:(?:verified|cleanup-release|one-primitive)$/u.test(ref);
}

function isRawRef(ref: string): boolean {
  return /(^|:)raw[-:]|base64|data:image|providerPayload|provider-payload|screenshot-path|file:\/\/|https?:\/\/|(^|:)\/(?:Users|Applications|Volumes|private|tmp)\/|\\|<[^>]+>|secret|password|api[-_]?key|bearer|[A-Za-z0-9+/]{64,}={0,2}/i.test(ref);
}

function isUnsafeTerminalObservationRef(ref: string): boolean {
  if (ref.startsWith('text:vscode:terminal-input:')) return true;
  if (ref.startsWith('terminal-output:vscode:')) return !safeTerminalOutputRef(ref);
  if (ref.startsWith('terminal-output-hash:vscode:')) return !safeTerminalOutputHashRef(ref);
  if (ref.startsWith('terminal-input:vscode:') || ref.startsWith('terminal-session:vscode:')) {
    return terminalRefParts(ref).some(unsafeTerminalToken);
  }
  return false;
}

function isUnsafeCommandPaletteObservationRef(ref: string): boolean {
  if (ref.startsWith('command-palette:vscode:')) return !safeCommandPaletteRootRef(ref);
  if (ref.startsWith('element:vscode:command-palette:')) return !safeCommandPaletteToken(ref.slice('element:vscode:command-palette:'.length));
  if (ref.startsWith('command-palette-input:vscode:')) return !safeCommandPaletteInputRef(ref);
  if (ref.startsWith('command-palette-items:vscode:')) return !safeCommandPaletteItemsRef(ref);
  if (ref.startsWith('command-palette-item:vscode:')) return !safeCommandPaletteItemRef(ref);
  if (ref.startsWith('command-palette-item-rank:vscode:')) return !safeCommandPaletteItemRankRef(ref);
  if (ref.startsWith('command-palette-item-hash:vscode:')) return !safeCommandPaletteItemHashRef(ref);
  return false;
}

function isUnsafeEditorScopeObservationRef(ref: string): boolean {
  if (!ref.startsWith('selection-ref:vscode:')
    && !ref.startsWith('cursor-ref:vscode:')
    && !ref.startsWith('range-ref:vscode:')) return false;
  const [, rest = ''] = ref.split(':vscode:');
  const parts = rest.split(':').filter(Boolean);
  return parts.length === 0 || parts.some(unsafeEditorScopeToken);
}

function unsafeEditorScopeToken(value: string | undefined): boolean {
  return typeof value !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)
    || /raw|payload|selected|text|diff|path|file|url|http|secret|password|base64|provider|command/i.test(value);
}

function safeTerminalOutputRef(ref: string): boolean {
  const parts = terminalRefParts(ref);
  if (parts.length < 2 || parts.some(unsafeTerminalToken)) return false;
  const last = parts.at(-1);
  const beforeLast = parts.at(-2);
  return last === 'current'
    || ((beforeLast === 'snapshot' || beforeLast === 'chunk') && safeTerminalToken(last));
}

function safeTerminalOutputHashRef(ref: string): boolean {
  const parts = terminalRefParts(ref);
  if (parts.length < 3 || parts.slice(0, -1).some(unsafeTerminalToken)) return false;
  return parts.at(-2) === 'sha256' && /^[a-f0-9]{6,64}$/i.test(parts.at(-1) ?? '');
}

function terminalRefParts(ref: string): string[] {
  const [, rest = ''] = ref.split(':vscode:');
  return rest.split(':').filter(Boolean);
}

function safeTerminalToken(value: string | undefined): boolean {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value) && !unsafeTerminalToken(value);
}

function unsafeTerminalToken(value: string | undefined): boolean {
  return typeof value === 'string' && /raw|payload|stdout|stderr|command|secret|password|base64|provider/i.test(value);
}

function safeCommandPaletteRootRef(ref: string): boolean {
  const parts = commandPaletteRefParts(ref);
  return parts.length === 1
    ? safeCommandPaletteToken(parts[0])
    : parts.length === 2 && safeCommandPaletteToken(parts[0]) && parts[1] === 'current';
}

function safeCommandPaletteInputRef(ref: string): boolean {
  const parts = commandPaletteRefParts(ref);
  return parts.length === 2 && safeCommandPaletteToken(parts[0]) && parts[1] === 'current';
}

function safeCommandPaletteItemsRef(ref: string): boolean {
  const parts = commandPaletteRefParts(ref);
  return parts.length === 2 && safeCommandPaletteToken(parts[0]) && safeCommandPaletteObservationToken(parts[1]);
}

function safeCommandPaletteItemRef(ref: string): boolean {
  const parts = commandPaletteRefParts(ref);
  return parts.length === 3
    && safeCommandPaletteToken(parts[0])
    && safeCommandPaletteObservationToken(parts[1])
    && safeCommandPaletteRankToken(parts[2]);
}

function safeCommandPaletteItemRankRef(ref: string): boolean {
  return safeCommandPaletteItemRef(ref.replace('command-palette-item-rank:vscode:', 'command-palette-item:vscode:'));
}

function safeCommandPaletteItemHashRef(ref: string): boolean {
  const parts = commandPaletteRefParts(ref);
  return parts.length === 4
    && safeCommandPaletteToken(parts[0])
    && safeCommandPaletteObservationToken(parts[1])
    && parts[2] === 'sha256'
    && /^[a-f0-9]{6,64}$/i.test(parts[3] ?? '');
}

function safeCommandPaletteToken(value: string | undefined): boolean {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)
    && !unsafeCommandPaletteToken(value);
}

function safeCommandPaletteObservationToken(value: string | undefined): boolean {
  return typeof value === 'string'
    && /^obs-[a-z0-9][a-z0-9-]{0,95}$/i.test(value)
    && !unsafeCommandPaletteToken(value);
}

function safeCommandPaletteRankToken(value: string | undefined): boolean {
  return typeof value === 'string' && /^rank-[1-9][0-9]{0,3}$/.test(value);
}

function unsafeCommandPaletteToken(value: string | undefined): boolean {
  return typeof value === 'string' && /raw|payload|command|workbench|action|label|save|secret|password|base64|provider|\s/i.test(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function terminalScopedRefs(refs: string[], terminalRef: string): string[] {
  return refs.filter((ref) => terminalScopedRef(ref, terminalRef));
}

function currentCommandPaletteItemRefs(observation: VSCodeAppObservation, paletteRef: string): string[] {
  return currentCommandPaletteRefs(observation.commandPaletteItemRefs, paletteRef, observation);
}

function currentCommandPaletteRefs(refs: string[], paletteRef: string, observation: VSCodeAppObservation): string[] {
  return refs.filter((ref) =>
    commandPaletteScopedRef(ref, paletteRef) && commandPaletteCurrentObservationRef(ref, observation)
  );
}

function commandPaletteScopedRef(ref: string, paletteRef: string): boolean {
  const token = commandPaletteIdentityToken(paletteRef);
  return Boolean(token) && commandPaletteRefParts(ref)[0] === token;
}

function commandPaletteRootIsCurrent(ref: string): boolean {
  if (ref.startsWith('command-palette:vscode:')) {
    return commandPaletteRefParts(ref)[1] === 'current';
  }
  return ref.startsWith('element:vscode:command-palette:');
}

function commandPaletteCurrentObservationRef(ref: string, observation: VSCodeAppObservation): boolean {
  const token = commandPaletteObservationToken(observation.observationRefs[0]);
  return Boolean(token) && commandPaletteRefParts(ref)[1] === token;
}

function commandPaletteIdentityToken(ref: string): string {
  if (ref.startsWith('command-palette:vscode:')) {
    return commandPaletteRefParts(ref)[0] ?? '';
  }
  if (ref.startsWith('element:vscode:command-palette:')) {
    return ref.slice('element:vscode:command-palette:'.length);
  }
  return '';
}

function commandPaletteObservationToken(observationRef: string | undefined): string {
  if (!observationRef?.startsWith('observation:vscode:')) return '';
  return `obs-${safeToken(observationRef.slice('observation:vscode:'.length))}`;
}

function commandPaletteRefParts(ref: string): string[] {
  const [, rest = ''] = ref.split(':vscode:');
  return rest.split(':').filter(Boolean);
}

function commandPaletteWindowDrift(windowRef: string | undefined, paletteRef: string): boolean {
  const windowToken = windowRef?.startsWith('window:vscode:')
    ? windowRef.slice('window:vscode:'.length)
    : undefined;
  const paletteToken = commandPaletteIdentityToken(paletteRef);
  return Boolean(windowToken && paletteToken && windowToken !== paletteToken);
}

function commandPaletteVerifierToken(paletteRef: string, itemRef: string, observation: VSCodeAppObservation): { currentObservation: string; item: string } {
  const paletteToken = safeToken(commandPaletteIdentityToken(paletteRef));
  const observationToken = commandPaletteObservationToken(observation.observationRefs[0]);
  const rankToken = commandPaletteRefParts(itemRef)[2] ?? '';
  return {
    currentObservation: safeToken(`${paletteToken}-${observationToken}`),
    item: safeToken(`${paletteToken}-${observationToken}-${rankToken}`),
  };
}

function terminalScopedRef(ref: string, terminalRef: string): boolean {
  const token = terminalIdentityToken(terminalRef);
  return Boolean(token) && ref.startsWith(`terminal-${terminalRefType(ref)}:vscode:${token}:`);
}

function terminalRefType(ref: string): 'session' | 'input' | 'output' | 'output-hash' {
  if (ref.startsWith('terminal-output-hash:vscode:')) return 'output-hash';
  if (ref.startsWith('terminal-output:vscode:')) return 'output';
  if (ref.startsWith('terminal-input:vscode:')) return 'input';
  return 'session';
}

function terminalIdentityToken(terminalRef: string): string {
  if (terminalRef.startsWith('terminal:vscode:')) {
    return terminalRef.slice('terminal:vscode:'.length);
  }
  if (terminalRef.startsWith('element:vscode:terminal:')) {
    return terminalRef.slice('element:vscode:terminal:'.length);
  }
  return '';
}

function terminalWindowDrift(windowRef: string | undefined, terminalRef: string): boolean {
  const windowToken = windowRef?.startsWith('window:vscode:')
    ? windowRef.slice('window:vscode:'.length)
    : undefined;
  if (!windowToken || !terminalRef.startsWith('terminal:vscode:')) return false;
  const parts = terminalIdentityToken(terminalRef).split(':').filter(Boolean);
  return parts.length > 1 && parts[0] !== windowToken;
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
