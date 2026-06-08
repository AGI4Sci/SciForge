import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  ComputerUseDiagnostic,
  ComputerUseObserveInput,
  ComputerUsePrimitivePorts,
} from './index.js';

const execFileAsync = promisify(execFile);

export const VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV = 'SCIFORGE_COMPUTER_USE_VSCODE_COWORK_LIVE_DIAGNOSTIC' as const;
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
  visibleTextRef: string;
  visibleTextSha256Ref?: string;
  screenshotRef?: string;
  accessibilityRef: string;
  freshnessRef: string;
  observationRef: string;
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

export interface CurrentVSCodeCoWorkLivePrimitivePortsOptions {
  runId?: string;
  readCurrentWindow?: () => Promise<CurrentVSCodeCoWorkWindowObservation>;
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
  const readCurrentWindow = options.readCurrentWindow ?? readCurrentVSCodeWindowRefs;
  const shouldUseDesktopRestoration = !options.readCurrentWindow;
  const captureRestorationState = options.captureRestorationState
    ?? (shouldUseDesktopRestoration ? captureCurrentRestorationState : undefined);
  const restoreCapturedState = options.restoreCapturedState
    ?? (shouldUseDesktopRestoration ? restoreCurrentRestorationState : undefined);
  let restorationState: CurrentVSCodeCoWorkRestorationState = {};

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
      const observed = await readCurrentWindow();
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          observationRef: observed.observationRef,
          screenshotRef: observed.screenshotRef,
          accessibilityRef: observed.accessibilityRef,
          elementRefs: [observed.editorElementRef],
          textRefs: uniqueRefs([observed.visibleTextRef, observed.visibleTextSha256Ref]),
          staleInvalidationRefs: [],
        },
        refs: uniqueRefs([
          computerUseSessionRef,
          windowActionSessionRef,
          ...observationRefs(observed),
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

async function readCurrentVSCodeWindowRefs(): Promise<CurrentVSCodeCoWorkWindowObservation> {
  const { stdout } = await execFileAsync('osascript', ['-e', `
tell application "System Events"
  set vscodeProcesses to application processes whose bundle identifier is "com.microsoft.VSCode"
  if (count of vscodeProcesses) is 0 then error "current-vscode-process-missing"
  repeat with vscodeProcess in vscodeProcesses
    if frontmost of vscodeProcess is true then
      if (count of windows of vscodeProcess) is 0 then error "current-vscode-window-missing"
      set targetWindow to front window of vscodeProcess
      set windowTitle to name of targetWindow as text
      set collectedText to windowTitle
      try
        set focusedElement to value of attribute "AXFocusedUIElement" of vscodeProcess
        try
          set focusedName to name of focusedElement as text
          if focusedName is not "" then set collectedText to collectedText & linefeed & focusedName
        end try
        try
          set focusedValue to value of focusedElement as text
          if focusedValue is not "" then set collectedText to collectedText & linefeed & focusedValue
        end try
      end try
      return (unix id of vscodeProcess as text) & linefeed & windowTitle & linefeed & collectedText
    end if
  end repeat
end tell
error "current-vscode-not-frontmost"
`], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const [pid = 'unknown', title = 'untitled', ...textParts] = stdout.trim().replace(/\r/g, '\n').split('\n');
  const titleToken = tokenHash(title);
  const textToken = tokenHash(textParts.join('\n'));
  return {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: `process:vscode:${safeRunId(pid)}`,
    windowRef: `window:vscode:${titleToken}`,
    titleRef: `text:title:${titleToken}`,
    frontmostRef: `frontmost:vscode:${titleToken}`,
    fileRefs: [],
    editorElementRef: `element:vscode:editor:${titleToken}`,
    visibleTextRef: `text:vscode:visible:${textToken}`,
    visibleTextSha256Ref: `text:vscode:visible-sha256:${textToken}`,
    screenshotRef: `image:vscode:current:${titleToken}`,
    accessibilityRef: `accessibility:vscode:current:${titleToken}`,
    freshnessRef: `freshness:vscode:current:${Date.now()}`,
    observationRef: `observation:vscode:current:${titleToken}:${Date.now()}`,
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
    observed.visibleTextRef,
    observed.visibleTextSha256Ref,
    observed.screenshotRef,
    observed.accessibilityRef,
    observed.freshnessRef,
    observed.observationRef,
  ]);
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
