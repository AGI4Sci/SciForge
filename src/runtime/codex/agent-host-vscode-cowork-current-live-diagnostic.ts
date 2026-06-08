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
  type VSCodeCoWorkFocusedEditorEvidenceProvider,
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
    focusedEditorEvidenceProvider: input.focusedEditorEvidenceProvider
      ?? (input.focusedEditorEvidenceVerifier ? undefined : createCurrentVSCodeCoWorkFocusedEditorEvidenceProvider()),
    target: {
      kind: 'app',
      appRef: 'macos-app:com.microsoft.VSCode',
      targetRef: 'current-vscode-cowork',
      appId: 'com.microsoft.VSCode',
    },
  });
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
      appId: 'com.microsoft.VSCode',
    },
  });
}
