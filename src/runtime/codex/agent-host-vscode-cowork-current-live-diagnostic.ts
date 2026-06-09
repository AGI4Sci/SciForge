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
  VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV,
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

export async function runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic(
  input: RunCurrentVSCodeCoWorkReadVisibleTextLiveDiagnosticInput = {},
): Promise<VSCodeCoWorkLiveDiagnosticResult> {
  const preflight = await runCurrentVSCodeCoWorkLiveDiagnosticPreflight({ env: input.env });
  if (preflight.status !== 'ready') {
    const message = preflight.skipReason ?? (preflight.blockedReasons.join('; ') || 'current VSCode co-work live diagnostic blocked');
    return {
      status: 'blocked',
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
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
    return {
      status: 'blocked',
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
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
    return {
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV}`,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
  }
  if (!input.terminalTextRef.startsWith('text-ref:')) {
    return {
      status: 'blocked',
      message: 'current VSCode co-work terminal diagnostic blocked: terminal text ref required',
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: ['blocked:vscode-cowork:terminal-text-ref-required'],
      cleanupRefs: [],
    };
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
    const finalCleanupRefs = uniqueSafeRefs(cleanupRefs);
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
    return {
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV}`,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
  }
  if (!input.paletteQueryTextRef.startsWith('text-ref:')) {
    return {
      status: 'blocked',
      message: 'current VSCode co-work command palette diagnostic blocked: palette query text ref required',
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: ['blocked:vscode-cowork:palette-query-text-ref-required'],
      cleanupRefs: [],
    };
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
    const finalCleanupRefs = uniqueSafeRefs(cleanupRefs);
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
      ...bind.refs,
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
      ...bind.refs,
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
    return {
      status: 'blocked',
      message: `missing-env:${VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV}`,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
  }
  return {
    status: 'blocked',
    message: 'current VSCode co-work editor scope diagnostic blocked: mocked scope diagnostic is not implemented yet',
    maturity: 'live-diagnostic',
    productReady: false,
    primitiveChainObserved: [],
    evidenceRefs: ['blocked:vscode-cowork:editor-scope-diagnostic-not-implemented'],
    cleanupRefs: [],
  };
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
    return {
      status: 'blocked',
      message,
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: [],
      evidenceRefs: [],
      cleanupRefs: [],
    };
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
