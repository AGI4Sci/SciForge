import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA,
  COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
  createComputerUsePrimitiveService,
  type ComputerUseActOutput,
  type ComputerUseAtomicAction,
  type ComputerUseBindOutput,
  type ComputerUseControlOutput,
  type ComputerUseObserveOutput,
  type ComputerUsePrimitiveEnvelope,
} from '../../../packages/actions/computer-use/index.js';
import {
  createCurrentVSCodeCoWorkLivePrimitivePorts,
  runCurrentVSCodeCoWorkLiveDiagnosticPreflight,
  VSCODE_COWORK_CURRENT_SELECTION_APPLY_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV,
  type CurrentVSCodeCoWorkLivePrimitivePortsOptions,
  VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runVSCodeCoWorkInsertDraftLiveDiagnostic,
  runVSCodeCoWorkFocusEditorLiveDiagnostic,
  runVSCodeCoWorkReadVisibleTextLiveDiagnostic,
  type VSCodeCoWorkFocusedEditorEvidenceProvider,
  type VSCodeCoWorkFocusedEditorEvidenceVerifier,
  type VSCodeCoWorkLiveDiagnosticResult,
} from './agent-host-vscode-cowork-live-diagnostic.js';
import { createVSCodeAppModule } from './vscode-app-module.js';
import { verifyVSCodeMutationEvidence } from './vscode-app-verifiers.js';
import {
  createVSCodeEditorNarrowApply,
  verifyVSCodeEditorNarrowApply,
  type VSCodeEditorNarrowApplyPrimitiveOperation,
} from './vscode-editor-narrow-apply-provider.js';
import { createVSCodeEditorPreview } from './vscode-editor-preview-provider.js';

export interface RunCurrentVSCodeCoWorkReadVisibleTextLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  commandText?: string;
  workspacePath?: string;
  commandId?: string;
  attemptId?: string;
  authorizationProfileId?: string;
}

export interface RunCurrentVSCodeCoWorkInsertDraftLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  commandText?: string;
  workspacePath?: string;
  commandId?: string;
  attemptId?: string;
  authorizationProfileId?: string;
  draftTextRef: string;
  focusedEditorContextRefs?: string[];
  focusedEditorEvidenceVerifier?: VSCodeCoWorkFocusedEditorEvidenceVerifier;
  focusedEditorEvidenceProvider?: VSCodeCoWorkFocusedEditorEvidenceProvider;
}

export interface RunCurrentVSCodeCoWorkFocusEditorLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  commandText?: string;
  workspacePath?: string;
  commandId?: string;
  attemptId?: string;
  authorizationProfileId?: string;
  focusedEditorEvidenceVerifier?: VSCodeCoWorkFocusedEditorEvidenceVerifier;
  focusedEditorEvidenceProvider?: VSCodeCoWorkFocusedEditorEvidenceProvider;
}

export interface RunCurrentVSCodeCoWorkTerminalLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  terminalTextRef: string;
  submit?: boolean;
}

export interface RunCurrentVSCodeCoWorkCommandPaletteLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  paletteQueryTextRef: string;
  selectCurrentItem?: boolean;
}

export interface RunCurrentVSCodeCoWorkEditorScopeLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
}

export interface RunCurrentVSCodeCoWorkEditorPreviewLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  draftArtifactRef?: string;
}

export interface RunCurrentVSCodeCoWorkEditorCurrentSelectionApplyLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  primitiveOperation?: VSCodeEditorNarrowApplyPrimitiveOperation;
  draftTextRef: string;
}

export interface RunCurrentVSCodeCoWorkEditorScratchMutationLiveDiagnosticInput
  extends CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  env?: Record<string, string | undefined>;
  operation?: 'insert-draft' | 'replace-selection';
  draftTextRef: string;
}

function currentVSCodeCoWorkHostFinalAnswerResult(input: {
  status: VSCodeCoWorkLiveDiagnosticResult['status'];
  message: string;
  primitiveChainObserved?: string[];
  evidenceRefs?: string[];
  cleanupRefs?: string[];
}): VSCodeCoWorkLiveDiagnosticResult {
  const primitiveChainObserved = [...(input.primitiveChainObserved ?? [])];
  const evidenceRefs = uniqueSafeRefs(input.evidenceRefs);
  const cleanupRefs = currentVSCodeCoWorkCleanupRefs(input.cleanupRefs ?? []);
  return {
    status: input.status,
    message: input.message,
    maturity: 'live-diagnostic',
    productReady: false,
    primitiveChainObserved,
    evidenceRefs,
    cleanupRefs,
    agentHostFinalAnswer: {
      schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
      source: 'codex-agent-host-vscode-cowork-live-diagnostic',
      status: input.status,
      text: input.message,
      maturity: 'live-diagnostic',
      productReady: false,
      hostOwnsFinalAnswer: true,
      computerUseCorePlanning: false,
      primitiveChainObserved,
      evidenceRefs,
      cleanupRefs,
    },
  };
}

export async function runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkReadVisibleTextLiveDiagnosticInput = {},
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const preflight = await runCurrentVSCodeCoWorkLiveDiagnosticPreflight({ env: input.env });
  if (preflight.status !== 'ready') {
    const message = preflight.skipReason ?? (preflight.blockedReasons.join('; ') || 'current VSCode co-work live diagnostic blocked');
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message,
    });
  }

  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: input.runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });

  return runVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    service,
    commandText: input.commandText ?? 'read visible text from the current VSCode window',
    workspacePath: input.workspacePath ?? process.cwd(),
    commandId: input.commandId ?? 'current-vscode-cowork-read-visible-text',
    attemptId: input.attemptId ?? `current-vscode-cowork-${Date.now()}`,
    authorizationProfileId: input.authorizationProfileId,
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
    },
  });
}

export async function runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkFocusEditorLiveDiagnosticInput = {},
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const preflight = await runCurrentVSCodeCoWorkLiveDiagnosticPreflight({ env: input.env });
  if (preflight.status !== 'ready') {
    const message = preflight.skipReason ?? (preflight.blockedReasons.join('; ') || 'current VSCode co-work focus-editor live diagnostic blocked');
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message,
    });
  }

  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: input.runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });

  return runVSCodeCoWorkFocusEditorLiveDiagnostic({
    service,
    commandText: input.commandText ?? 'focus the editor in the current VSCode window',
    workspacePath: input.workspacePath ?? process.cwd(),
    commandId: input.commandId ?? 'current-vscode-cowork-focus-editor',
    attemptId: input.attemptId ?? `current-vscode-cowork-${Date.now()}`,
    authorizationProfileId: input.authorizationProfileId,
    focusedEditorEvidenceVerifier: input.focusedEditorEvidenceVerifier,
    focusedEditorEvidenceProvider: input.focusedEditorEvidenceProvider
      ?? (input.focusedEditorEvidenceVerifier ? undefined : createCurrentVSCodeCoWorkFocusedEditorEvidenceProvider()),
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
    },
  });
}

export async function runCurrentVSCodeCoWorkTerminalLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkTerminalLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV}`,
    });
  }
  if (!input.terminalTextRef.startsWith('text-ref:')) {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: 'current VSCode co-work terminal diagnostic blocked: terminal text ref required',
      evidenceRefs: ['blocked:vscode-cowork:terminal-text-ref-required'],
    });
  }

  const runId = input.runId ?? `current-vscode-terminal-${Date.now()}`;
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentTerminalControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(evidenceRefs, release.refs);
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = uniqueSafeRefs(evidenceRefs);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentTerminalBind(service);
  primitiveChainObserved.push('bind');
  pushRefs(evidenceRefs, bind.refs);
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode terminal diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentTerminalObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, beforeObserve.refs);
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode terminal diagnostic blocked: observe failed');
  }

  const terminalContextRefs = currentTerminalContextRefs([
    ...bind.refs,
    ...beforeObserve.refs,
  ]);
  if (!terminalContextRefs) {
    return finish('blocked', 'current VSCode terminal diagnostic blocked: terminal refs required');
  }

  primitiveChainObserved.push('host-decision');
  const decisionRef = `decision:vscode-cowork:${currentVSCodeEvidenceToken(runId)}:terminal-${input.submit ? 'submit' : 'no-submit'}`;
  pushRefs(evidenceRefs, [decisionRef, ...terminalContextRefs]);

  const focus = await currentTerminalAct(service, sessionId, 'focus-terminal', {
    type: 'key',
    key: 'Control+Backquote',
    elementRef: terminalContextRefs[0],
  }, terminalContextRefs);
  primitiveChainObserved.push('act(focus-terminal)');
  pushRefs(evidenceRefs, focus.refs);
  if (focus.status !== 'completed') {
    return finish('blocked', focus.blockedReason ?? 'current VSCode terminal diagnostic blocked: focus-terminal failed');
  }

  const send = await currentTerminalAct(service, sessionId, 'send-terminal-text', {
    type: 'type',
    textRef: input.terminalTextRef,
    elementRef: terminalContextRefs[0],
  }, terminalContextRefs);
  primitiveChainObserved.push('act(send-terminal-text)');
  pushRefs(evidenceRefs, send.refs);
  if (send.status !== 'completed') {
    return finish('blocked', send.blockedReason ?? 'current VSCode terminal diagnostic blocked: send-terminal-text failed');
  }

  const afterSendObserve = await currentTerminalObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, afterSendObserve.refs);
  if (afterSendObserve.status !== 'completed') {
    return finish('blocked', afterSendObserve.blockedReason ?? 'current VSCode terminal diagnostic blocked: observe after send failed');
  }

  if (input.submit === true) {
    const submit = await currentTerminalAct(service, sessionId, 'submit-terminal-command', {
      type: 'key',
      key: 'Enter',
      elementRef: terminalContextRefs[0],
    }, terminalContextRefs);
    primitiveChainObserved.push('act(submit-terminal-command)');
    pushRefs(evidenceRefs, submit.refs);
    if (submit.status !== 'completed') {
      return finish('blocked', submit.blockedReason ?? 'current VSCode terminal diagnostic blocked: submit-terminal-command failed');
    }
    const afterSubmitObserve = await currentTerminalObserve(service, sessionId);
    primitiveChainObserved.push('observe');
    pushRefs(evidenceRefs, afterSubmitObserve.refs);
    if (afterSubmitObserve.status !== 'completed') {
      return finish('blocked', afterSubmitObserve.blockedReason ?? 'current VSCode terminal diagnostic blocked: observe after submit failed');
    }
  }

  return finish('completed', input.submit === true
    ? 'current VSCode terminal live diagnostic completed focus, send, observe, submit, observe, and release'
    : 'current VSCode terminal live diagnostic completed focus, send, observe, and release'
  );
}

export async function runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkCommandPaletteLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV}`,
    });
  }
  if (!input.paletteQueryTextRef.startsWith('text-ref:')) {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: 'current VSCode co-work command palette diagnostic blocked: palette query text ref required',
      evidenceRefs: ['blocked:vscode-cowork:palette-query-text-ref-required'],
    });
  }

  const runId = input.runId ?? `current-vscode-palette-${Date.now()}`;
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const vscodeModule = createVSCodeAppModule();
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentVSCodeControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(evidenceRefs, release.refs);
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = uniqueSafeRefs(evidenceRefs);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentVSCodeBind(service);
  primitiveChainObserved.push('bind');
  pushRefs(evidenceRefs, bind.refs);
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode command palette diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, beforeObserve.refs);
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode command palette diagnostic blocked: observe failed');
  }

  const open = vscodeModule.checkReadiness({
    operation: 'open-command-palette',
    operationRef: `operation-ref:vscode:open-command-palette:${currentVSCodeEvidenceToken(runId)}`,
    refs: currentVSCodeAppModuleRefs([
      ...bind.refs,
      ...beforeObserve.refs,
    ], beforeObserve.output?.observationRef),
  });
  primitiveChainObserved.push('host-decision(open-command-palette)');
  pushRefs(evidenceRefs, open.evidenceRefs);
  if (open.status !== 'ready' || open.primitive.name !== 'computer_use.act') {
    return finish(readinessFailureDiagnosticStatus(open.status), open.reasonRef ?? 'current VSCode command palette diagnostic blocked: open readiness failed');
  }
  const openAction = appModuleActionToComputerUseAction(open.primitive.action);
  if (!openAction) return finish('blocked', 'current VSCode command palette diagnostic blocked: open action invalid');
  const openAct = await currentVSCodeAct(service, sessionId, 'open-command-palette', openAction, open.primitive.inputRefs);
  primitiveChainObserved.push('act(open-command-palette)');
  pushRefs(evidenceRefs, openAct.refs);
  if (openAct.status !== 'completed') {
    return finish('blocked', openAct.blockedReason ?? 'current VSCode command palette diagnostic blocked: open act failed');
  }

  const afterOpenObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, afterOpenObserve.refs);
  if (afterOpenObserve.status !== 'completed') {
    return finish('blocked', afterOpenObserve.blockedReason ?? 'current VSCode command palette diagnostic blocked: observe after open failed');
  }

  const send = vscodeModule.checkReadiness({
    operation: 'send-command-palette-query',
    operationRef: `operation-ref:vscode:send-command-palette-query:${currentVSCodeEvidenceToken(runId)}`,
    refs: currentVSCodeAppModuleRefs([
      ...afterOpenObserve.refs,
      input.paletteQueryTextRef,
    ], afterOpenObserve.output?.observationRef),
  });
  primitiveChainObserved.push('host-decision(send-command-palette-query)');
  pushRefs(evidenceRefs, send.evidenceRefs);
  if (send.status !== 'ready' || send.primitive.name !== 'computer_use.act') {
    return finish(readinessFailureDiagnosticStatus(send.status), send.reasonRef ?? 'current VSCode command palette diagnostic blocked: query readiness failed');
  }
  const sendAction = appModuleActionToComputerUseAction(send.primitive.action);
  if (!sendAction) return finish('blocked', 'current VSCode command palette diagnostic blocked: query action invalid');
  const sendAct = await currentVSCodeAct(service, sessionId, 'send-command-palette-query', sendAction, send.primitive.inputRefs);
  primitiveChainObserved.push('act(send-command-palette-query)');
  pushRefs(evidenceRefs, sendAct.refs);
  if (sendAct.status !== 'completed') {
    return finish('blocked', sendAct.blockedReason ?? 'current VSCode command palette diagnostic blocked: query act failed');
  }

  const itemsObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, itemsObserve.refs);
  if (itemsObserve.status !== 'completed') {
    return finish('blocked', itemsObserve.blockedReason ?? 'current VSCode command palette diagnostic blocked: observe items failed');
  }

  const finalOperation = input.selectCurrentItem === true
    ? 'select-command-palette-item'
    : 'close-command-palette';
  const finalReadiness = vscodeModule.checkReadiness({
    operation: finalOperation,
    operationRef: `operation-ref:vscode:${finalOperation}:${currentVSCodeEvidenceToken(runId)}`,
    refs: currentVSCodeAppModuleRefs([
      ...itemsObserve.refs,
    ], itemsObserve.output?.observationRef),
  });
  primitiveChainObserved.push(`host-decision(${finalOperation})`);
  pushRefs(evidenceRefs, finalReadiness.evidenceRefs);
  if (finalReadiness.status !== 'ready' || finalReadiness.primitive.name !== 'computer_use.act') {
    return finish(readinessFailureDiagnosticStatus(finalReadiness.status), finalReadiness.reasonRef ?? `current VSCode command palette diagnostic blocked: ${finalOperation} readiness failed`);
  }
  const finalAction = appModuleActionToComputerUseAction(finalReadiness.primitive.action);
  if (!finalAction) return finish('blocked', `current VSCode command palette diagnostic blocked: ${finalOperation} action invalid`);
  const finalAct = await currentVSCodeAct(service, sessionId, finalOperation, finalAction, finalReadiness.primitive.inputRefs);
  primitiveChainObserved.push(`act(${finalOperation})`);
  pushRefs(evidenceRefs, finalAct.refs);
  if (finalAct.status !== 'completed') {
    return finish('blocked', finalAct.blockedReason ?? `current VSCode command palette diagnostic blocked: ${finalOperation} act failed`);
  }

  const afterFinalObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  pushRefs(evidenceRefs, afterFinalObserve.refs);
  if (afterFinalObserve.status !== 'completed') {
    return finish('blocked', afterFinalObserve.blockedReason ?? `current VSCode command palette diagnostic blocked: observe after ${finalOperation} failed`);
  }

  return finish('completed', input.selectCurrentItem === true
    ? 'current VSCode command palette live diagnostic completed open, query, observe, select current item, observe, and release'
    : 'current VSCode command palette live diagnostic completed open, query, observe items, close, observe, and release'
  );
}

export async function runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkEditorScopeLiveDiagnosticInput = {},
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV}`,
    });
  }

  const runId = input.runId ?? `current-vscode-scope-${Date.now()}`;
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const vscodeModule = createVSCodeAppModule();
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
    reasonRefs: string[] = [],
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentVSCodeControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = currentVSCodeEditorScopePublicRefs([
      ...evidenceRefs,
      ...reasonRefs,
    ]);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentVSCodeBind(service);
  primitiveChainObserved.push('bind');
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode editor scope diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode editor scope diagnostic blocked: observe failed');
  }

  const readiness = vscodeModule.checkReadiness({
    operation: 'editor-scope',
    operationRef: `operation-ref:vscode:editor-scope:${currentVSCodeEvidenceToken(runId)}`,
    refs: currentVSCodeAppModuleRefs(beforeObserve.refs, beforeObserve.output?.observationRef),
  });
  primitiveChainObserved.push('host-decision');
  pushRefs(evidenceRefs, readiness.status === 'ready'
    ? [
      ...readiness.evidenceRefs,
      ...readiness.primitive.inputRefs,
    ]
    : [
      readiness.reasonRef,
      ...readiness.evidenceRefs,
    ]);
  if (readiness.status !== 'ready' || readiness.primitive.name !== 'computer_use.observe') {
    return finish(
      readinessFailureDiagnosticStatus(readiness.status),
      readiness.status === 'ready'
        ? 'current VSCode editor scope diagnostic blocked: editor-scope primitive invalid'
        : readiness.reasonRef,
    );
  }

  const afterObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (afterObserve.status !== 'completed') {
    return finish('blocked', afterObserve.blockedReason ?? 'current VSCode editor scope diagnostic blocked: observe after scope failed');
  }
  pushRefs(evidenceRefs, afterObserve.refs);
  const afterScopePublicRefs = currentVSCodeEditorScopePublicRefs(afterObserve.refs);
  const afterScopeBlockedReason = currentVSCodeEditorScopePublicRefsBlockedReason(afterScopePublicRefs);
  if (afterScopeBlockedReason) {
    return finish('blocked', `current VSCode editor scope diagnostic blocked: ${afterScopeBlockedReason}`, [`blocked:vscode-cowork:${afterScopeBlockedReason}`]);
  }

  return finish('completed', 'current VSCode editor scope live diagnostic completed observe scope and release');
}

export async function runCurrentVSCodeCoWorkEditorPreviewLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkEditorPreviewLiveDiagnosticInput = {},
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV}`,
    });
  }

  const runId = input.runId ?? `current-vscode-preview-${Date.now()}`;
  const runToken = currentVSCodeEvidenceToken(runId);
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const vscodeModule = createVSCodeAppModule();
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
    reasonRefs: string[] = [],
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentVSCodeControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = currentVSCodeEditorPreviewPublicRefs([
      ...evidenceRefs,
      ...reasonRefs,
    ]);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentVSCodeBind(service);
  primitiveChainObserved.push('bind');
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode editor preview diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode editor preview diagnostic blocked: observe failed');
  }

  const readiness = vscodeModule.checkReadiness({
    operation: 'editor-scope',
    operationRef: `operation-ref:vscode:editor-scope:${runToken}`,
    refs: currentVSCodeAppModuleRefs(beforeObserve.refs, beforeObserve.output?.observationRef),
  });
  primitiveChainObserved.push('host-decision');
  pushRefs(evidenceRefs, readiness.status === 'ready'
    ? [
      ...readiness.evidenceRefs,
      ...readiness.primitive.inputRefs,
    ]
    : [
      ...(readiness.reasonRef ? [readiness.reasonRef] : []),
      ...readiness.evidenceRefs,
    ]);
  if (readiness.status !== 'ready' || readiness.primitive.name !== 'computer_use.observe') {
    return finish(
      readinessFailureDiagnosticStatus(readiness.status),
      readiness.status === 'ready'
        ? 'current VSCode editor preview diagnostic blocked: editor-scope primitive invalid'
        : readiness.reasonRef ?? 'current VSCode editor preview diagnostic blocked: editor-scope readiness failed',
    );
  }

  const scopeRefs = currentVSCodeEditorScopePublicRefs([
    ...beforeObserve.refs,
    ...readiness.evidenceRefs,
    ...readiness.primitive.inputRefs,
  ]);
  const scopeBlockedReason = currentVSCodeEditorScopePublicRefsBlockedReason(scopeRefs);
  if (scopeBlockedReason) {
    return finish('blocked', `current VSCode editor preview diagnostic blocked: ${scopeBlockedReason}`, [`blocked:vscode-cowork:${scopeBlockedReason}`]);
  }

  const preview = createVSCodeEditorPreview({
    attemptId: runId,
    operationRef: `operation-ref:vscode:preview-current-selection:${runToken}`,
    scopeRefs,
    draftArtifactRef: input.draftArtifactRef ?? `artifact:vscode-editor-draft:${runToken}`,
  });
  pushRefs(evidenceRefs, preview.evidenceRefs);
  pushRefs(evidenceRefs, preview.artifactRefs);
  if (preview.status !== 'completed') {
    return finish('blocked', preview.message, preview.evidenceRefs);
  }

  return finish('completed', 'current VSCode editor preview live diagnostic completed refs-only preview and release');
}

export async function runCurrentVSCodeCoWorkEditorCurrentSelectionApplyLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkEditorCurrentSelectionApplyLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_CURRENT_SELECTION_APPLY_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_CURRENT_SELECTION_APPLY_LIVE_DIAGNOSTIC_ENV}`,
    });
  }
  if (!input.draftTextRef.startsWith('text-ref:')) {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: 'current VSCode current selection apply diagnostic blocked: text ref required',
      evidenceRefs: ['blocked:vscode-cowork:current-selection-apply-text-ref-required'],
    });
  }

  const runId = input.runId ?? `current-vscode-current-selection-apply-${Date.now()}`;
  const runToken = currentVSCodeEvidenceToken(runId);
  const primitiveOperation = input.primitiveOperation ?? 'replace-selection';
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
    reasonRefs: string[] = [],
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentVSCodeControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = currentVSCodeEditorCurrentSelectionApplyPublicRefs([
      ...evidenceRefs,
      ...reasonRefs,
    ]);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentVSCodeBind(service);
  primitiveChainObserved.push('bind');
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode current selection apply diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode current selection apply diagnostic blocked: observe failed');
  }

  const beforeRefs = currentVSCodeAppModuleRefs(beforeObserve.refs, beforeObserve.output?.observationRef);
  const apply = createVSCodeEditorNarrowApply({
    attemptId: runId,
    operationRef: `operation-ref:vscode:apply-current-selection:${runToken}`,
    primitiveOperation,
    scopeRefs: beforeRefs,
    draftTextRef: input.draftTextRef,
    requestedPrimitiveCount: 1,
  });
  primitiveChainObserved.push('host-decision');
  pushRefs(evidenceRefs, apply.status === 'completed'
    ? [
      ...apply.scopeRefs,
      ...apply.evidenceRefs,
      ...(apply.draftTextRef ? [apply.draftTextRef] : []),
    ]
    : [
      ...(apply.reasonRef ? [apply.reasonRef] : []),
      ...apply.scopeRefs,
      ...apply.evidenceRefs,
    ]);
  if (apply.status !== 'completed') {
    return finish(
      readinessFailureDiagnosticStatus(apply.status),
      apply.reasonRef ?? apply.message,
    );
  }
  if (apply.primitiveCandidates.length !== 1) {
    return finish('blocked', 'current VSCode current selection apply diagnostic blocked: single primitive candidate required', [
      'blocked:vscode-cowork:current-selection-apply-single-primitive-required',
    ]);
  }
  const candidate = apply.primitiveCandidates[0];
  if (!candidate || candidate.primitive.name !== 'computer_use.act') {
    return finish('blocked', 'current VSCode current selection apply diagnostic blocked: apply primitive invalid', [
      'blocked:vscode-cowork:current-selection-apply-primitive-invalid',
    ]);
  }

  const action = appModuleActionToComputerUseAction(candidate.primitive.action);
  if (!action) {
    return finish('blocked', 'current VSCode current selection apply diagnostic blocked: apply action invalid', [
      'blocked:vscode-cowork:current-selection-apply-action-invalid',
    ]);
  }

  const act = await currentVSCodeAct(service, sessionId, candidate.operation, action, candidate.primitive.inputRefs);
  primitiveChainObserved.push('act');
  if (act.status !== 'completed') {
    return finish('blocked', act.blockedReason ?? 'current VSCode current selection apply diagnostic blocked: act failed');
  }

  const afterObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (afterObserve.status !== 'completed') {
    return finish('blocked', afterObserve.blockedReason ?? 'current VSCode current selection apply diagnostic blocked: observe after apply failed');
  }

  const afterRefs = currentVSCodeAppModuleRefs(afterObserve.refs, afterObserve.output?.observationRef);
  const release = await currentVSCodeControlRelease(service, sessionId);
  primitiveChainObserved.push('control(release)');
  pushRefs(cleanupRefs, release.refs);
  sessionId = undefined;

  const verified = verifyVSCodeEditorNarrowApply({
    attemptId: runId,
    beforeRefs: currentVSCodeMutationVerifierRefs(beforeRefs),
    actionRefs: act.refs,
    afterRefs: currentVSCodeMutationVerifierRefs(afterRefs),
    cleanupRefs: currentVSCodeCoWorkCleanupRefs(cleanupRefs),
  });
  pushRefs(evidenceRefs, verified.status === 'ready'
    ? verified.evidenceRefs
    : [verified.reasonRef, ...verified.evidenceRefs]);
  if (verified.status !== 'ready') {
    return finish('blocked', verified.reasonRef, [verified.reasonRef]);
  }

  return finish('completed', 'current VSCode current selection apply live diagnostic completed one primitive, observe, verify, and release');
}

export async function runCurrentVSCodeCoWorkEditorScratchMutationLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkEditorScratchMutationLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const env = input.env ?? process.env;
  if (env[VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC_ENV] !== '1') {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC_ENV}`,
    });
  }
  if (!input.draftTextRef.startsWith('text-ref:')) {
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message: 'current VSCode scratch mutation diagnostic blocked: text ref required',
      evidenceRefs: ['blocked:vscode-cowork:scratch-text-ref-required'],
    });
  }

  const runId = input.runId ?? `current-vscode-scratch-mutation-${Date.now()}`;
  const runToken = currentVSCodeEvidenceToken(runId);
  const operation = input.operation ?? 'insert-draft';
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });
  const vscodeModule = createVSCodeAppModule();
  const primitiveChainObserved: string[] = [];
  const evidenceRefs: string[] = [];
  const cleanupRefs: string[] = [];
  let sessionId: string | undefined;

  const finish = async (
    status: VSCodeCoWorkLiveDiagnosticResult['status'],
    message: string,
    reasonRefs: string[] = [],
  ): Promise<VSCodeCoWorkLiveDiagnosticResult> => {
    if (sessionId) {
      const release = await currentVSCodeControlRelease(service, sessionId);
      primitiveChainObserved.push('control(release)');
      pushRefs(cleanupRefs, release.refs);
      sessionId = undefined;
    }
    const finalEvidenceRefs = currentVSCodeEditorScratchMutationPublicRefs([
      ...evidenceRefs,
      ...reasonRefs,
    ]);
    const finalCleanupRefs = currentVSCodeCoWorkCleanupRefs(cleanupRefs);
    return {
      status,
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [...primitiveChainObserved],
      evidenceRefs: finalEvidenceRefs,
      cleanupRefs: finalCleanupRefs,
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-live-diagnostic',
        status,
        text: message,
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: [...primitiveChainObserved],
        evidenceRefs: finalEvidenceRefs,
        cleanupRefs: finalCleanupRefs,
      },
    };
  };

  const bind = await currentVSCodeBind(service);
  primitiveChainObserved.push('bind');
  if (bind.status !== 'completed' || !bind.output?.sessionId) {
    pushRefs(cleanupRefs, bind.refs);
    return finish('blocked', bind.blockedReason ?? 'current VSCode scratch mutation diagnostic blocked: bind failed');
  }
  sessionId = bind.output.sessionId;

  const beforeObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (beforeObserve.status !== 'completed') {
    return finish('blocked', beforeObserve.blockedReason ?? 'current VSCode scratch mutation diagnostic blocked: observe failed');
  }

  const beforeRefs = currentVSCodeAppModuleRefs(beforeObserve.refs, beforeObserve.output?.observationRef);
  const readiness = vscodeModule.checkReadiness({
    operation,
    operationRef: `operation-ref:vscode:${operation}:${runToken}`,
    refs: [
      ...beforeRefs,
      input.draftTextRef,
    ],
  });
  primitiveChainObserved.push('host-decision');
  pushRefs(evidenceRefs, readiness.status === 'ready'
    ? [
      ...readiness.evidenceRefs,
      ...readiness.primitive.inputRefs,
      input.draftTextRef,
      ...beforeRefs.filter((ref) => ref.startsWith('non-user-file-scope:')),
    ]
    : [
      readiness.reasonRef,
      ...readiness.evidenceRefs,
      ...beforeRefs.filter((ref) => ref.startsWith('non-user-file-scope:')),
    ]);
  const scratchScopeReason = currentVSCodeScratchMutationScopeBlockedReason([
    ...beforeRefs,
    ...(readiness.status === 'ready' ? readiness.primitive.inputRefs : []),
    input.draftTextRef,
  ]);
  if (scratchScopeReason) {
    return finish('blocked', `current VSCode scratch mutation diagnostic blocked: ${scratchScopeReason}`, [`blocked:vscode-cowork:${scratchScopeReason}`]);
  }
  if (readiness.status !== 'ready' || readiness.primitive.name !== 'computer_use.act') {
    return finish(
      readinessFailureDiagnosticStatus(readiness.status),
      readiness.status === 'ready'
        ? 'current VSCode scratch mutation diagnostic blocked: scratch mutation primitive invalid'
        : readiness.reasonRef,
    );
  }

  const action = appModuleActionToComputerUseAction(readiness.primitive.action);
  if (!action) {
    return finish('blocked', 'current VSCode scratch mutation diagnostic blocked: scratch mutation action invalid', ['blocked:vscode-cowork:scratch-mutation-action-invalid']);
  }

  const act = await currentVSCodeAct(service, sessionId, operation, action, readiness.primitive.inputRefs);
  primitiveChainObserved.push('act');
  if (act.status !== 'completed') {
    return finish('blocked', act.blockedReason ?? 'current VSCode scratch mutation diagnostic blocked: act failed');
  }

  const afterObserve = await currentVSCodeObserve(service, sessionId);
  primitiveChainObserved.push('observe');
  if (afterObserve.status !== 'completed') {
    return finish('blocked', afterObserve.blockedReason ?? 'current VSCode scratch mutation diagnostic blocked: observe after mutation failed');
  }
  const afterRefs = currentVSCodeAppModuleRefs(afterObserve.refs, afterObserve.output?.observationRef);
  const mutation = verifyVSCodeMutationEvidence({
    beforeRefs: currentVSCodeMutationVerifierRefs(beforeRefs),
    actionRefs: act.refs,
    afterRefs: currentVSCodeMutationVerifierRefs(afterRefs),
  });
  pushRefs(evidenceRefs, mutation.status === 'ready'
    ? mutation.evidenceRefs
    : [mutation.reasonRef, ...mutation.evidenceRefs]);
  if (mutation.status !== 'ready') {
    return finish('blocked', mutation.reasonRef, [mutation.reasonRef]);
  }

  return finish('completed', 'current VSCode scratch mutation live diagnostic completed non-user scratch mutation and release');
}

export function createCurrentVSCodeCoWorkFocusedEditorEvidenceProvider(): VSCodeCoWorkFocusedEditorEvidenceProvider {
  return (input) => {
    const afterObserveRefs = uniqueSafeRefs(input.afterObserveRefs);
    const nativeFocusedEditorRef = afterObserveRefs.find((ref) => ref.startsWith('focused-editor:'));
    if (nativeFocusedEditorRef) {
      return {
        status: 'satisfied',
        focusedEditorRef: nativeFocusedEditorRef,
        verifierRef: `verifier:vscode-cowork:${currentVSCodeEvidenceToken(input.attemptId)}:focus-editor`,
        evidenceRefs: [
          nativeFocusedEditorRef,
          input.decisionRef,
          ...afterObserveRefs,
        ],
      };
    }

    const actionRefs = uniqueSafeRefs(input.actionRefs);
    const hasFocusActionEvidence = actionRefs.some((ref) => /^action:.*:focus-editor$/i.test(ref))
      && actionRefs.some((ref) => /^executor-event:.*:focus-editor$/i.test(ref))
      && actionRefs.some((ref) => /^input-event:.*:focus-editor$/i.test(ref));
    if (!hasFocusActionEvidence) {
      return {
        status: 'blocked',
        reason: 'focus-editor-action-evidence-required',
        evidenceRefs: input.evidenceRefs,
      };
    }

    const windowRefs = refsWithPrefix(afterObserveRefs, 'window:');
    const frontmostRefs = refsWithPrefix(afterObserveRefs, 'frontmost:');
    const fileRefs = refsWithPrefix(afterObserveRefs, 'file-ref:');
    const editorElementRefs = afterObserveRefs.filter((ref) => /^element:vscode:editor(?::|$)/i.test(ref));
    const observationRefs = refsWithPrefix(afterObserveRefs, 'observation:');
    const freshnessRefs = refsWithPrefix(afterObserveRefs, 'freshness:');
    const perceptionRefs = afterObserveRefs.filter((ref) =>
      /^(?:accessibility:|image:|text:title:|text:vscode:)/i.test(ref)
    );
    const blockedReason = currentVSCodeFocusedEditorProviderBlockedReason({
      windowRefs,
      frontmostRefs,
      fileRefs,
      editorElementRefs,
      observationRefs,
      freshnessRefs,
      perceptionRefs,
    });
    if (blockedReason) {
      return {
        status: 'blocked',
        reason: blockedReason,
        evidenceRefs: input.evidenceRefs,
      };
    }

    const focusedEditorRef = `focused-editor:vscode:sciforge-provider:${currentVSCodeEvidenceToken(input.attemptId)}`;
    return {
      status: 'satisfied',
      focusedEditorRef,
      verifierRef: `verifier:vscode-cowork:${currentVSCodeEvidenceToken(input.attemptId)}:focus-editor`,
      evidenceRefs: [
        focusedEditorRef,
        input.decisionRef,
        ...actionRefs,
        ...windowRefs,
        ...frontmostRefs,
        ...fileRefs,
        ...editorElementRefs,
        ...observationRefs,
        ...freshnessRefs,
        ...perceptionRefs,
      ],
    };
  };
}

function currentVSCodeFocusedEditorProviderBlockedReason(input: {
  windowRefs: string[];
  frontmostRefs: string[];
  fileRefs: string[];
  editorElementRefs: string[];
  observationRefs: string[];
  freshnessRefs: string[];
  perceptionRefs: string[];
}): string | undefined {
  if (input.windowRefs.length !== 1) return 'focused-editor-window-ref-unique-required';
  if (input.frontmostRefs.length === 0) return 'focused-editor-frontmost-ref-required';
  if (input.fileRefs.length === 0) return 'focused-editor-file-ref-required';
  if (input.editorElementRefs.length === 0) return 'focused-editor-editor-element-ref-required';
  if (input.observationRefs.length === 0) return 'focused-editor-observation-ref-required';
  if (input.freshnessRefs.length === 0) return 'focused-editor-freshness-ref-required';
  if (input.perceptionRefs.length === 0) return 'focused-editor-observation-evidence-ref-required';
  return undefined;
}

function refsWithPrefix(refs: string[], prefix: string): string[] {
  return refs.filter((ref) => ref.startsWith(prefix));
}

function uniqueSafeRefs(refs: string[] | undefined): string[] {
  return [...new Set((refs ?? []).filter((ref) => typeof ref === 'string' && ref.length > 0))];
}

function pushRefs(target: string[], refs: string[] | undefined): void {
  target.splice(0, target.length, ...uniqueSafeRefs([...target, ...(refs ?? [])]));
}

function currentVSCodeAppModuleRefs(refs: string[], currentObservationRef: string | undefined): string[] {
  return uniqueSafeRefs(refs).filter((ref) =>
    !ref.startsWith('observation:vscode:') || !currentObservationRef || ref === currentObservationRef
  );
}

function currentVSCodeMutationVerifierRefs(refs: string[]): string[] {
  const safeRefs = uniqueSafeRefs(refs);
  const editorRef = safeRefs.find((ref) => ref.startsWith('element:vscode:editor:') || ref.startsWith('element:vscode:monaco:'))
    ?? safeRefs.find((ref) => ref.startsWith('focused-editor:vscode:'));
  const verifierRefs: Array<string | undefined> = [
    safeRefs.find((ref) => ref.startsWith('window:vscode:')),
    safeRefs.find((ref) => ref.startsWith('observation:vscode:')),
    safeRefs.find((ref) => ref.startsWith('freshness:vscode:')),
    safeRefs.find((ref) => ref.startsWith('file-ref:vscode:') || ref.startsWith('selected-file:vscode:')),
    editorRef,
    safeRefs.find((ref) => ref.startsWith('selection-ref:vscode:')),
    safeRefs.find((ref) => ref.startsWith('cursor-ref:vscode:')),
    safeRefs.find((ref) => ref.startsWith('range-ref:vscode:')),
    ...safeRefs.filter((ref) => ref.startsWith('text:')),
    ...safeRefs.filter((ref) => ref.startsWith('verifier:')),
  ];
  return uniqueSafeRefs(verifierRefs.filter((ref): ref is string => typeof ref === 'string'));
}

function readinessFailureDiagnosticStatus(status: 'ready' | 'blocked' | 'needs-confirmation'): VSCodeCoWorkLiveDiagnosticResult['status'] {
  return status === 'needs-confirmation' ? 'needs-confirmation' : 'blocked';
}

function appModuleActionToComputerUseAction(action: unknown): ComputerUseAtomicAction | undefined {
  if (!isRecord(action)) return undefined;
  if (action.kind === 'key' && typeof action.key === 'string') {
    return {
      type: 'key',
      key: action.key,
    };
  }
  if (action.kind === 'type' && typeof action.textRef === 'string' && action.textRef.startsWith('text-ref:')) {
    return {
      type: 'type',
      textRef: action.textRef,
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function currentVSCodeBind(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseBindOutput>> {
  return currentTerminalBind(service);
}

async function currentVSCodeObserve(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseObserveOutput>> {
  return currentTerminalObserve(service, sessionId);
}

async function currentVSCodeAct(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
  actionId: string,
  action: ComputerUseAtomicAction,
  contextRefs: string[],
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseActOutput>> {
  return currentTerminalAct(service, sessionId, actionId, action, contextRefs);
}

async function currentVSCodeControlRelease(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseControlOutput>> {
  return currentTerminalControlRelease(service, sessionId);
}

async function currentTerminalBind(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseBindOutput>> {
  return invokeCurrentTerminalPrimitive<ComputerUseBindOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.bind, 'bind', {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
    },
  });
}

async function currentTerminalObserve(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseObserveOutput>> {
  return invokeCurrentTerminalPrimitive<ComputerUseObserveOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.observe, 'observe', {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
    sessionId,
    capture: 'both',
    includeTree: true,
  });
}

async function currentTerminalAct(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
  actionId: string,
  action: ComputerUseAtomicAction,
  contextRefs: string[],
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseActOutput>> {
  return invokeCurrentTerminalPrimitive<ComputerUseActOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.act, 'act', {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
    sessionId,
    actionId,
    contextRefs,
    action,
    captureAfter: true,
  });
}

async function currentTerminalControlRelease(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
): Promise<ComputerUsePrimitiveEnvelope<ComputerUseControlOutput>> {
  return invokeCurrentTerminalPrimitive<ComputerUseControlOutput>(service, COMPUTER_USE_PRIMITIVE_INTENTS.control, 'control', {
    schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
    sessionId,
    command: 'release',
  });
}

async function invokeCurrentTerminalPrimitive<T>(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  intent: typeof COMPUTER_USE_PRIMITIVE_INTENTS[keyof typeof COMPUTER_USE_PRIMITIVE_INTENTS],
  primitive: ComputerUsePrimitiveEnvelope<T>['primitive'],
  input: Record<string, unknown>,
): Promise<ComputerUsePrimitiveEnvelope<T>> {
  const result = await service.invoke({
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    intent,
    input,
  });
  if (result.value) return result.value as ComputerUsePrimitiveEnvelope<T>;
  return {
    schemaVersion: COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA,
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    primitive,
    status: 'blocked',
    refs: [],
    diagnostics: [],
    budget: {},
    blockedReason: result.error ?? 'current-vscode-terminal-primitive-blocked',
  };
}

function currentTerminalContextRefs(refs: string[]): [string, string, string] | undefined {
  const safeRefs = uniqueSafeRefs(refs);
  const terminalRef = safeRefs.find((ref) => ref.startsWith('terminal:vscode:') || ref.startsWith('element:vscode:terminal:'));
  const terminalSessionRef = safeRefs.find((ref) => ref.startsWith('terminal-session:vscode:'));
  const terminalInputRef = safeRefs.find((ref) => ref.startsWith('terminal-input:vscode:'));
  if (!terminalRef || !terminalSessionRef || !terminalInputRef) return undefined;
  return [terminalRef, terminalSessionRef, terminalInputRef];
}

function currentVSCodeEditorScopePublicRefs(refs: string[]): string[] {
  return uniqueSafeRefs(refs).filter(isCurrentVSCodeEditorScopePublicRef);
}

function currentVSCodeEditorPreviewPublicRefs(refs: string[]): string[] {
  return uniqueSafeRefs(refs).filter(isCurrentVSCodeEditorPreviewPublicRef);
}

function currentVSCodeEditorCurrentSelectionApplyPublicRefs(refs: string[]): string[] {
  return uniqueSafeRefs(refs).filter(isCurrentVSCodeEditorCurrentSelectionApplyPublicRef);
}

function currentVSCodeEditorScratchMutationPublicRefs(refs: string[]): string[] {
  return uniqueSafeRefs(refs).filter(isCurrentVSCodeEditorScratchMutationPublicRef);
}

function currentVSCodeCoWorkCleanupRefs(refs: string[]): string[] {
  return uniqueSafeRefs(refs).filter(isCurrentVSCodeCoWorkCleanupRef);
}

function isCurrentVSCodeCoWorkCleanupRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  return (ref.startsWith('control:current-vscode-cowork:') && ref.endsWith(':release'))
    || ref.startsWith('scoped-input-lease:current-vscode-cowork:')
    || ref.startsWith('scoped-input-adapter:current-vscode-cowork:')
    || ref.startsWith('cursor-marker:current-vscode-cowork:')
    || ref.startsWith('front-app-restore:current-vscode-cowork:')
    || ref.startsWith('mouse-position-restore:current-vscode-cowork:');
}

function isCurrentVSCodeEditorScopePublicRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  if (isUnsafeEditorScopeRef(ref)) return false;
  return ref.startsWith('element:vscode:editor:')
    || ref.startsWith('element:vscode:monaco:')
    || ref.startsWith('focused-editor:vscode:')
    || ref.startsWith('file-ref:vscode:')
    || ref.startsWith('selected-file:vscode:')
    || ref.startsWith('selection-ref:vscode:')
    || ref.startsWith('cursor-ref:vscode:')
    || ref.startsWith('range-ref:vscode:')
    || ref.startsWith('freshness:vscode:')
    || ref.startsWith('stale-invalidation:vscode:')
    || ref.startsWith('blocked:vscode-app-module:')
    || ref.startsWith('needs-confirmation:vscode-app-module:')
    || ref.startsWith('blocked:vscode-cowork:')
    || ref.startsWith('needs-confirmation:vscode-cowork:');
}

function isCurrentVSCodeEditorPreviewPublicRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  return isCurrentVSCodeEditorScopePublicRef(ref)
    || ref.startsWith('artifact:vscode-editor-draft:')
    || ref.startsWith('artifact:vscode-editor-preview:')
    || ref.startsWith('artifact:vscode-editor-preview-diff:')
    || ref.startsWith('verifier:vscode-editor-preview:')
    || ref.startsWith('blocked:vscode-editor-preview:')
    || ref.startsWith('needs-confirmation:vscode-editor-preview:');
}

function isCurrentVSCodeEditorScratchMutationPublicRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  return isCurrentVSCodeEditorScopePublicRef(ref)
    || ref.startsWith('text-ref:')
    || ref.startsWith('non-user-file-scope:vscode:')
    || ref.startsWith('verifier:vscode-app-module:')
    || ref.startsWith('blocked:vscode-cowork:scratch-')
    || ref.startsWith('needs-confirmation:vscode-cowork:scratch-');
}

function isCurrentVSCodeEditorCurrentSelectionApplyPublicRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 240) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  return isCurrentVSCodeEditorScopePublicRef(ref)
    || ref.startsWith('text-ref:')
    || ref.startsWith('verifier:vscode-app-module:')
    || ref.startsWith('verifier:vscode-editor-narrow-apply:')
    || ref.startsWith('blocked:vscode-editor-narrow-apply:')
    || ref.startsWith('needs-confirmation:vscode-editor-narrow-apply:')
    || ref.startsWith('blocked:vscode-cowork:current-selection-apply-')
    || ref.startsWith('needs-confirmation:vscode-cowork:current-selection-apply-');
}

function currentVSCodeEditorScopePublicRefsBlockedReason(refs: string[]): string | undefined {
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

function currentVSCodeScratchMutationScopeBlockedReason(refs: string[]): string | undefined {
  const publicRefs = currentVSCodeEditorScratchMutationPublicRefs(refs);
  const scopeReason = currentVSCodeEditorScopePublicRefsBlockedReason(publicRefs);
  if (scopeReason) return scopeReason;
  if (!publicRefs.some((ref) => ref.startsWith('text-ref:'))) {
    return 'scratch-text-ref-required';
  }
  if (!publicRefs.some((ref) => ref.startsWith('non-user-file-scope:vscode:'))) {
    return 'scratch-non-user-file-scope-required';
  }
  const fileRefs = publicRefs.filter((ref) => ref.startsWith('file-ref:vscode:') || ref.startsWith('selected-file:vscode:'));
  if (!fileRefs.some((ref) => /^file-ref:vscode:scratch:|^selected-file:vscode:scratch:/i.test(ref))) {
    return 'scratch-file-ref-required';
  }
  return undefined;
}

function isUnsafeEditorScopeRef(ref: string): boolean {
  const match = /^(?:selection-ref|cursor-ref|range-ref):(.+)$/i.exec(ref);
  if (!match) return false;
  const parts = match[1].split(':').filter(Boolean);
  return parts.length === 0 || parts.some((part) =>
    !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(part)
      || /raw|payload|selected|text|diff|path|file|url|http|secret|password|base64|provider|command/i.test(part),
  );
}

function currentVSCodeEvidenceToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'attempt';
}

export async function runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkInsertDraftLiveDiagnosticInput,
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const preflight = await runCurrentVSCodeCoWorkLiveDiagnosticPreflight({ env: input.env });
  if (preflight.status !== 'ready') {
    const message = preflight.skipReason ?? (preflight.blockedReasons.join('; ') || 'current VSCode co-work insert-draft live diagnostic blocked');
    return currentVSCodeCoWorkHostFinalAnswerResult({
      status: 'blocked',
      message,
    });
  }

  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: input.runId,
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
      readCurrentWindow: input.readCurrentWindow,
      performAction: input.performAction,
      resolveTextRef: input.resolveTextRef,
      typeResolvedText: input.typeResolvedText,
      pressKeyInCurrentVSCode: input.pressKeyInCurrentVSCode,
      captureRestorationState: input.captureRestorationState,
      restoreCapturedState: input.restoreCapturedState,
      restoreFocus: input.restoreFocus,
      restoreMouse: input.restoreMouse,
    }),
  });

  return runVSCodeCoWorkInsertDraftLiveDiagnostic({
    service,
    commandText: input.commandText ?? 'insert draft text into the current VSCode window',
    workspacePath: input.workspacePath ?? process.cwd(),
    commandId: input.commandId ?? 'current-vscode-cowork-insert-draft',
    attemptId: input.attemptId ?? `current-vscode-cowork-${Date.now()}`,
    authorizationProfileId: input.authorizationProfileId,
    draftTextRef: input.draftTextRef,
    focusedEditorContextRefs: input.focusedEditorContextRefs,
    focusedEditorEvidenceVerifier: input.focusedEditorEvidenceVerifier,
    focusedEditorEvidenceProvider: input.focusedEditorEvidenceProvider,
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
    },
  });
}
