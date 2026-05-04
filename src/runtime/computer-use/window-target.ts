import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComputerUseConfig, ResolvedWindowTarget, TraceWindowTarget, WindowBounds, WindowTarget, WindowTargetResolution } from './types.js';
import { executorBoundary } from './executor.js';
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
  const appName = stringConfig(process.env.SCIFORGE_VISION_WINDOW_APP_NAME, targetConfig.appName, targetConfig.app_name, targetConfig.application);
  const title = stringConfig(process.env.SCIFORGE_VISION_WINDOW_TITLE, targetConfig.title, targetConfig.windowTitle, targetConfig.window_title);
  const bounds = parseWindowBounds(envOrValue(process.env.SCIFORGE_VISION_WINDOW_BOUNDS, targetConfig.bounds, targetConfig.windowBounds, targetConfig.window_bounds));
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
    appName,
    title,
    bounds,
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
      diagnostics: ['window targeting disabled; using configured display capture for compatibility'],
    };
  }
  if (config.dryRun) {
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId: target.windowId,
      appName: target.appName,
      title: target.title,
      bounds: target.bounds,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId ?? target.mode),
      source: 'dry-run',
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
    appName: target.appName,
    title: target.title,
    bounds: target.bounds,
  };
}

export function toTraceWindowTarget(targetResolution: ResolvedWindowTarget): TraceWindowTarget {
  return {
    ...windowTargetTraceConfig(targetResolution.target),
    captureKind: targetResolution.captureKind,
    coordinateSpace: targetResolution.coordinateSpace,
    inputIsolation: targetResolution.inputIsolation,
    windowId: targetResolution.windowId,
    appName: targetResolution.appName,
    title: targetResolution.title,
    bounds: targetResolution.bounds,
    schedulerLockId: targetResolution.schedulerLockId,
    source: targetResolution.source,
    diagnostics: targetResolution.diagnostics.length ? targetResolution.diagnostics : undefined,
  };
}

export function inputChannelDescription(config: ComputerUseConfig, targetResolution: WindowTargetResolution) {
  const executor = config.dryRun ? 'dry-run' : executorBoundary(config);
  if (!targetResolution.ok) return `generic-mouse-keyboard:${executor}:blocked-unresolved-window-target`;
  return [
    'generic-mouse-keyboard',
    executor,
    targetResolution.captureKind === 'window' ? 'target-window' : 'display',
    isWindowLocalCoordinateSpace(targetResolution.coordinateSpace) ? 'window-relative-grounding' : 'screen-relative-grounding',
    targetResolution.inputIsolation,
  ].join(':');
}

export function schedulerStepMetadata(targetResolution: WindowTargetResolution, stepId: string): Record<string, unknown> {
  if (!targetResolution.ok) {
    return {
      mode: 'blocked',
      stepId,
      lockId: 'unresolved-window-target',
      reason: targetResolution.reason,
      diagnostics: targetResolution.diagnostics,
    };
  }
  return {
    mode: 'serialized-window-actions',
    stepId,
    lockId: targetResolution.schedulerLockId,
    captureKind: targetResolution.captureKind,
    inputIsolation: targetResolution.inputIsolation,
    failClosedIsolation: targetResolution.inputIsolation === 'require-focused-target',
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

export function stepInputChannelMetadata(config: ComputerUseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  return {
    type: 'generic-mouse-keyboard',
    executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
    isolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
    targetBound: targetResolution.ok && targetResolution.captureKind === 'window',
  };
}

export function isWindowLocalCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
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
      appName: target.appName,
      title: target.title,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId),
      source: 'config',
      diagnostics: ['using configured macOS window id'],
    };
  }
  const scriptPath = join(tmpdir(), `sciforge-window-target-${randomUUID()}.swift`);
  await writeFile(scriptPath, macWindowTargetProbeScript(target), 'utf8');
  try {
    const result = await runCommand('swift', [scriptPath], { timeoutMs: 15000 });
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
    if (windowId === undefined) {
      const reason = String(parsed.reason || 'macOS target-window probe did not find a matching on-screen window.');
      return { ok: false, target, reason, diagnostics: [reason] };
    }
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId,
      appName: stringConfig(parsed.appName, target.appName),
      title: stringConfig(parsed.title, target.title),
      bounds,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, windowId),
      source: target.mode === 'active-window' ? 'active-window' : 'config',
      diagnostics: ['resolved macOS target window through CGWindowList'],
    };
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function macWindowTargetProbeScript(target: WindowTarget) {
  return `
import CoreGraphics
import Foundation

let targetMode = ${swiftString(target.mode)}
let targetApp: String? = ${swiftOptionalString(target.appName)}
let targetTitle: String? = ${swiftOptionalString(target.title)}
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  print(String(data: data, encoding: .utf8)!)
}

for window in windows {
  let layer = window[kCGWindowLayer as String] as? Int ?? 1
  if layer != 0 { continue }
  let appName = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  if let targetApp, appName.range(of: targetApp, options: [.caseInsensitive]) == nil { continue }
  if let targetTitle, title.range(of: targetTitle, options: [.caseInsensitive]) == nil { continue }
  let windowId = window[kCGWindowNumber as String] as? UInt32 ?? 0
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  if targetMode == "active-window" || targetMode == "app-window" {
    emit([
      "windowId": Int(windowId),
      "appName": appName,
      "title": title,
      "bounds": bounds,
    ])
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
