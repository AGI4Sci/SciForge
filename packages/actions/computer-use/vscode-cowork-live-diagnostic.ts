import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  ComputerUseActInput,
  ComputerUseActOutput,
  ComputerUseAtomicAction,
  ComputerUseDiagnostic,
  ComputerUseObserveInput,
  ComputerUsePrimitivePorts,
} from './index.js';

const execFileAsync = promisify(execFile);

export const VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV = 'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_CURRENT_SELECTION_APPLY_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_CURRENT_SELECTION_APPLY_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC_ENV =
  'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_SCRATCH_MUTATION_LIVE_DIAGNOSTIC' as const;
export const VSCODE_COWORK_LIVE_DIAGNOSTIC_SCHEMA_VERSION =
  'sciforge.computer-use.current-vscode-cowork-live-diagnostic.v1' as const;

export const VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY = {
  maturity: 'live-diagnostic',
  productReady: false,
  sharedSystemInputUsed: true,
  userProfileUsed: true,
  requiresExplicitEnv: `${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}=1`,
  primitiveChainRequired: 'bind -> observe -> Host decision -> observe -> control(release)',
  opensTestFile: false,
  killsUserVSCode: false,
  clearsUserProfile: false,
} as const;

export interface CurrentVSCodeCoWorkWindowObservation {
  appRef: string;
  processRef: string;
  windowRef: string;
  titleRef: string;
  frontmostRef: string;
  fileRefs: string[];
  editorElementRef: string;
  focusedEditorRef?: string;
  selectionRef?: string;
  cursorRef?: string;
  rangeRef?: string;
  terminalElementRef?: string;
  terminalSessionRef?: string;
  terminalInputRef?: string;
  terminalOutputRef?: string;
  terminalOutputHashRef?: string;
  commandPaletteRootRef?: string;
  commandPaletteInputRef?: string;
  commandPaletteItemsRef?: string;
  commandPaletteItemRefs?: string[];
  commandPaletteItemRankRefs?: string[];
  commandPaletteItemHashRefs?: string[];
  visibleTextRef: string;
  visibleTextSha256Ref?: string;
  screenshotRef?: string;
  accessibilityRef: string;
  freshnessRef: string;
  observationRef: string;
}

export interface CurrentVSCodeCoWorkWindowSnapshot {
  pid: string;
  windowTitle: string;
  collectedText: string;
  focusedRole?: string;
  focusedName?: string;
  focusedValue?: string;
  focusedDescription?: string;
  focusedContext?: string;
  observedAtMs?: number;
}

export interface CurrentVSCodeCoWorkRestorationState {
  frontApplicationName?: string;
  mousePosition?: {
    x: number;
    y: number;
  };
}

export interface CurrentVSCodeCoWorkRestorationRefs {
  frontAppRestoreRef: string;
  mousePositionRestoreRef: string;
}

export interface CurrentVSCodeCoWorkLiveActionExecution {
  action: ComputerUseAtomicAction;
  actionRef: string;
  executorEventRef: string;
  inputEventRef: string;
  contextRefs?: string[];
  inputAdapterRef?: string;
  cursorRef?: string;
  scopedInputLeaseRef?: string;
  beforeObservationRef: string;
  focusedEditorRef?: string;
}

export interface CurrentVSCodeCoWorkLiveResolvedTextExecution
  extends CurrentVSCodeCoWorkLiveActionExecution {
  textRef: string;
  text: string;
}

export interface CurrentVSCodeCoWorkLiveKeyExecution
  extends CurrentVSCodeCoWorkLiveActionExecution {
  key: string;
}

export interface CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  runId?: string;
  activateCurrentVSCodeIfNeeded?: boolean;
  readCurrentWindow?: () => Promise<CurrentVSCodeCoWorkWindowObservation>;
  performAction?: (input: CurrentVSCodeCoWorkLiveActionExecution) => Promise<void> | void;
  resolveTextRef?: (textRef: string) => Promise<string | undefined> | string | undefined;
  typeResolvedText?: (input: CurrentVSCodeCoWorkLiveResolvedTextExecution) => Promise<void> | void;
  pressKeyInCurrentVSCode?: (input: CurrentVSCodeCoWorkLiveKeyExecution) => Promise<void> | void;
  captureRestorationState?: () => Promise<CurrentVSCodeCoWorkRestorationState>;
  restoreCapturedState?: (
    state: CurrentVSCodeCoWorkRestorationState,
    refs: CurrentVSCodeCoWorkRestorationRefs,
  ) => Promise<void> | void;
  restoreFocus?: (frontAppRestoreRef: string) => Promise<void> | void;
  restoreMouse?: (mousePositionRestoreRef: string) => Promise<void> | void;
}

export interface CurrentVSCodeCoWorkLiveDiagnosticManifest {
  schemaVersion: typeof VSCODE_COWORK_LIVE_DIAGNOSTIC_SCHEMA_VERSION;
  status: 'blocked' | 'ready';
  maturity: 'live-diagnostic';
  productReady: false;
  sharedSystemInputUsed: true;
  userProfileUsed: true;
  runner: 'computer-use-current-vscode-cowork-live-diagnostic';
  checkedAt: string;
  skipReason?: string;
  vscodeLaunched: false;
  userProfileCleared: false;
  userVSCodeKilled: false;
  primitiveChainRequired: typeof VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY.primitiveChainRequired;
  primitiveChainObserved: string[];
  blockedReasons: string[];
}

export async function runCurrentVSCodeCoWorkLiveDiagnosticPreflight(input: {
  env?: Record<string, string | undefined>;
  now?: () => Date;
} = {}): Promise<CurrentVSCodeCoWorkLiveDiagnosticManifest> {
  const env = input.env ?? process.env;
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  const missingEnv = env[VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV] !== '1';
  return {
    schemaVersion: VSCODE_COWORK_LIVE_DIAGNOSTIC_SCHEMA_VERSION,
    status: missingEnv ? 'blocked' : 'ready',
    maturity: 'live-diagnostic',
    productReady: false,
    sharedSystemInputUsed: true,
    userProfileUsed: true,
    runner: 'computer-use-current-vscode-cowork-live-diagnostic',
    checkedAt,
    ...(missingEnv ? { skipReason: `missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}` } : {}),
    vscodeLaunched: false,
    userProfileCleared: false,
    userVSCodeKilled: false,
    primitiveChainRequired: VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY.primitiveChainRequired,
    primitiveChainObserved: [],
    blockedReasons: missingEnv ? [`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`] : [],
  };
}

export function createCurrentVSCodeCoWorkLivePrimitivePorts(
  options: CurrentVSCodeCoWorkLivePrimitivePortsOptions = {},
): ComputerUsePrimitivePorts {
  const runId = safeRunId(options.runId ?? `current-${Date.now()}`);
  const sessionId = `current-vscode-cowork:${runId}`;
  const computerUseSessionRef = `computer-use-session:current-vscode-cowork:${runId}`;
  const windowActionSessionRef = `window-action-session:current-vscode-cowork:${runId}`;
  const inputAdapterRef = `scoped-input-adapter:current-vscode-cowork:${runId}`;
  const cursorRef = `cursor-marker:current-vscode-cowork:${runId}`;
  const scopedInputLeaseRef = `scoped-input-lease:current-vscode-cowork:${runId}`;
  const frontAppRestoreRef = `front-app-restore:current-vscode-cowork:${runId}`;
  const mousePositionRestoreRef = `mouse-position-restore:current-vscode-cowork:${runId}`;
  const readCurrentWindow = options.readCurrentWindow
    ?? (() => readCurrentVSCodeWindowRefs({
      activateIfNotFrontmost: options.activateCurrentVSCodeIfNeeded === true,
    }));
  const shouldUseDesktopRestoration = !options.readCurrentWindow;
  const captureRestorationState = options.captureRestorationState
    ?? (shouldUseDesktopRestoration ? captureCurrentRestorationState : undefined);
  const restoreCapturedState = options.restoreCapturedState
    ?? (shouldUseDesktopRestoration ? restoreCurrentRestorationState : undefined);
  let restorationState: CurrentVSCodeCoWorkRestorationState = {};
  let lastObservationRef: string | undefined;
  let lastFocusedEditorRef: string | undefined;

  return {
    bind: async () => {
      restorationState = await captureRestorationState?.().catch(() => ({})) ?? {};
      let observed: CurrentVSCodeCoWorkWindowObservation;
      try {
        observed = await readCurrentWindow();
      } catch (error) {
        const restorationRefs = {
          frontAppRestoreRef,
          mousePositionRestoreRef,
        };
        const diagnostics = await attemptRestoration(restorationState, restorationRefs, {
          restoreCapturedState,
          restoreFocus: options.restoreFocus,
          restoreMouse: options.restoreMouse,
        });
        return {
          status: 'blocked',
          blockedReason: safeBlockedReason(error),
          refs: [
            frontAppRestoreRef,
            mousePositionRestoreRef,
          ],
          diagnostics,
        };
      }
      lastObservationRef = observed.observationRef;
      lastFocusedEditorRef = observed.focusedEditorRef;
      return {
        status: 'completed',
        output: {
          sessionId,
          sessionRef: computerUseSessionRef,
          targetRef: observed.windowRef,
          inputAdapterRef,
          cursorRef,
          windowActionSessionRef,
          scopedInputLeaseRef,
          observationRef: observed.observationRef,
        },
        refs: uniqueRefs([
          computerUseSessionRef,
          windowActionSessionRef,
          scopedInputLeaseRef,
          inputAdapterRef,
          cursorRef,
          frontAppRestoreRef,
          mousePositionRestoreRef,
          ...observationRefs(observed),
        ]),
      };
    },
    observe: async (input: ComputerUseObserveInput) => {
      const previousObservationRef = lastObservationRef;
      const observed = await readCurrentWindow();
      lastObservationRef = observed.observationRef;
      lastFocusedEditorRef = observed.focusedEditorRef;
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          observationRef: observed.observationRef,
          screenshotRef: observed.screenshotRef,
          accessibilityRef: observed.accessibilityRef,
          elementRefs: uniqueRefs([observed.editorElementRef, observed.terminalElementRef]),
          textRefs: uniqueRefs([
            observed.visibleTextRef,
            observed.visibleTextSha256Ref,
            observed.terminalOutputRef,
            observed.terminalOutputHashRef,
          ]),
          staleInvalidationRefs: uniqueRefs([previousObservationRef]),
        },
        refs: uniqueRefs([
          computerUseSessionRef,
          windowActionSessionRef,
          ...observationRefs(observed),
          previousObservationRef,
        ]),
      };
    },
    act: async (input: ComputerUseActInput) => {
      const actionId = safeRunId(input.actionId ?? input.action.type);
      const actionRef = `action:current-vscode-cowork:${runId}:${actionId}`;
      const executorEventRef = `executor-event:current-vscode-cowork:${runId}:${actionId}`;
      const inputEventRef = `input-event:current-vscode-cowork:${runId}:${actionId}`;
      const invalidatedRef = `stale-invalidation:current-vscode-cowork:${runId}:${actionId}`;
      const beforeObservationRef = lastObservationRef;
      const contextRefs = safeCurrentVSCodeContextRefs(input.contextRefs);
      const focusedEditorContextRef = contextRefs.find((ref) => ref.startsWith('focused-editor:'));
      const focusedEditorRef = lastFocusedEditorRef ?? focusedEditorContextRef;
      if (!beforeObservationRef) {
        return {
          status: 'blocked',
          blockedReason: 'current-vscode-act-before-observation-missing',
          refs: uniqueRefs([
            actionRef,
            executorEventRef,
            inputEventRef,
            scopedInputLeaseRef,
            inputAdapterRef,
            cursorRef,
            ...contextRefs,
          ]),
        };
      }
      const actionExecution = {
        action: input.action,
        actionRef,
        executorEventRef,
        inputEventRef,
        contextRefs,
        inputAdapterRef: input.inputAdapterRef,
        cursorRef: input.cursorRef,
        scopedInputLeaseRef: input.scopedInputLeaseRef,
        beforeObservationRef,
        focusedEditorRef,
      };
      try {
        if (options.performAction) {
          await options.performAction(actionExecution);
        } else {
          await performDefaultCurrentVSCodeAction(actionExecution, options);
        }
      } catch (error) {
        return {
          status: 'blocked',
          blockedReason: safeBlockedReason(error),
          refs: uniqueRefs([
            actionRef,
            executorEventRef,
            inputEventRef,
            beforeObservationRef,
            focusedEditorRef,
            scopedInputLeaseRef,
            inputAdapterRef,
            cursorRef,
            ...contextRefs,
          ]),
        };
      }
      const afterObserved = await readCurrentWindow();
      lastFocusedEditorRef = afterObserved.focusedEditorRef ?? lastFocusedEditorRef;
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          actionRef,
          executorEventRef,
          inputAdapterRef: input.inputAdapterRef,
          cursorRef: input.cursorRef,
          scopedInputLeaseRef: input.scopedInputLeaseRef,
          inputEventRef,
          beforeObservationRef,
          afterObservationRef: afterObserved.observationRef,
          invalidatedRefs: uniqueRefs([beforeObservationRef, invalidatedRef]),
        } satisfies ComputerUseActOutput,
        refs: uniqueRefs([
          actionRef,
          executorEventRef,
          inputEventRef,
          input.action.elementRef,
          input.action.textRef,
          input.action.key ? `key:current-vscode-cowork:${runId}:${safeRunId(input.action.key)}` : undefined,
          input.action.command ? `app-command:current-vscode-cowork:${runId}:${safeRunId(input.action.command)}` : undefined,
          beforeObservationRef,
          focusedEditorRef,
          afterObserved.observationRef,
          invalidatedRef,
          scopedInputLeaseRef,
          inputAdapterRef,
          cursorRef,
          ...contextRefs,
          ...observationRefs(afterObserved),
        ]),
      };
    },
    control: async (input) => {
      let diagnostics: ComputerUseDiagnostic[] = [];
      if (input.command === 'release') {
        const restorationRefs = {
          frontAppRestoreRef,
          mousePositionRestoreRef,
        };
        diagnostics = await attemptRestoration(restorationState, restorationRefs, {
          restoreCapturedState,
          restoreFocus: options.restoreFocus,
          restoreMouse: options.restoreMouse,
        });
      }
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          controlRef: `control:current-vscode-cowork:${runId}:release`,
          releasedRefs: [
            scopedInputLeaseRef,
            inputAdapterRef,
            cursorRef,
          ],
        },
        diagnostics,
        refs: [
          `control:current-vscode-cowork:${runId}:release`,
          scopedInputLeaseRef,
          inputAdapterRef,
          cursorRef,
          frontAppRestoreRef,
          mousePositionRestoreRef,
        ],
      };
    },
  };
}

async function attemptRestoration(
  state: CurrentVSCodeCoWorkRestorationState,
  refs: CurrentVSCodeCoWorkRestorationRefs,
  hooks: Pick<CurrentVSCodeCoWorkLivePrimitivePortsOptions, 'restoreCapturedState' | 'restoreFocus' | 'restoreMouse'>,
): Promise<ComputerUseDiagnostic[]> {
  const diagnostics: ComputerUseDiagnostic[] = [];
  await recordRestoreFailure(diagnostics, 'current_vscode_restore_captured_failed', refs, () =>
    hooks.restoreCapturedState?.(state, refs)
  );
  await recordRestoreFailure(diagnostics, 'current_vscode_restore_focus_failed', refs, () =>
    hooks.restoreFocus?.(refs.frontAppRestoreRef)
  );
  await recordRestoreFailure(diagnostics, 'current_vscode_restore_mouse_failed', refs, () =>
    hooks.restoreMouse?.(refs.mousePositionRestoreRef)
  );
  return diagnostics;
}

async function recordRestoreFailure(
  diagnostics: ComputerUseDiagnostic[],
  code: string,
  refs: CurrentVSCodeCoWorkRestorationRefs,
  restore: () => Promise<void> | void | undefined,
): Promise<void> {
  try {
    await restore();
  } catch (error) {
    diagnostics.push({
      code,
      message: safeBlockedReason(error),
      severity: 'warning',
      refs: [refs.frontAppRestoreRef, refs.mousePositionRestoreRef],
      retryable: true,
    });
  }
}

async function captureCurrentRestorationState(): Promise<CurrentVSCodeCoWorkRestorationState> {
  const [frontApplicationName, mousePosition] = await Promise.all([
    readFrontApplicationName().catch(() => undefined),
    readMousePointer().catch(() => undefined),
  ]);
  return {
    frontApplicationName,
    mousePosition,
  };
}

async function restoreCurrentRestorationState(
  state: CurrentVSCodeCoWorkRestorationState,
): Promise<void> {
  await restoreFrontApplication(state.frontApplicationName);
  await restoreMousePointer(state.mousePosition);
}

async function performDefaultCurrentVSCodeAction(
  input: CurrentVSCodeCoWorkLiveActionExecution,
  options: Pick<CurrentVSCodeCoWorkLivePrimitivePortsOptions, 'resolveTextRef' | 'typeResolvedText' | 'pressKeyInCurrentVSCode'>,
): Promise<void> {
  if (input.action.type === 'key') {
    const key = input.action.key;
    if (key !== 'Command+1' && key !== 'Control+Backquote' && key !== 'Enter' && key !== 'Meta+Shift+P' && key !== 'Escape') {
      throw new Error('current-vscode-act-key-unsupported');
    }
    if ((key === 'Control+Backquote' || key === 'Enter') && !hasTerminalContext(input.contextRefs)) {
      throw new Error('current-vscode-act-terminal-ref-required');
    }
    if (key === 'Enter' && !hasTerminalInputContext(input.contextRefs)) {
      throw new Error('current-vscode-act-terminal-input-ref-required');
    }
    const pressKey = options.pressKeyInCurrentVSCode ?? pressKeyIntoCurrentVSCode;
    await pressKey({
      ...input,
      key,
    });
    return;
  }
  if (input.action.type !== 'type') throw new Error('current-vscode-act-unsupported-action');
  const hasEditorContext = input.focusedEditorRef?.startsWith('focused-editor:') === true;
  const hasTerminalTargetContext = hasTerminalContext(input.contextRefs) && hasTerminalInputContext(input.contextRefs);
  const hasPaletteTargetContext = hasCommandPaletteContext(input.contextRefs) && hasCommandPaletteInputContext(input.contextRefs);
  if (!hasEditorContext && !hasTerminalTargetContext && !hasPaletteTargetContext) {
    throw new Error('current-vscode-act-focused-editor-ref-required');
  }
  const textRef = input.action.textRef;
  if (!textRef?.startsWith('text-ref:')) throw new Error('current-vscode-act-text-ref-required');
  const text = await options.resolveTextRef?.(textRef);
  if (typeof text !== 'string') throw new Error('current-vscode-act-text-ref-unresolved');
  if (text.length === 0) throw new Error('current-vscode-act-text-ref-empty');
  if (text.length > 8000) throw new Error('current-vscode-act-text-ref-too-large');
  const typeResolvedText = options.typeResolvedText ?? typeResolvedTextIntoCurrentVSCode;
  await typeResolvedText({
    ...input,
    textRef,
    text,
  });
}

async function pressKeyIntoCurrentVSCode(input: CurrentVSCodeCoWorkLiveKeyExecution): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', `
on run argv
  set keyName to item 1 of argv
  tell application "System Events"
    set vscodeProcesses to application processes whose bundle identifier is "com.microsoft.VSCode"
    if (count of vscodeProcesses) is 0 then error "current-vscode-process-missing"
    repeat with vscodeProcess in vscodeProcesses
      if frontmost of vscodeProcess is true then
        if keyName is "Command+1" then
          keystroke "1" using command down
          return "pressed"
        end if
        if keyName is "Meta+Shift+P" then
          keystroke "p" using {command down, shift down}
          return "pressed"
        end if
        if keyName is "Control+Backquote" then
          keystroke "\`" using control down
          return "pressed"
        end if
        if keyName is "Enter" then
          key code 36
          return "pressed"
        end if
        if keyName is "Escape" then
          key code 53
          return "pressed"
        end if
        error "current-vscode-key-unsupported"
      end if
    end repeat
  end tell
  error "current-vscode-not-frontmost"
end run
`, input.key], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error('current-vscode-key-action-failed');
  }
}

async function typeResolvedTextIntoCurrentVSCode(input: CurrentVSCodeCoWorkLiveResolvedTextExecution): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', `
on run argv
  set textToType to item 1 of argv
  tell application "System Events"
    set vscodeProcesses to application processes whose bundle identifier is "com.microsoft.VSCode"
    if (count of vscodeProcesses) is 0 then error "current-vscode-process-missing"
    repeat with vscodeProcess in vscodeProcesses
      if frontmost of vscodeProcess is true then
        keystroke textToType
        return "typed"
      end if
    end repeat
  end tell
  error "current-vscode-not-frontmost"
end run
`, input.text], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error('current-vscode-type-action-failed');
  }
}

async function readCurrentVSCodeWindowRefs(input: {
  activateIfNotFrontmost?: boolean;
} = {}): Promise<CurrentVSCodeCoWorkWindowObservation> {
  const { stdout } = await execFileAsync('osascript', ['-e', `
on singleLine(valueText)
  set previousDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to linefeed
  set lineParts to text items of (valueText as text)
  set AppleScript's text item delimiters to " "
  set lineText to lineParts as text
  set AppleScript's text item delimiters to return
  set returnParts to text items of lineText
  set AppleScript's text item delimiters to " "
  set returnText to returnParts as text
  set AppleScript's text item delimiters to previousDelimiters
  return returnText
end singleLine

on run argv
  set shouldActivate to false
  if (count of argv) > 0 and item 1 of argv is "1" then set shouldActivate to true

  tell application "System Events"
    set vscodeProcesses to (application processes whose bundle identifier is "com.microsoft.VSCode")
    set vscodeProcessCount to count of vscodeProcesses
    if vscodeProcessCount is 0 then error "current-vscode-process-missing"

    set targetProcess to missing value
    repeat with vscodeProcess in vscodeProcesses
      if frontmost of vscodeProcess is true then
        set targetProcess to vscodeProcess
        exit repeat
      end if
    end repeat

    if targetProcess is missing value then
      if shouldActivate is false then error "current-vscode-not-frontmost"
      if vscodeProcessCount is not 1 then error "current-vscode-process-ambiguous"
      set candidateProcess to item 1 of vscodeProcesses
      if (count of windows of candidateProcess) is not 1 then error "current-vscode-window-ambiguous"
      set frontmost of candidateProcess to true
      delay 0.2
      set targetProcess to candidateProcess
    end if

    if (count of windows of targetProcess) is 0 then error "current-vscode-window-missing"
    set targetWindow to front window of targetProcess
    set windowTitle to name of targetWindow as text
    set collectedText to windowTitle
    set focusedRole to ""
    set focusedName to ""
    set focusedValue to ""
    set focusedDescription to ""
    set focusedContext to ""
    try
      set focusedElement to value of attribute "AXFocusedUIElement" of targetProcess
      try
        set focusedRole to my singleLine(role of focusedElement as text)
      end try
      try
        set focusedName to my singleLine(name of focusedElement as text)
        if focusedName is not "" then set collectedText to collectedText & linefeed & focusedName
      end try
      try
        set focusedValue to my singleLine(value of focusedElement as text)
        if focusedValue is not "" then set collectedText to collectedText & linefeed & focusedValue
      end try
      try
        set focusedDescription to my singleLine(description of focusedElement as text)
        if focusedDescription is not "" then set collectedText to collectedText & linefeed & focusedDescription
      end try
      set currentElement to focusedElement
      repeat with ancestorIndex from 1 to 6
        try
          set currentElement to value of attribute "AXParent" of currentElement
          set ancestorRole to ""
          set ancestorName to ""
          set ancestorDescription to ""
          try
            set ancestorRole to my singleLine(role of currentElement as text)
          end try
          try
            set ancestorName to my singleLine(name of currentElement as text)
          end try
          try
            set ancestorDescription to my singleLine(description of currentElement as text)
          end try
          set focusedContext to focusedContext & " | " & ancestorRole & " " & ancestorName & " " & ancestorDescription
        on error
          exit repeat
        end try
      end repeat
    end try
    return (unix id of targetProcess as text) & linefeed & windowTitle & linefeed & focusedRole & linefeed & focusedName & linefeed & focusedValue & linefeed & focusedDescription & linefeed & focusedContext & linefeed & collectedText
  end tell
end run
`, input.activateIfNotFrontmost ? '1' : '0'], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const [
    pid = 'unknown',
    title = 'untitled',
    focusedRole = '',
    focusedName = '',
    focusedValue = '',
    focusedDescription = '',
    focusedContext = '',
    ...textParts
  ] = stdout.trim().replace(/\r/g, '\n').split('\n');
  return currentVSCodeCoWorkWindowObservationFromSnapshot({
    pid,
    windowTitle: title,
    focusedRole,
    focusedName,
    focusedValue,
    focusedDescription,
    focusedContext,
    collectedText: textParts.join('\n'),
  });
}

export function currentVSCodeCoWorkWindowObservationFromSnapshot(
  input: CurrentVSCodeCoWorkWindowSnapshot,
): CurrentVSCodeCoWorkWindowObservation {
  const observedAtMs = input.observedAtMs ?? Date.now();
  const titleToken = tokenHash(input.windowTitle);
  const textToken = tokenHash(input.collectedText);
  const focusedEditorRef = focusedEditorRefFromSnapshot(input, titleToken);
  const terminalRefs = terminalRefsFromSnapshot(input, titleToken, textToken);
  return {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: `process:vscode:${safeRunId(input.pid)}`,
    windowRef: `window:vscode:${titleToken}`,
    titleRef: `text:title:${titleToken}`,
    frontmostRef: `frontmost:vscode:${titleToken}`,
    fileRefs: [`file-ref:vscode:current:${titleToken}`],
    editorElementRef: `element:vscode:editor:${titleToken}`,
    ...(focusedEditorRef ? { focusedEditorRef } : {}),
    ...terminalRefs,
    visibleTextRef: `text:vscode:visible:${textToken}`,
    visibleTextSha256Ref: `text:vscode:visible-sha256:${textToken}`,
    screenshotRef: `image:vscode:current:${titleToken}`,
    accessibilityRef: `accessibility:vscode:current:${titleToken}`,
    freshnessRef: `freshness:vscode:current:${observedAtMs}`,
    observationRef: `observation:vscode:current:${titleToken}:${observedAtMs}`,
  };
}

async function readFrontApplicationName(): Promise<string> {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function restoreFrontApplication(appName: string | undefined): Promise<void> {
  if (!appName) return;
  await execFileAsync('osascript', ['-e', `
on run argv
  set appName to item 1 of argv
  tell application "System Events"
    if exists process appName then set frontmost of process appName to true
  end tell
end run
`, appName], { timeout: 10_000, maxBuffer: 1024 * 1024 }).catch(() => undefined);
}

async function readMousePointer(): Promise<{ x: number; y: number }> {
  const stdout = await runTransientSwift('computer-use-current-vscode-pointer-read.swift', `
import CoreGraphics

guard let event = CGEvent(source: nil) else {
  exit(2)
}
let point = event.location
print("\\(point.x),\\(point.y)")
`, []);
  const [x, y] = stdout.trim().split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('mouse-pointer-unavailable');
  return { x, y };
}

async function restoreMousePointer(point: { x: number; y: number } | undefined): Promise<void> {
  if (!point) return;
  await runTransientSwift('computer-use-current-vscode-pointer-restore.swift', `
import CoreGraphics

let args = CommandLine.arguments
guard args.count == 3,
      let x = Double(args[1]),
      let y = Double(args[2]) else {
  exit(2)
}
let point = CGPoint(x: x, y: y)
guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
  exit(3)
}
event.post(tap: .cghidEventTap)
`, [String(point.x), String(point.y)]).catch(() => undefined);
}

async function runTransientSwift(filename: string, source: string, args: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-cu-current-vscode-swift-'));
  const sourcePath = join(dir, filename);
  await writeFile(sourcePath, source, 'utf8');
  try {
    const { stdout } = await execFileAsync('/usr/bin/swift', [sourcePath, ...args], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function observationRefs(observed: CurrentVSCodeCoWorkWindowObservation): string[] {
  return uniqueRefs([
    observed.appRef,
    observed.processRef,
    observed.windowRef,
    observed.titleRef,
    observed.frontmostRef,
    ...observed.fileRefs,
    observed.editorElementRef,
    observed.focusedEditorRef,
    observed.selectionRef,
    observed.cursorRef,
    observed.rangeRef,
    observed.terminalElementRef,
    observed.terminalSessionRef,
    observed.terminalInputRef,
    observed.terminalOutputRef,
    observed.terminalOutputHashRef,
    observed.commandPaletteRootRef,
    observed.commandPaletteInputRef,
    observed.commandPaletteItemsRef,
    ...(observed.commandPaletteItemRefs ?? []),
    ...(observed.commandPaletteItemRankRefs ?? []),
    ...(observed.commandPaletteItemHashRefs ?? []),
    observed.visibleTextRef,
    observed.visibleTextSha256Ref,
    observed.screenshotRef,
    observed.accessibilityRef,
    observed.freshnessRef,
    observed.observationRef,
  ]);
}

function safeCurrentVSCodeContextRefs(refs: string[] | undefined): string[] {
  return uniqueRefs((refs ?? []).filter(isSafeCurrentVSCodeContextRef));
}

function isSafeCurrentVSCodeContextRef(ref: string): boolean {
  if (ref !== ref.trim() || ref.length > 512) return false;
  if (!/^[A-Za-z][A-Za-z0-9._-]*:[^\s]+$/u.test(ref)) return false;
  return [
    'accessibility:',
    'action:',
    'computer-use-session:',
    'cursor-marker:',
    'decision:',
    'element:',
    'executor-event:',
    'file-ref:',
    'focused-editor:',
    'freshness:',
    'frontmost:',
    'image:',
    'input-event:',
    'macos-app:',
    'observation:',
    'process:',
    'command-palette:',
    'command-palette-input:',
    'command-palette-items:',
    'command-palette-item:',
    'command-palette-item-rank:',
    'command-palette-item-hash:',
    'scoped-input-adapter:',
    'scoped-input-lease:',
    'stale-invalidation:',
    'text:',
    'terminal:',
    'terminal-session:',
    'terminal-input:',
    'terminal-output:',
    'terminal-output-hash:',
    'verifier:',
    'window:',
    'window-action-session:',
  ].some((prefix) => ref.startsWith(prefix));
}

function hasTerminalContext(refs: string[] | undefined): boolean {
  return safeCurrentVSCodeContextRefs(refs).some((ref) =>
    ref.startsWith('terminal:vscode:') || ref.startsWith('element:vscode:terminal:')
  );
}

function hasTerminalInputContext(refs: string[] | undefined): boolean {
  return safeCurrentVSCodeContextRefs(refs).some((ref) => ref.startsWith('terminal-input:vscode:'));
}

function hasCommandPaletteContext(refs: string[] | undefined): boolean {
  return safeCurrentVSCodeContextRefs(refs).some((ref) => ref.startsWith('command-palette:vscode:'));
}

function hasCommandPaletteInputContext(refs: string[] | undefined): boolean {
  return safeCurrentVSCodeContextRefs(refs).some((ref) => ref.startsWith('command-palette-input:vscode:'));
}

function focusedEditorRefFromSnapshot(
  input: CurrentVSCodeCoWorkWindowSnapshot,
  titleToken: string,
): string | undefined {
  if (!hasFocusedEditorEvidence(input)) return undefined;
  return `focused-editor:vscode:current:${titleToken}`;
}

function terminalRefsFromSnapshot(
  input: CurrentVSCodeCoWorkWindowSnapshot,
  titleToken: string,
  textToken: string,
): Pick<
  CurrentVSCodeCoWorkWindowObservation,
  'terminalElementRef' | 'terminalSessionRef' | 'terminalInputRef' | 'terminalOutputRef' | 'terminalOutputHashRef'
> {
  if (!hasTerminalEvidence(input)) return {};
  const terminalToken = `${titleToken}:integrated-1`;
  return {
    terminalElementRef: `terminal:vscode:${terminalToken}`,
    terminalSessionRef: `terminal-session:vscode:${terminalToken}:current`,
    terminalInputRef: `terminal-input:vscode:${terminalToken}:current`,
    terminalOutputRef: `terminal-output:vscode:${terminalToken}:current`,
    terminalOutputHashRef: `terminal-output-hash:vscode:${terminalToken}:sha256:${textToken}`,
  };
}

function hasTerminalEvidence(input: CurrentVSCodeCoWorkWindowSnapshot): boolean {
  const focusFields = [
    input.focusedRole,
    input.focusedName,
    input.focusedValue,
    input.focusedDescription,
    input.focusedContext,
    input.collectedText,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (focusFields.length === 0) return false;
  return /(?:^|\b)(?:terminal|integrated terminal|zsh|bash|fish|shell)(?:\b|$)/i.test(focusFields.join('\n'));
}

function hasFocusedEditorEvidence(input: CurrentVSCodeCoWorkWindowSnapshot): boolean {
  const focusFields = [
    input.focusedRole,
    input.focusedName,
    input.focusedValue,
    input.focusedDescription,
    input.focusedContext,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (focusFields.length === 0) return false;
  if (hasBlockedVSCodeFocusTarget(focusFields)) return false;
  if (/AXTextArea/i.test(input.focusedRole ?? '')) return true;
  return hasMonacoEditorFocusEvidence(focusFields);
}

function hasMonacoEditorFocusEvidence(focusFields: string[]): boolean {
  const focusText = focusFields.join('\n');
  return /(?:monaco|code editor|text editor|editor group|editor part|editor pane|workbench\.parts\.editor|inputarea|view-lines|source code)/i.test(focusText);
}

function hasBlockedVSCodeFocusTarget(focusFields: string[]): boolean {
  const normalizedFields = focusFields.map((field) => field.trim().toLowerCase()).filter(Boolean);
  const exactBlockedTargets = new Set([
    'chat',
    'command palette',
    'debug console',
    'explorer',
    'extensions',
    'notifications',
    'output',
    'problems',
    'quick open',
    'search',
    'settings',
    'source control',
    'terminal',
  ]);
  if (normalizedFields.some((field) => exactBlockedTargets.has(field))) return true;
  return normalizedFields.some((field) => (
    /(?:integrated terminal|terminal panel|terminal view|debug console|command palette|quick open|source control|search view|extensions view)/i.test(field)
  ));
}

function uniqueRefs(refs: Array<string | undefined>): string[] {
  return Array.from(new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)));
}

function safeRunId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'current';
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function safeBlockedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gu, '[url]')
    .replace(/\/(?:Users|Applications|private|tmp|var)\/\S+/gu, '[path]')
    .replace(/[^A-Za-z0-9:_ .-]+/gu, '-')
    .slice(0, 180) || 'current-vscode-bind-blocked';
}
