import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComputerUseConfig, ResolvedWindowTarget, TraceWindowTarget, WindowBounds, WindowTarget, WindowTargetResolution } from './types.js';
import { executorBoundary } from './executor.js';
import { computerUseSchedulerLockId } from './scheduler.js';
import { booleanConfig, envOrValue, isDarwinPlatform, numberConfig, parseJson, runCommand, sanitizeId, stringConfig, swiftOptionalString, swiftString } from './utils.js';

export function parseWindowTarget(requestConfig: Record<string, unknown>, fileConfig: Record<string, unknown>): WindowTarget {
  const rawTarget = envOrValue(
    parseJsonEnv(process.env.SCIFORGE_VISION_WINDOW_TARGET_JSON),
    requestConfig.windowTarget,
    requestConfig.targetWindow,
    fileConfig.windowTarget,
    fileConfig.targetWindow,
  );
  const targetConfig = isRecordLike(rawTarget) ? rawTarget : {};
  const windowId = numberConfig(process.env.SCIFORGE_VISION_WINDOW_ID, targetConfig.windowId, targetConfig.window_id);
  const processId = numberConfig(process.env.SCIFORGE_VISION_WINDOW_PROCESS_ID, targetConfig.processId, targetConfig.process_id, targetConfig.pid);
  const bundleId = stringConfig(process.env.SCIFORGE_VISION_WINDOW_BUNDLE_ID, targetConfig.bundleId, targetConfig.bundle_id);
  const appName = stringConfig(process.env.SCIFORGE_VISION_WINDOW_APP_NAME, targetConfig.appName, targetConfig.app_name, targetConfig.application);
  const title = stringConfig(process.env.SCIFORGE_VISION_WINDOW_TITLE, targetConfig.title, targetConfig.windowTitle, targetConfig.window_title);
  const displayId = numberConfig(process.env.SCIFORGE_VISION_WINDOW_DISPLAY_ID, targetConfig.displayId, targetConfig.display_id);
  const bounds = parseWindowBounds(envOrValue(process.env.SCIFORGE_VISION_WINDOW_BOUNDS, targetConfig.bounds, targetConfig.windowBounds, targetConfig.window_bounds));
  const contentRect = parseWindowBounds(envOrValue(process.env.SCIFORGE_VISION_WINDOW_CONTENT_RECT, targetConfig.contentRect, targetConfig.content_rect));
  const devicePixelRatio = numberConfig(process.env.SCIFORGE_VISION_WINDOW_DPR, targetConfig.devicePixelRatio, targetConfig.dpr, targetConfig.scaleFactor);
  const explicitMode = stringConfig(process.env.SCIFORGE_VISION_WINDOW_TARGET_MODE, targetConfig.mode, targetConfig.kind);
  const mode = normalizeWindowTargetMode(explicitMode, { windowId, appName, title });
  const enabled = booleanConfig(
    process.env.SCIFORGE_VISION_WINDOW_TARGET_ENABLED,
    targetConfig.enabled,
    undefined,
    mode !== 'display',
  );
  const required = booleanConfig(
    process.env.SCIFORGE_VISION_REQUIRE_WINDOW_TARGET,
    targetConfig.required,
    targetConfig.requireWindowTarget,
    enabled && mode !== 'display',
  );
  const coordinateSpace = normalizeCoordinateSpace(stringConfig(process.env.SCIFORGE_VISION_COORDINATE_SPACE, targetConfig.coordinateSpace, targetConfig.coordinate_space), mode);
  const inputIsolation = normalizeInputIsolation(stringConfig(process.env.SCIFORGE_VISION_INPUT_ISOLATION, targetConfig.inputIsolation, targetConfig.input_isolation), required);
  return {
    enabled,
    required,
    mode: enabled ? mode : 'display',
    windowId,
    processId,
    bundleId,
    appName,
    title,
    displayId,
    bounds,
    contentRect,
    devicePixelRatio,
    coordinateSpace,
    inputIsolation,
  };
}

export async function resolveWindowTarget(config: ComputerUseConfig): Promise<WindowTargetResolution> {
  const target = config.windowTarget;
  if (!target.enabled || target.mode === 'display') {
    return {
      ok: true,
      target,
      captureKind: 'display',
      coordinateSpace: 'screen',
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, 'display'),
      source: 'display-fallback',
      displayId: target.displayId,
      bounds: target.bounds,
      contentRect: target.contentRect,
      devicePixelRatio: target.devicePixelRatio,
      captureTimestamp: new Date().toISOString(),
      diagnostics: ['window targeting disabled; using configured display capture for compatibility'],
    };
  }
  if (config.dryRun) {
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId: target.windowId,
      processId: target.processId,
      bundleId: target.bundleId,
      appName: target.appName,
      title: target.title,
      displayId: target.displayId,
      bounds: target.bounds,
      contentRect: target.contentRect,
      devicePixelRatio: target.devicePixelRatio,
      focused: target.focused,
      minimized: target.minimized,
      occluded: target.occluded,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId ?? target.mode),
      source: 'dry-run',
      captureTimestamp: new Date().toISOString(),
      diagnostics: ['dry-run window target accepted without probing the desktop'],
    };
  }
  if (!isDarwinPlatform(config.desktopPlatform)) {
    const reason = `WindowTarget mode="${target.mode}" is configured, but no target-window provider is available for desktopPlatform="${config.desktopPlatform}".`;
    return target.required
      ? { ok: false, target, reason, diagnostics: [reason] }
      : {
          ok: true,
          target,
          captureKind: 'display',
          coordinateSpace: 'screen',
          inputIsolation: 'best-effort',
          schedulerLockId: schedulerLockIdForTarget(target, 'display'),
          source: 'display-fallback',
          displayId: target.displayId,
          bounds: target.bounds,
          contentRect: target.contentRect,
          devicePixelRatio: target.devicePixelRatio,
          captureTimestamp: new Date().toISOString(),
          diagnostics: [reason, 'falling back to display capture because windowTarget.required=false'],
        };
  }
  const detected = await detectMacWindowTarget(target);
  if (detected.ok) return detected;
  if (target.required) return detected;
  return {
    ok: true,
    target,
    captureKind: 'display',
    coordinateSpace: 'screen',
    inputIsolation: 'best-effort',
    schedulerLockId: schedulerLockIdForTarget(target, 'display'),
    source: 'display-fallback',
    displayId: target.displayId,
    bounds: target.bounds,
    contentRect: target.contentRect,
    devicePixelRatio: target.devicePixelRatio,
    captureTimestamp: new Date().toISOString(),
    diagnostics: [...detected.diagnostics, 'falling back to display capture because windowTarget.required=false'],
  };
}

export function parseWindowBounds(value: unknown): WindowBounds | undefined {
  if (!isRecordLike(value)) return undefined;
  const x = numberConfig(value.X, value.x);
  const y = numberConfig(value.Y, value.y);
  const width = numberConfig(value.Width, value.width);
  const height = numberConfig(value.Height, value.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

export function windowTargetTraceConfig(target: WindowTarget) {
  return {
    enabled: target.enabled,
    required: target.required,
    mode: target.mode,
    coordinateSpace: target.coordinateSpace,
    inputIsolation: target.inputIsolation,
    windowId: target.windowId,
    processId: target.processId,
    bundleId: target.bundleId,
    appName: target.appName,
    title: target.title,
    displayId: target.displayId,
    bounds: target.bounds,
    contentRect: target.contentRect,
    devicePixelRatio: target.devicePixelRatio,
    focused: target.focused,
    minimized: target.minimized,
    occluded: target.occluded,
  };
}

export function toTraceWindowTarget(targetResolution: ResolvedWindowTarget): TraceWindowTarget {
  return {
    ...windowTargetTraceConfig(targetResolution.target),
    captureKind: targetResolution.captureKind,
    coordinateSpace: targetResolution.coordinateSpace,
    inputIsolation: targetResolution.inputIsolation,
    windowId: targetResolution.windowId,
    processId: targetResolution.processId,
    bundleId: targetResolution.bundleId,
    appName: targetResolution.appName,
    title: targetResolution.title,
    displayId: targetResolution.displayId,
    bounds: targetResolution.bounds,
    contentRect: targetResolution.contentRect,
    devicePixelRatio: targetResolution.devicePixelRatio,
    focused: targetResolution.focused,
    minimized: targetResolution.minimized,
    occluded: targetResolution.occluded,
    captureTimestamp: targetResolution.captureTimestamp,
    schedulerLockId: targetResolution.schedulerLockId,
    source: targetResolution.source,
    diagnostics: targetResolution.diagnostics.length ? targetResolution.diagnostics : undefined,
  };
}

export function inputChannelDescription(config: ComputerUseConfig, targetResolution: WindowTargetResolution) {
  const contract = inputChannelContract(config, targetResolution);
  const executor = contract.executorBoundary;
  if (!targetResolution.ok) return `generic-mouse-keyboard:${executor}:blocked-unresolved-window-target`;
  return [
    contract.type,
    executor,
    targetResolution.captureKind === 'window' ? 'target-window' : 'display',
    isWindowLocalCoordinateSpace(targetResolution.coordinateSpace) ? 'window-relative-grounding' : 'screen-relative-grounding',
    targetResolution.inputIsolation,
  ].join(':');
}

export function schedulerStepMetadata(targetResolution: WindowTargetResolution, stepId: string, config?: ComputerUseConfig): Record<string, unknown> {
  if (!targetResolution.ok) {
    return {
      mode: 'blocked',
      stepId,
      lockId: 'unresolved-window-target',
      lockScope: 'none',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      reason: targetResolution.reason,
      diagnostics: targetResolution.diagnostics,
    };
  }
  const targetBound = targetResolution.captureKind === 'window';
  const strictFocus = targetResolution.inputIsolation === 'require-focused-target';
  const sharedSystemInput = usesSharedSystemInput(config);
  const lockId = computerUseSchedulerLockId(targetResolution, { sharedSystemInput });
  return {
    mode: 'serialized-window-actions',
    stepId,
    lockId,
    lockScope: sharedSystemInput ? 'shared-system-input' : targetBound ? 'target-window' : 'display-fallback',
    actionConcurrency: sharedSystemInput
      ? 'one-real-gui-action-at-a-time-globally-for-shared-system-input'
      : targetBound
        ? 'one-real-gui-action-at-a-time-per-window'
        : 'one-real-gui-action-at-a-time-per-display',
    analysisConcurrency: 'planner-grounder-verifier-may-run-in-parallel-before-executor-lock',
    captureKind: targetResolution.captureKind,
    inputIsolation: targetResolution.inputIsolation,
    focusPolicy: strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: strictFocus,
    interferenceRisk: sharedSystemInput
      ? 'serialized-global-shared-system-input-may-still-affect-user-devices'
      : targetBound && strictFocus
        ? 'low-when-focused-target-verified'
        : 'elevated-display-or-best-effort-isolation',
    windowLifecycle: {
      focused: targetResolution.focused,
      minimized: targetResolution.minimized,
      occluded: targetResolution.occluded,
      captureTimestamp: targetResolution.captureTimestamp,
    },
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

export function schedulerRunMetadata(targetResolution: WindowTargetResolution, config?: ComputerUseConfig): Record<string, unknown> {
  if (!targetResolution.ok) {
    return {
      mode: 'blocked',
      lockId: 'unresolved-window-target',
      lockScope: 'none',
      policy: 'do not execute real GUI actions until WindowTarget resolves to an isolated target or explicit display fallback',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      targetWindow: windowTargetTraceConfig(targetResolution.target),
      diagnostics: targetResolution.diagnostics,
    };
  }
  const targetBound = targetResolution.captureKind === 'window';
  const strictFocus = targetResolution.inputIsolation === 'require-focused-target';
  const sharedSystemInput = usesSharedSystemInput(config);
  const lockId = computerUseSchedulerLockId(targetResolution, { sharedSystemInput });
  return {
    mode: 'serialized-window-actions',
    lockId,
    lockScope: sharedSystemInput ? 'shared-system-input' : targetBound ? 'target-window' : 'display-fallback',
    policy: sharedSystemInput
      ? 'one real GUI action stream globally while using shared system mouse/keyboard; planner/grounder/verifier analysis may run in parallel before the executor lock'
      : 'one real GUI action stream per target window; planner/grounder/verifier analysis may run in parallel before the executor lock',
    actionConcurrency: sharedSystemInput
      ? 'one-real-gui-action-at-a-time-globally-for-shared-system-input'
      : targetBound
        ? 'one-real-gui-action-at-a-time-per-window'
        : 'one-real-gui-action-at-a-time-per-display',
    analysisConcurrency: 'parallel-allowed',
    focusPolicy: strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: strictFocus,
    interferenceRisk: sharedSystemInput
      ? 'serialized-global-shared-system-input-may-still-affect-user-devices'
      : targetBound && strictFocus
        ? 'low-when-focused-target-verified'
        : 'elevated-display-or-best-effort-isolation',
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

export function stepInputChannelMetadata(config: ComputerUseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  return inputChannelContract(config, targetResolution);
}

export function inputChannelContract(config: ComputerUseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  const targetBound = targetResolution.ok && targetResolution.captureKind === 'window';
  const isolation = targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation;
  const darwin = isDarwinPlatform(config.desktopPlatform);
  const dryRun = config.dryRun;
  const executor = dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config);
  const configuredIndependentAdapter = normalizeIndependentInputAdapter(config.inputAdapter);
  const independentAdapterReady = false;
  const independentInput = !dryRun && Boolean(configuredIndependentAdapter) && independentAdapterReady;
  const sharedSystemAllowed = Boolean(config.allowSharedSystemInput);
  const sharedSystemInput = !dryRun && darwin && !configuredIndependentAdapter && sharedSystemAllowed;
  const strictTarget = targetBound && isolation === 'require-focused-target';
  const provider = dryRun
    ? 'dry-run-input-channel'
    : independentInput
      ? `${configuredIndependentAdapter}-input-adapter`
      : configuredIndependentAdapter
        ? `${configuredIndependentAdapter}-input-adapter-unimplemented`
        : darwin
        ? 'macos-cgevent-system-events'
        : `${config.desktopPlatform}-input-provider-unavailable`;
  const userDeviceImpact = dryRun || independentInput
    ? 'none'
    : configuredIndependentAdapter
      ? 'fail-closed-unimplemented-independent-adapter'
    : strictTarget
      ? 'may-use-system-input-after-focused-target-verification'
      : 'may-affect-frontmost-window';
  return {
    type: 'generic-mouse-keyboard',
    executor,
    executorBoundary: dryRun ? 'dry-run' : executorBoundary(config),
    provider,
    isolation,
    targetBound,
    pointerKeyboardOwnership: dryRun ? 'virtual-dry-run-channel' : independentInput ? 'sciforge-independent-input-adapter' : sharedSystemInput ? 'shared-system-pointer-keyboard' : 'unavailable',
    pointerMode: dryRun ? 'virtual-no-user-pointer-movement' : independentInput ? 'adapter-window-bound-pointer' : sharedSystemInput ? 'system-cursor-events' : 'none',
    keyboardMode: dryRun ? 'virtual-no-user-keyboard-events' : independentInput ? 'adapter-window-bound-keyboard' : sharedSystemInput ? 'system-key-events' : 'none',
    visualPointer: dryRun ? 'virtual-trace-only' : config.showVisualCursor ? 'sciforge-distinct-overlay-cursor' : 'off',
    visualPointerShape: config.showVisualCursor ? 'cyan-diamond-magenta-outline-white-crosshair' : undefined,
    executorLockScope: sharedSystemInput ? 'global-shared-system-input' : targetBound ? 'target-window' : 'display-fallback',
    executorLockId: targetResolution.ok ? computerUseSchedulerLockId(targetResolution, { sharedSystemInput }) : 'unresolved-window-target',
    userDeviceImpact,
    independentAdapterRequiredForNoUserImpact: !dryRun && !independentInput,
    availableIndependentAdapters: ['browser-sandbox-adapter', 'remote-desktop-session', 'virtual-hid-device', 'accessibility-per-window-adapter'],
    currentIndependentAdapter: dryRun ? 'dry-run' : configuredIndependentAdapter ?? 'not-configured',
    independentAdapterStatus: dryRun ? 'dry-run' : configuredIndependentAdapter ? 'configured-unimplemented' : 'not-configured',
    sharedSystemInputExplicitlyAllowed: !dryRun && !independentInput ? sharedSystemAllowed : undefined,
    failClosed: !targetResolution.ok || (isolation === 'require-focused-target' && !targetBound) || (!dryRun && Boolean(configuredIndependentAdapter) && !independentAdapterReady) || (!dryRun && !configuredIndependentAdapter && !sharedSystemAllowed),
    highRiskConfirmationRequired: true,
    policy: [
      'Planner and Grounder may run in parallel from screenshots.',
      'Real GUI input must acquire the scheduler lock first.',
      'If an independent adapter is unavailable, strict target focus and explicit shared-system-input acknowledgement are required before shared system input.',
      'High-risk send/delete/pay/authorize/publish/submit actions require upstream confirmation before executor.',
    ],
  };
}

function usesSharedSystemInput(config: ComputerUseConfig | undefined) {
  if (!config) return false;
  return !config.dryRun
    && isDarwinPlatform(config.desktopPlatform)
    && !normalizeIndependentInputAdapter(config.inputAdapter)
    && Boolean(config.allowSharedSystemInput);
}

export function isWindowLocalCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
}

function normalizeIndependentInputAdapter(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'virtual-hid' || normalized === 'virtual-hid-device') return 'virtual-hid';
  if (normalized === 'remote-desktop' || normalized === 'remote-desktop-session') return 'remote-desktop';
  if (normalized === 'browser-sandbox' || normalized === 'browser-sandbox-adapter') return 'browser-sandbox';
  if (normalized === 'accessibility-per-window' || normalized === 'accessibility-per-window-adapter') return 'accessibility-per-window';
  return undefined;
}

function normalizeWindowTargetMode(value: string | undefined, target: { windowId?: number; appName?: string; title?: string }): WindowTarget['mode'] {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'display' || normalized === 'screen') return 'display';
  if (normalized === 'active' || normalized === 'active_window' || normalized === 'frontmost') return 'active-window';
  if (normalized === 'window' || normalized === 'window_id' || normalized === 'id') return 'window-id';
  if (normalized === 'app' || normalized === 'app_window' || normalized === 'application') return 'app-window';
  if (target.windowId !== undefined) return 'window-id';
  if (target.appName || target.title) return 'app-window';
  return 'display';
}

function normalizeCoordinateSpace(value: string | undefined, mode: WindowTarget['mode']): WindowTarget['coordinateSpace'] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'screen' || normalized === 'global') return 'screen';
  if (normalized === 'window-local' || normalized === 'window_local' || normalized === 'local') return 'window-local';
  if (normalized === 'window' || normalized === 'target-window' || normalized === 'target') return 'window';
  return mode === 'display' ? 'screen' : 'window';
}

function normalizeInputIsolation(value: string | undefined, required: boolean): WindowTarget['inputIsolation'] {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'require_focused_target' || normalized === 'strict' || normalized === 'required') return 'require-focused-target';
  if (normalized === 'best_effort' || normalized === 'off' || normalized === 'none') return 'best-effort';
  return required ? 'require-focused-target' : 'best-effort';
}

async function detectMacWindowTarget(target: WindowTarget): Promise<WindowTargetResolution> {
  if (target.mode === 'window-id' && target.windowId !== undefined) {
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId: target.windowId,
      processId: target.processId,
      bundleId: target.bundleId,
      appName: target.appName,
      title: target.title,
      displayId: target.displayId,
      bounds: target.bounds,
      contentRect: target.contentRect,
      devicePixelRatio: target.devicePixelRatio,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId),
      source: 'config',
      captureTimestamp: new Date().toISOString(),
      diagnostics: ['using configured macOS window id'],
    };
  }
  const scriptPath = join(tmpdir(), `sciforge-window-target-${randomUUID()}.swift`);
  await writeFile(scriptPath, macWindowTargetProbeScript(target), 'utf8');
  try {
    const result = await runMacWindowTargetProbe(scriptPath);
    if (result.exitCode !== 0) {
      const reason = `macOS target-window probe failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`;
      return { ok: false, target, reason, diagnostics: [reason] };
    }
    const parsed = parseJson(result.stdout.trim());
    if (!isRecordLike(parsed)) {
      const reason = 'macOS target-window probe did not return JSON metadata.';
      return { ok: false, target, reason, diagnostics: [reason, result.stdout.trim()].filter(Boolean) };
    }
    const windowId = numberConfig(parsed.windowId);
    const bounds = parseWindowBounds(parsed.bounds);
    const contentRect = parseWindowBounds(parsed.contentRect);
    const diagnostic = stringConfig(parsed.diagnostic);
    if (windowId === undefined) {
      const reason = String(parsed.reason || 'macOS target-window probe did not find a matching on-screen window.');
      return { ok: false, target, reason, diagnostics: [reason] };
    }
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId,
      processId: numberConfig(parsed.processId, target.processId),
      bundleId: stringConfig(parsed.bundleId, target.bundleId),
      appName: stringConfig(parsed.appName, target.appName),
      title: stringConfig(parsed.title, target.title),
      displayId: numberConfig(parsed.displayId, target.displayId),
      bounds,
      contentRect: contentRect ?? bounds,
      devicePixelRatio: numberConfig(parsed.devicePixelRatio, target.devicePixelRatio),
      focused: typeof parsed.focused === 'boolean' ? parsed.focused : target.focused,
      minimized: typeof parsed.minimized === 'boolean' ? parsed.minimized : target.minimized,
      occluded: typeof parsed.occluded === 'boolean' ? parsed.occluded : target.occluded,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, windowId),
      source: target.mode === 'active-window' ? 'active-window' : 'config',
      captureTimestamp: new Date().toISOString(),
      diagnostics: diagnostic
        ? ['resolved macOS target window through CGWindowList', diagnostic]
        : ['resolved macOS target window through CGWindowList'],
    };
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

async function runMacWindowTargetProbe(scriptPath: string) {
  const interpreted = await runCommand('swift', [scriptPath], { timeoutMs: 15000 });
  if (interpreted.exitCode === 0 || !/JIT session error|Symbols not found|NSWorkspace|NSRunningApplication/i.test(`${interpreted.stderr}\n${interpreted.stdout}`)) {
    return interpreted;
  }
  const binaryPath = join(tmpdir(), `sciforge-window-target-${randomUUID()}`);
  try {
    const compiled = await runCommand('swiftc', [scriptPath, '-o', binaryPath, '-framework', 'AppKit', '-framework', 'CoreGraphics'], { timeoutMs: 30000 });
    if (compiled.exitCode !== 0) {
      return {
        exitCode: compiled.exitCode,
        stdout: [interpreted.stdout, compiled.stdout].filter(Boolean).join('\n'),
        stderr: [
          `Swift interpreter failed: ${interpreted.stderr || interpreted.stdout || `exit ${interpreted.exitCode}`}`,
          `swiftc AppKit fallback failed: ${compiled.stderr || compiled.stdout || `exit ${compiled.exitCode}`}`,
        ].join('\n'),
      };
    }
    const executed = await runCommand(binaryPath, [], { timeoutMs: 15000 });
    return executed.exitCode === 0
      ? executed
      : {
          exitCode: executed.exitCode,
          stdout: [interpreted.stdout, compiled.stdout, executed.stdout].filter(Boolean).join('\n'),
          stderr: [
            `Swift interpreter failed: ${interpreted.stderr || interpreted.stdout || `exit ${interpreted.exitCode}`}`,
            `compiled AppKit probe failed: ${executed.stderr || executed.stdout || `exit ${executed.exitCode}`}`,
          ].join('\n'),
        };
  } finally {
    await unlink(binaryPath).catch(() => undefined);
  }
}

function macWindowTargetProbeScript(target: WindowTarget) {
  return `
import CoreGraphics
import Foundation
import AppKit

let targetMode = ${swiftString(target.mode)}
let targetApp: String? = ${swiftOptionalString(target.appName)}
let targetTitle: String? = ${swiftOptionalString(target.title)}
let targetBundle: String? = ${swiftOptionalString(target.bundleId)}
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
var titleDriftCandidates: [[String: Any]] = []

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  print(String(data: data, encoding: .utf8)!)
}

func displayIdFor(bounds: CGRect) -> UInt32? {
  var count: UInt32 = 0
  var displays = [CGDirectDisplayID](repeating: 0, count: 16)
  let error = CGGetDisplaysWithRect(bounds, UInt32(displays.count), &displays, &count)
  if error == .success && count > 0 { return displays[0] }
  return nil
}

for window in windows {
  let layer = window[kCGWindowLayer as String] as? Int ?? 1
  if layer != 0 { continue }
  let appName = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  let processId = window[kCGWindowOwnerPID as String] as? Int32
  let runningApp = processId.flatMap { NSRunningApplication(processIdentifier: $0) }
  let bundleId = runningApp?.bundleIdentifier ?? ""
  if let targetApp, appName.range(of: targetApp, options: [.caseInsensitive]) == nil { continue }
  if let targetBundle, bundleId.range(of: targetBundle, options: [.caseInsensitive]) == nil { continue }
  let windowId = window[kCGWindowNumber as String] as? UInt32 ?? 0
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let x = bounds["X"] as? CGFloat ?? bounds["x"] as? CGFloat ?? 0
  let y = bounds["Y"] as? CGFloat ?? bounds["y"] as? CGFloat ?? 0
  let width = bounds["Width"] as? CGFloat ?? bounds["width"] as? CGFloat ?? 0
  let height = bounds["Height"] as? CGFloat ?? bounds["height"] as? CGFloat ?? 0
  let rect = CGRect(x: x, y: y, width: width, height: height)
  let displayId = displayIdFor(bounds: rect)
  let alpha = window[kCGWindowAlpha as String] as? Double ?? 1
  let isOnscreen = (window[kCGWindowIsOnscreen as String] as? Bool) ?? true
  let focused = processId != nil && frontmostPid == processId
  var payload: [String: Any] = [
    "windowId": Int(windowId),
    "processId": Int(processId ?? 0),
    "bundleId": bundleId,
    "appName": appName,
    "title": title,
    "bounds": bounds,
    "contentRect": bounds,
    "focused": focused,
    "minimized": !isOnscreen,
    "occluded": alpha <= 0 || !isOnscreen,
  ]
  if let displayId { payload["displayId"] = Int(displayId) }
  if let targetTitle, title.range(of: targetTitle, options: [.caseInsensitive]) == nil {
    if targetMode == "active-window" || targetMode == "app-window" {
      var driftPayload = payload
      driftPayload["titleDrift"] = true
      driftPayload["requestedTitle"] = targetTitle
      titleDriftCandidates.append(driftPayload)
    }
    continue
  }
  if targetMode == "active-window" || targetMode == "app-window" {
    emit(payload)
    exit(0)
  }
}

if targetMode == "active-window" || targetMode == "app-window" {
  let focusedCandidates = titleDriftCandidates.filter { ($0["focused"] as? Bool) == true }
  if focusedCandidates.count == 1 {
    var payload = focusedCandidates[0]
    payload["diagnostic"] = "target title drifted; recovered focused app/bundle window"
    emit(payload)
    exit(0)
  }
  if titleDriftCandidates.count == 1 {
    var payload = titleDriftCandidates[0]
    payload["diagnostic"] = "target title drifted; recovered sole app/bundle window"
    emit(payload)
    exit(0)
  }
}

emit(["reason": "no matching target window"])
exit(2)
`;
}

function schedulerLockIdForTarget(target: WindowTarget, resolvedId: string | number) {
  return sanitizeId([
    'vision-window',
    target.mode,
    resolvedId,
    target.appName,
    target.title,
  ].filter((part) => part !== undefined && part !== '').join('-')).toLowerCase();
}

function parseJsonEnv(value: string | undefined) {
  if (!value) return undefined;
  return parseJson(value);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
