export type ComputerUseIndependentInputAdapter = 'virtual-hid' | 'remote-desktop' | 'browser-sandbox' | 'accessibility-per-window';
export type ComputerUseCaptureKind = 'display' | 'window';
export type ComputerUseCoordinateSpace = 'screen' | 'window' | 'window-local';
export type ComputerUseInputIsolation = 'best-effort' | 'require-focused-target';
export type ComputerUseWindowTargetMode = 'display' | 'active-window' | 'window-id' | 'app-window';
export type ComputerUsePlannerContractIssue = 'coordinate-output' | 'platform-incompatible-action' | 'unsupported-action' | 'empty-message-content';

export const computerUseInputPolicyIds = {
  actionType: 'generic-mouse-keyboard',
  dryRunExecutor: 'dry-run-generic-gui-executor',
  dryRunBoundary: 'dry-run',
  dryRunInputChannel: 'dry-run-input-channel',
  darwinExecutorBoundary: 'darwin-system-events-generic-gui-executor',
  darwinInputProvider: 'macos-cgevent-system-events',
  unresolvedWindowLockId: 'unresolved-window-target',
  sharedSystemInputLockId: 'shared-system-input',
  visualPointerShape: 'cyan-diamond-magenta-outline-white-crosshair',
} as const;

export const computerUseIndependentInputAdapters = [
  'browser-sandbox-adapter',
  'remote-desktop-session',
  'virtual-hid-device',
  'accessibility-per-window-adapter',
] as const;

export function computerUseExecutorBoundary(desktopPlatform: string) {
  if (isComputerUseDarwinPlatform(desktopPlatform)) return computerUseInputPolicyIds.darwinExecutorBoundary;
  return `${sanitizeComputerUsePolicyId(desktopPlatform).toLowerCase()}-generic-gui-executor`;
}

export function computerUseInputExecutor(options: { desktopPlatform: string; dryRun?: boolean }) {
  return options.dryRun ? computerUseInputPolicyIds.dryRunExecutor : computerUseExecutorBoundary(options.desktopPlatform);
}

export function computerUseInputProvider(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  independentAdapter?: ComputerUseIndependentInputAdapter;
  independentAdapterReady?: boolean;
}) {
  if (options.dryRun) return computerUseInputPolicyIds.dryRunInputChannel;
  if (options.independentAdapter && options.independentAdapterReady) return `${options.independentAdapter}-input-adapter`;
  if (options.independentAdapter) return `${options.independentAdapter}-input-adapter-unimplemented`;
  if (isComputerUseDarwinPlatform(options.desktopPlatform)) return computerUseInputPolicyIds.darwinInputProvider;
  return `${options.desktopPlatform}-input-provider-unavailable`;
}

export function computerUseRealInputBlockReason(options: {
  actionType: string;
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  allowSharedSystemInput?: boolean;
}) {
  if (options.dryRun || !computerUseActionRequiresPointerKeyboardInput(options.actionType)) return '';
  const independentAdapter = normalizeComputerUseIndependentInputAdapter(options.inputAdapter);
  if (independentAdapter) {
    return [
      `Independent input adapter "${independentAdapter}" is configured, but no executable adapter provider is registered in this runtime.`,
      'Failing closed before sending macOS CGEvent/System Events input so SciForge does not move the user pointer or type on the user keyboard while claiming independent input.',
    ].join(' ');
  }
  if (!options.allowSharedSystemInput) {
    return [
      'Real Computer Use action blocked before execution because no independent input adapter is available and shared system mouse/keyboard input was not explicitly allowed.',
      'Configure a real independent input adapter provider, or set SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT=1 only for an acknowledged focused-window smoke.',
    ].join(' ');
  }
  return '';
}

export function computerUseActionRequiresPointerKeyboardInput(actionType: string) {
  return actionType !== 'wait' && actionType !== 'open_app';
}

export function computerUseUsesSharedSystemInput(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  allowSharedSystemInput?: boolean;
}) {
  return !options.dryRun
    && isComputerUseDarwinPlatform(options.desktopPlatform)
    && !normalizeComputerUseIndependentInputAdapter(options.inputAdapter)
    && Boolean(options.allowSharedSystemInput);
}

export function computerUseInputChannelContract(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  allowSharedSystemInput?: boolean;
  showVisualCursor?: boolean;
  targetResolved: boolean;
  targetBound: boolean;
  isolation: ComputerUseInputIsolation;
  executorLockId: string;
}) {
  const dryRun = Boolean(options.dryRun);
  const configuredIndependentAdapter = normalizeComputerUseIndependentInputAdapter(options.inputAdapter);
  const independentAdapterReady = false;
  const independentInput = !dryRun && Boolean(configuredIndependentAdapter) && independentAdapterReady;
  const sharedSystemAllowed = Boolean(options.allowSharedSystemInput);
  const sharedSystemInput = computerUseUsesSharedSystemInput(options);
  const strictTarget = options.targetBound && options.isolation === 'require-focused-target';
  const provider = computerUseInputProvider({
    desktopPlatform: options.desktopPlatform,
    dryRun,
    independentAdapter: configuredIndependentAdapter,
    independentAdapterReady,
  });
  const userDeviceImpact = dryRun || independentInput
    ? 'none'
    : configuredIndependentAdapter
      ? 'fail-closed-unimplemented-independent-adapter'
      : strictTarget
        ? 'may-use-system-input-after-focused-target-verification'
        : 'may-affect-frontmost-window';
  return {
    type: computerUseInputPolicyIds.actionType,
    executor: computerUseInputExecutor({ desktopPlatform: options.desktopPlatform, dryRun }),
    executorBoundary: dryRun ? computerUseInputPolicyIds.dryRunBoundary : computerUseExecutorBoundary(options.desktopPlatform),
    provider,
    isolation: options.isolation,
    targetBound: options.targetBound,
    pointerKeyboardOwnership: dryRun ? 'virtual-dry-run-channel' : independentInput ? 'sciforge-independent-input-adapter' : sharedSystemInput ? 'shared-system-pointer-keyboard' : 'unavailable',
    pointerMode: dryRun ? 'virtual-no-user-pointer-movement' : independentInput ? 'adapter-window-bound-pointer' : sharedSystemInput ? 'system-cursor-events' : 'none',
    keyboardMode: dryRun ? 'virtual-no-user-keyboard-events' : independentInput ? 'adapter-window-bound-keyboard' : sharedSystemInput ? 'system-key-events' : 'none',
    visualPointer: dryRun ? 'virtual-trace-only' : options.showVisualCursor ? 'sciforge-distinct-overlay-cursor' : 'off',
    visualPointerShape: options.showVisualCursor ? computerUseInputPolicyIds.visualPointerShape : undefined,
    executorLockScope: sharedSystemInput ? 'global-shared-system-input' : options.targetBound ? 'target-window' : 'display-fallback',
    executorLockId: options.executorLockId,
    userDeviceImpact,
    independentAdapterRequiredForNoUserImpact: !dryRun && !independentInput,
    availableIndependentAdapters: [...computerUseIndependentInputAdapters],
    currentIndependentAdapter: dryRun ? 'dry-run' : configuredIndependentAdapter ?? 'not-configured',
    independentAdapterStatus: dryRun ? 'dry-run' : configuredIndependentAdapter ? 'configured-unimplemented' : 'not-configured',
    sharedSystemInputExplicitlyAllowed: !dryRun && !independentInput ? sharedSystemAllowed : undefined,
    failClosed: !options.targetResolved
      || (options.isolation === 'require-focused-target' && !options.targetBound)
      || (!dryRun && Boolean(configuredIndependentAdapter) && !independentAdapterReady)
      || (!dryRun && !configuredIndependentAdapter && !sharedSystemAllowed),
    highRiskConfirmationRequired: true,
    policy: [
      'Planner and Grounder may run in parallel from screenshots.',
      'Real GUI input must acquire the scheduler lock first.',
      'If an independent adapter is unavailable, strict target focus and explicit shared-system-input acknowledgement are required before shared system input.',
      'High-risk send/delete/pay/authorize/publish/submit actions require upstream confirmation before executor.',
    ],
  };
}

export function computerUseInputChannelDescription(options: {
  contract: Record<string, unknown>;
  targetResolved: boolean;
  captureKind?: ComputerUseCaptureKind;
  coordinateSpace?: ComputerUseCoordinateSpace;
  inputIsolation: ComputerUseInputIsolation;
}) {
  const executor = String(options.contract.executorBoundary ?? options.contract.executor ?? 'unknown-executor');
  if (!options.targetResolved) return `${computerUseInputPolicyIds.actionType}:${executor}:blocked-unresolved-window-target`;
  return [
    String(options.contract.type ?? computerUseInputPolicyIds.actionType),
    executor,
    options.captureKind === 'window' ? 'target-window' : 'display',
    isComputerUseWindowLocalCoordinateSpace(options.coordinateSpace) ? 'window-relative-grounding' : 'screen-relative-grounding',
    options.inputIsolation,
  ].join(':');
}

export function computerUseSchedulerStepMetadata(options: {
  targetResolved: boolean;
  stepId: string;
  lockId: string;
  lockScope: 'shared-system-input' | 'target-window' | 'display-fallback';
  captureKind?: ComputerUseCaptureKind;
  inputIsolation?: ComputerUseInputIsolation;
  focused?: boolean;
  minimized?: boolean;
  occluded?: boolean;
  captureTimestamp?: string;
  sharedSystemInput?: boolean;
  targetBound?: boolean;
  strictFocus?: boolean;
  reason?: string;
  diagnostics?: string[];
}) {
  if (!options.targetResolved) {
    return {
      mode: 'blocked',
      stepId: options.stepId,
      lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
      lockScope: 'none',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      reason: options.reason,
      diagnostics: options.diagnostics ?? [],
    };
  }
  return {
    mode: 'serialized-window-actions',
    stepId: options.stepId,
    lockId: options.lockId,
    lockScope: options.lockScope,
    actionConcurrency: computerUseActionConcurrency(options),
    analysisConcurrency: 'planner-grounder-verifier-may-run-in-parallel-before-executor-lock',
    captureKind: options.captureKind,
    inputIsolation: options.inputIsolation,
    focusPolicy: options.strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: Boolean(options.strictFocus),
    interferenceRisk: computerUseInterferenceRisk(options),
    windowLifecycle: {
      focused: options.focused,
      minimized: options.minimized,
      occluded: options.occluded,
      captureTimestamp: options.captureTimestamp,
    },
  };
}

export function computerUseSchedulerRunMetadata(options: {
  targetResolved: boolean;
  lockId: string;
  lockScope: 'shared-system-input' | 'target-window' | 'display-fallback';
  sharedSystemInput?: boolean;
  targetBound?: boolean;
  strictFocus?: boolean;
  diagnostics?: string[];
}) {
  if (!options.targetResolved) {
    return {
      mode: 'blocked',
      lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
      lockScope: 'none',
      policy: 'do not execute real GUI actions until WindowTarget resolves to an isolated target or explicit display fallback',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      diagnostics: options.diagnostics ?? [],
    };
  }
  return {
    mode: 'serialized-window-actions',
    lockId: options.lockId,
    lockScope: options.lockScope,
    policy: options.sharedSystemInput
      ? 'one real GUI action stream globally while using shared system mouse/keyboard; planner/grounder/verifier analysis may run in parallel before the executor lock'
      : 'one real GUI action stream per target window; planner/grounder/verifier analysis may run in parallel before the executor lock',
    actionConcurrency: computerUseActionConcurrency(options),
    analysisConcurrency: 'parallel-allowed',
    focusPolicy: options.strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: Boolean(options.strictFocus),
    interferenceRisk: computerUseInterferenceRisk(options),
  };
}

export function normalizeComputerUseIndependentInputAdapter(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'virtual-hid' || normalized === 'virtual-hid-device') return 'virtual-hid';
  if (normalized === 'remote-desktop' || normalized === 'remote-desktop-session') return 'remote-desktop';
  if (normalized === 'browser-sandbox' || normalized === 'browser-sandbox-adapter') return 'browser-sandbox';
  if (normalized === 'accessibility-per-window' || normalized === 'accessibility-per-window-adapter') return 'accessibility-per-window';
  return undefined;
}

export function normalizeComputerUseWindowTargetMode(value: string | undefined, target: { windowId?: number; appName?: string; title?: string }): ComputerUseWindowTargetMode {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'display' || normalized === 'screen') return 'display';
  if (normalized === 'active' || normalized === 'active_window' || normalized === 'frontmost') return 'active-window';
  if (normalized === 'window' || normalized === 'window_id' || normalized === 'id') return 'window-id';
  if (normalized === 'app' || normalized === 'app_window' || normalized === 'application') return 'app-window';
  if (target.windowId !== undefined) return 'window-id';
  if (target.appName || target.title) return 'app-window';
  return 'display';
}

export function normalizeComputerUseCoordinateSpace(value: string | undefined, mode: ComputerUseWindowTargetMode): ComputerUseCoordinateSpace {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'screen' || normalized === 'global') return 'screen';
  if (normalized === 'window-local' || normalized === 'window_local' || normalized === 'local') return 'window-local';
  if (normalized === 'window' || normalized === 'target-window' || normalized === 'target') return 'window';
  return mode === 'display' ? 'screen' : 'window';
}

export function normalizeComputerUseInputIsolation(value: string | undefined, required: boolean): ComputerUseInputIsolation {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'require_focused_target' || normalized === 'strict' || normalized === 'required') return 'require-focused-target';
  if (normalized === 'best_effort' || normalized === 'off' || normalized === 'none') return 'best-effort';
  return required ? 'require-focused-target' : 'best-effort';
}

export function isComputerUseWindowLocalCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
}

export function computerUseSchedulerLockIdForTarget(target: { mode: string; appName?: string; title?: string }, resolvedId: string | number) {
  return sanitizeComputerUsePolicyId([
    'vision-window',
    target.mode,
    resolvedId,
    target.appName,
    target.title,
  ].filter((part) => part !== undefined && part !== '').join('-')).toLowerCase();
}

export function computerUseSystemEventsResultLine(actionType: string, showVisualCursor?: boolean) {
  return `system-events ${actionType} visualCursor=${showVisualCursor ? 'not-shown-system-events-primary' : 'off'}`;
}

export function isComputerUseDarwinPlatform(value: string | undefined) {
  return /^(darwin|mac|macos|osx)$/i.test((value ?? '').trim());
}

function computerUseActionConcurrency(options: { sharedSystemInput?: boolean; targetBound?: boolean }) {
  return options.sharedSystemInput
    ? 'one-real-gui-action-at-a-time-globally-for-shared-system-input'
    : options.targetBound
      ? 'one-real-gui-action-at-a-time-per-window'
      : 'one-real-gui-action-at-a-time-per-display';
}

function computerUseInterferenceRisk(options: { sharedSystemInput?: boolean; targetBound?: boolean; strictFocus?: boolean }) {
  return options.sharedSystemInput
    ? 'serialized-global-shared-system-input-may-still-affect-user-devices'
    : options.targetBound && options.strictFocus
      ? 'low-when-focused-target-verified'
      : 'elevated-display-or-best-effort-isolation';
}

function sanitizeComputerUsePolicyId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vision-run';
}
