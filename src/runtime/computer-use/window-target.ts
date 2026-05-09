import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  computerUseInputChannelContract,
  computerUseInputChannelDescription,
  computerUseInputPolicyIds,
  computerUseSchedulerLockIdForTarget,
  computerUseSchedulerRunMetadata,
  computerUseSchedulerStepMetadata,
  computerUseUsesSharedSystemInput,
  isComputerUseWindowLocalCoordinateSpace,
  normalizeComputerUseCoordinateSpace,
  normalizeComputerUseInputIsolation,
  normalizeComputerUseWindowTargetMode,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type { ComputerUseConfig, ResolvedWindowTarget, TraceWindowTarget, WindowBounds, WindowTarget, WindowTargetResolution } from './types.js';
import { computerUseSchedulerLockId } from './scheduler.js';
import { booleanConfig, envOrValue, isDarwinPlatform, numberConfig, parseJson, runCommand, stringConfig, swiftOptionalString, swiftString } from './utils.js';

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
  const mode = normalizeComputerUseWindowTargetMode(explicitMode, { windowId, appName, title });
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
  const coordinateSpace = normalizeComputerUseCoordinateSpace(stringConfig(process.env.SCIFORGE_VISION_COORDINATE_SPACE, targetConfig.coordinateSpace, targetConfig.coordinate_space), mode);
  const inputIsolation = normalizeComputerUseInputIsolation(stringConfig(process.env.SCIFORGE_VISION_INPUT_ISOLATION, targetConfig.inputIsolation, targetConfig.input_isolation), required);
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
  return computerUseInputChannelDescription({
    contract,
    targetResolved: targetResolution.ok,
    captureKind: targetResolution.ok ? targetResolution.captureKind : undefined,
    coordinateSpace: targetResolution.ok ? targetResolution.coordinateSpace : undefined,
    inputIsolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
  });
}

export function schedulerStepMetadata(targetResolution: WindowTargetResolution, stepId: string, config?: ComputerUseConfig): Record<string, unknown> {
  if (!targetResolution.ok) {
    return computerUseSchedulerStepMetadata({
      targetResolved: false,
      stepId,
      lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
      lockScope: 'display-fallback',
      reason: targetResolution.reason,
      diagnostics: targetResolution.diagnostics,
    });
  }
  const targetBound = targetResolution.captureKind === 'window';
  const strictFocus = targetResolution.inputIsolation === 'require-focused-target';
  const sharedSystemInput = usesSharedSystemInput(config);
  const lockId = computerUseSchedulerLockId(targetResolution, { sharedSystemInput });
  return {
    ...computerUseSchedulerStepMetadata({
      targetResolved: true,
      stepId,
      lockId,
      lockScope: sharedSystemInput ? 'shared-system-input' : targetBound ? 'target-window' : 'display-fallback',
      captureKind: targetResolution.captureKind,
      inputIsolation: targetResolution.inputIsolation,
      focused: targetResolution.focused,
      minimized: targetResolution.minimized,
      occluded: targetResolution.occluded,
      captureTimestamp: targetResolution.captureTimestamp,
      sharedSystemInput,
      targetBound,
      strictFocus,
    }),
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

export function schedulerRunMetadata(targetResolution: WindowTargetResolution, config?: ComputerUseConfig): Record<string, unknown> {
  if (!targetResolution.ok) {
    return {
      ...computerUseSchedulerRunMetadata({
        targetResolved: false,
        lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
        lockScope: 'display-fallback',
        diagnostics: targetResolution.diagnostics,
      }),
      targetWindow: windowTargetTraceConfig(targetResolution.target),
    };
  }
  const targetBound = targetResolution.captureKind === 'window';
  const strictFocus = targetResolution.inputIsolation === 'require-focused-target';
  const sharedSystemInput = usesSharedSystemInput(config);
  const lockId = computerUseSchedulerLockId(targetResolution, { sharedSystemInput });
  return {
    ...computerUseSchedulerRunMetadata({
      targetResolved: true,
      lockId,
      lockScope: sharedSystemInput ? 'shared-system-input' : targetBound ? 'target-window' : 'display-fallback',
      sharedSystemInput,
      targetBound,
      strictFocus,
    }),
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

export function stepInputChannelMetadata(config: ComputerUseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  return inputChannelContract(config, targetResolution);
}

export function inputChannelContract(config: ComputerUseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  const targetBound = targetResolution.ok && targetResolution.captureKind === 'window';
  const isolation = targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation;
  const sharedSystemInput = usesSharedSystemInput(config);
  return computerUseInputChannelContract({
    desktopPlatform: config.desktopPlatform,
    dryRun: config.dryRun,
    inputAdapter: config.inputAdapter,
    allowSharedSystemInput: config.allowSharedSystemInput,
    showVisualCursor: config.showVisualCursor,
    targetResolved: targetResolution.ok,
    targetBound,
    isolation,
    executorLockId: targetResolution.ok ? computerUseSchedulerLockId(targetResolution, { sharedSystemInput }) : computerUseInputPolicyIds.unresolvedWindowLockId,
  });
}

function usesSharedSystemInput(config: ComputerUseConfig | undefined) {
  if (!config) return false;
  return computerUseUsesSharedSystemInput(config);
}

export function isWindowLocalCoordinateSpace(value: string | undefined) {
  return isComputerUseWindowLocalCoordinateSpace(value);
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
    if (shouldRetryAfterActivatingTargetApp(result, target)) {
      const activation = await activateMacTargetApp(target.appName as string);
      await sleep(1000);
      const retry = await runMacWindowTargetProbe(scriptPath);
      const resolved = macWindowTargetResolutionFromProbeResult(retry, target, activation);
      if (resolved.ok || target.required) return resolved;
    }
    return macWindowTargetResolutionFromProbeResult(result, target);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
}

function macWindowTargetResolutionFromProbeResult(
  result: { exitCode: number; stdout: string; stderr: string },
  target: WindowTarget,
  diagnosticPrefix?: string,
): WindowTargetResolution {
    if (result.exitCode !== 0) {
      const reason = `macOS target-window probe failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`;
      return { ok: false, target, reason, diagnostics: [diagnosticPrefix, reason].filter(Boolean) as string[] };
    }
    const parsed = parseJson(result.stdout.trim());
    if (!isRecordLike(parsed)) {
      const reason = 'macOS target-window probe did not return JSON metadata.';
      return { ok: false, target, reason, diagnostics: [diagnosticPrefix, reason, result.stdout.trim()].filter(Boolean) as string[] };
    }
    const windowId = numberConfig(parsed.windowId);
    const bounds = parseWindowBounds(parsed.bounds);
    const contentRect = parseWindowBounds(parsed.contentRect);
    const diagnostic = stringConfig(parsed.diagnostic);
    if (windowId === undefined) {
      const reason = String(parsed.reason || 'macOS target-window probe did not find a matching on-screen window.');
      return { ok: false, target, reason, diagnostics: [diagnosticPrefix, reason].filter(Boolean) as string[] };
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
      diagnostics: diagnosticPrefix
        ? [diagnosticPrefix, 'resolved macOS target window through CGWindowList', diagnostic].filter(Boolean) as string[]
        : diagnostic
        ? ['resolved macOS target window through CGWindowList', diagnostic]
        : ['resolved macOS target window through CGWindowList'],
    };
  }
}

function shouldRetryAfterActivatingTargetApp(
  result: { exitCode: number; stdout: string; stderr: string },
  target: WindowTarget,
) {
  if (result.exitCode === 0 || target.mode !== 'app-window' || !target.appName) return false;
  const text = `${result.stdout}\n${result.stderr}`;
  return /no matching target window|did not find a matching/i.test(text);
}

async function activateMacTargetApp(appName: string) {
  const result = await runCommand('open', ['-a', appName], { timeoutMs: 15000 });
  return result.exitCode === 0
    ? `activated target app "${appName}" before retrying WindowTarget probe`
    : `failed to activate target app "${appName}" before WindowTarget retry: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`;
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
  return computerUseSchedulerLockIdForTarget(target, resolvedId);
}

function parseJsonEnv(value: string | undefined) {
  if (!value) return undefined;
  return parseJson(value);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
