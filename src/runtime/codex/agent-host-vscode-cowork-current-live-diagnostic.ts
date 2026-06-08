import {
  createComputerUsePrimitiveService,
} from '../../../packages/actions/computer-use/index.js';
import {
  createCurrentVSCodeCoWorkLivePrimitivePorts,
  runCurrentVSCodeCoWorkLiveDiagnosticPreflight,
  type CurrentVSCodeCoWorkLivePrimitivePortsOptions,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runVSCodeCoWorkInsertDraftLiveDiagnostic,
  runVSCodeCoWorkFocusEditorLiveDiagnostic,
  runVSCodeCoWorkReadVisibleTextLiveDiagnostic,
  type VSCodeCoWorkFocusedEditorEvidenceVerifier,
  type VSCodeCoWorkLiveDiagnosticResult,
} from './agent-host-vscode-cowork-live-diagnostic.js';

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
      appId: 'com.microsoft.VSCode',
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
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
      appId: 'com.microsoft.VSCode',
    },
  });
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
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
      appId: 'com.microsoft.VSCode',
    },
  });
}
