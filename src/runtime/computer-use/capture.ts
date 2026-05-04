import { readFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { CaptureDiagnostic, CaptureProviderFailure, ComputerUseConfig, ResolvedWindowTarget, ScreenshotRef, WindowTargetResolution } from './types.js';
import { toTraceScreenshotRef } from './types.js';
import { isDarwinPlatform, pngDimensions, runCommand, sha256, workspaceRel } from './utils.js';
import { toTraceWindowTarget } from './window-target.js';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);

export class CaptureProviderError extends Error {
  readonly failure: CaptureProviderFailure;

  constructor(failure: CaptureProviderFailure) {
    super(formatCaptureFailure(failure));
    this.name = 'CaptureProviderError';
    this.failure = failure;
  }
}

export async function captureDisplays(
  workspace: string,
  runDir: string,
  prefix: string,
  config: ComputerUseConfig,
  targetResolution: WindowTargetResolution,
) {
  const refs: ScreenshotRef[] = [];
  if (targetResolution.ok && targetResolution.captureKind === 'window') {
    const displayId = targetResolution.displayId ?? config.captureDisplays[0] ?? 1;
    const absPath = join(runDir, `${prefix}-window-${targetResolution.windowId ?? 'active'}.png`);
    const captureTimestamp = new Date().toISOString();
    const captureScope = 'window' as const;
    const captureProvider = windowCaptureProvider(targetResolution, config);
    const captureDiagnostics: CaptureDiagnostic[] = [
      diagnostic('info', 'capture.window.start', 'Starting target-window screenshot capture.', {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }),
    ];
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
      captureDiagnostics.push(diagnostic('info', 'capture.window.dry-run', 'Wrote dry-run target-window screenshot placeholder.', {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }));
    } else {
      const result = await captureWindowScreenshot(absPath, targetResolution, config);
      captureDiagnostics.push(...result.diagnostics);
      if (result.exitCode !== 0) {
        throw new CaptureProviderError({
          ok: false,
          provider: result.provider,
          captureScope,
          displayId,
          path: absPath,
          windowId: targetResolution.windowId,
          diagnostics: captureDiagnostics,
        });
      }
    }
    const stats = await stat(absPath);
    const bytes = await readFile(absPath);
    const dimensions = pngDimensions(bytes);
    refs.push({
      id: basename(absPath, '.png'),
      path: workspaceRel(workspace, absPath),
      absPath,
      displayId,
      windowTarget: toTraceWindowTarget(targetResolution),
      captureScope,
      captureProvider,
      captureTimestamp,
      diagnostics: [...targetResolution.diagnostics, ...captureDiagnostics.map((item) => item.message)],
      captureDiagnostics,
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
    return refs;
  }

  for (const displayId of config.captureDisplays) {
    const absPath = join(runDir, `${prefix}-display-${displayId}.png`);
    const captureTimestamp = new Date().toISOString();
    const captureScope = 'display' as const;
    const captureProvider = config.dryRun ? 'dry-run-display-png' : captureProviderName(config, captureScope);
    const captureDiagnostics: CaptureDiagnostic[] = [
      diagnostic('info', 'capture.display.start', `Starting display screenshot capture for display ${displayId}.`, {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }),
    ];
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
      captureDiagnostics.push(diagnostic('info', 'capture.display.dry-run', `Wrote dry-run display screenshot placeholder for display ${displayId}.`, {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }));
    } else {
      const args = ['-x', '-D', String(displayId), absPath];
      const result = await runCommand('screencapture', args, { timeoutMs: 15000 });
      captureDiagnostics.push(commandDiagnostic(result.exitCode === 0 ? 'info' : 'error', 'capture.display.provider-result', {
        provider: captureProvider,
        captureScope,
        command: 'screencapture',
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }));
      if (result.exitCode !== 0) {
        throw new CaptureProviderError({
          ok: false,
          provider: captureProvider,
          captureScope,
          displayId,
          path: absPath,
          diagnostics: captureDiagnostics,
        });
      }
    }
    const stats = await stat(absPath);
    const bytes = await readFile(absPath);
    const dimensions = pngDimensions(bytes);
    refs.push({
      id: basename(absPath, '.png'),
      path: workspaceRel(workspace, absPath),
      absPath,
      displayId,
      windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
      captureScope,
      captureProvider,
      captureTimestamp,
      diagnostics: [...targetResolution.diagnostics, ...captureDiagnostics.map((item) => item.message)],
      captureDiagnostics,
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
  }
  return refs;
}

export function pixelDiffForScreenshotSets(beforeRefs: ScreenshotRef[], afterRefs: ScreenshotRef[]) {
  const pairs = beforeRefs.map((before) => {
    const after = afterRefs.find((candidate) => candidate.displayId === before.displayId);
    if (!after) {
      return {
        displayId: before.displayId,
        status: 'missing-after-screenshot',
        changedByteRatio: 1,
        possiblyNoEffect: false,
      };
    }
    return {
      displayId: before.displayId,
      beforeScreenshotRef: before.path,
      afterScreenshotRef: after.path,
      changedByteRatio: screenshotByteDiffRatio(before, after),
      possiblyNoEffect: before.sha256 === after.sha256,
    };
  });
  return {
    method: 'sha256-and-byte-diff',
    pairs,
    possiblyNoEffect: pairs.every((pair) => pair.possiblyNoEffect),
  };
}

export function validateRuntimeTraceScreenshots(refs: ScreenshotRef[]) {
  const missingRefs = refs.filter((ref) => !ref.bytes || !ref.sha256 || !ref.width || !ref.height).map((ref) => ref.path);
  return {
    ok: missingRefs.length === 0,
    checkedRefs: refs.map((ref) => ref.path),
    missingRefs,
    invalidRefs: [],
    diagnostics: missingRefs.map((ref) => `invalid screenshot metadata: ${ref}`),
  };
}

export { toTraceScreenshotRef };

async function captureWindowScreenshot(absPath: string, targetResolution: ResolvedWindowTarget, config: ComputerUseConfig) {
  if (isDarwinPlatform(config.desktopPlatform) && targetResolution.windowId !== undefined) {
    const args = ['-x', '-l', String(targetResolution.windowId), absPath];
    const result = await runCommand('screencapture', args, { timeoutMs: 15000 });
    return {
      ...result,
      provider: 'macos-screencapture-window',
      diagnostics: [
        commandDiagnostic(result.exitCode === 0 ? 'info' : 'error', 'capture.window.provider-result', {
          provider: 'macos-screencapture-window',
          captureScope: 'window',
          command: 'screencapture',
          args,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      ],
    };
  }
  const provider = windowCaptureProvider(targetResolution, config);
  return {
    exitCode: 125,
    stdout: '',
    stderr: 'Target-window capture requires a macOS screencapture-compatible windowId provider for the configured desktop platform.',
    provider,
    diagnostics: [
      diagnostic('error', 'capture.window.unsupported-provider', 'Target-window screenshot capture is not available for the configured desktop platform/provider.', {
        provider,
        captureScope: 'window',
      }),
    ],
  };
}

function captureProviderName(config: ComputerUseConfig, scope: 'display' | 'window') {
  if (isDarwinPlatform(config.desktopPlatform)) return scope === 'window' ? 'macos-screencapture-window' : 'macos-screencapture-display';
  return `${config.desktopPlatform}-${scope}-capture-provider`;
}

function windowCaptureProvider(targetResolution: ResolvedWindowTarget, config: ComputerUseConfig) {
  if (config.dryRun) return 'dry-run-window-png';
  if (isDarwinPlatform(config.desktopPlatform) && targetResolution.windowId !== undefined) return 'macos-screencapture-window';
  return `${config.desktopPlatform || 'unknown'}-window-provider-unavailable`;
}

function diagnostic(
  level: CaptureDiagnostic['level'],
  code: string,
  message: string,
  options: Partial<Omit<CaptureDiagnostic, 'level' | 'code' | 'message' | 'timestamp'>> & { timestamp?: string } = {},
): CaptureDiagnostic {
  return {
    level,
    code,
    message,
    provider: options.provider,
    captureScope: options.captureScope,
    command: options.command,
    args: options.args,
    exitCode: options.exitCode,
    stdout: trimDiagnosticText(options.stdout),
    stderr: trimDiagnosticText(options.stderr),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

function commandDiagnostic(
  level: CaptureDiagnostic['level'],
  code: string,
  options: Partial<CaptureDiagnostic> & { provider: string; captureScope: CaptureDiagnostic['captureScope']; command: string; args: string[]; exitCode: number },
) {
  return diagnostic(level, code, `${options.command} exited with code ${options.exitCode}.`, options);
}

function trimDiagnosticText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 2000) : undefined;
}

function formatCaptureFailure(failure: CaptureProviderFailure) {
  const last = [...failure.diagnostics].reverse().find((item) => item.level === 'error') ?? failure.diagnostics[failure.diagnostics.length - 1];
  return [
    `screenshot capture failed: provider=${failure.provider}`,
    `scope=${failure.captureScope}`,
    `display=${failure.displayId}`,
    failure.windowId === undefined ? undefined : `window=${failure.windowId}`,
    last ? `reason=${last.message}` : undefined,
  ].filter(Boolean).join(' ');
}

function screenshotByteDiffRatio(before: ScreenshotRef, after: ScreenshotRef) {
  if (before.sha256 === after.sha256) return 0;
  try {
    const left = readFileSync(before.absPath);
    const right = readFileSync(after.absPath);
    if (left.length !== right.length) return 1;
    let changed = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) changed += 1;
    }
    return changed / Math.max(left.length, 1);
  } catch {
    return 1;
  }
}
