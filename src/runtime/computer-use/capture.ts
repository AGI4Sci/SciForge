import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  computerUseCaptureDiagnostics,
  computerUseCaptureProviderIds,
  computerUseCaptureProviderName,
  computerUseWindowCaptureProvider,
} from '../../../packages/actions/computer-use/provider-policy.js';
import type { CaptureDiagnostic, CaptureProviderFailure, FocusRegion, ComputerUseConfig, ResolvedWindowTarget, ScreenshotRef, WindowTargetResolution } from './types.js';
import { toTraceScreenshotRef } from './types.js';
import { hasExecutableIndependentInputAdapter, SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER } from './independent-input-adapter.js';
import { renderVirtualRemoteSessionCapture } from './virtual-remote-session.js';
import { isDarwinPlatform, pngDimensions, runCommand, sha256, sleep, workspaceRel } from './utils.js';
import { toTraceWindowTarget } from './window-target.js';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);

const MACOS_VISION_OCR_PROVIDER = 'macos-vision-framework-ocr';

let macVisionOcrBinaryPromise: Promise<string> | undefined;

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
    const independentAdapterCapture = hasExecutableIndependentInputAdapter(config);
    const displayId = targetResolution.displayId ?? config.captureDisplays[0] ?? 1;
    const absPath = join(runDir, `${prefix}-window-${targetResolution.windowId ?? 'active'}.png`);
    const captureTimestamp = new Date().toISOString();
    const captureScope = 'window' as const;
    const captureProvider = independentAdapterCapture
      ? `${SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER}-capture`
      : windowCaptureProvider(targetResolution, config);
    const captureDiagnostics: CaptureDiagnostic[] = [
      diagnostic('info', 'capture.window.start', 'Starting target-window screenshot capture.', {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }),
    ];
    if (independentAdapterCapture) {
      const rendered = await renderVirtualRemoteSessionCapture({
        workspace,
        runDir,
        absPath,
        prefix,
        config,
        targetResolution,
        captureScope,
        displayId,
        captureTimestamp,
      });
      captureDiagnostics.push(...rendered.diagnostics);
      captureDiagnostics.push(diagnostic('info', 'capture.window.independent-input-adapter', 'Rendered independent remote-desktop session screenshot without system screen capture.', {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }));
    } else if (config.dryRun) {
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
    const independentAdapterCapture = hasExecutableIndependentInputAdapter(config);
    const absPath = join(runDir, `${prefix}-display-${displayId}.png`);
    const captureTimestamp = new Date().toISOString();
    const captureScope = 'display' as const;
    const captureProvider = independentAdapterCapture
      ? `${SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER}-capture`
      : config.dryRun ? computerUseCaptureProviderIds.dryRunDisplayPng : captureProviderName(config, captureScope);
    const captureDiagnostics: CaptureDiagnostic[] = [
      diagnostic('info', 'capture.display.start', `Starting display screenshot capture for display ${displayId}.`, {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }),
    ];
    if (independentAdapterCapture) {
      const rendered = await renderVirtualRemoteSessionCapture({
        workspace,
        runDir,
        absPath,
        prefix,
        config,
        targetResolution,
        captureScope,
        displayId,
        captureTimestamp,
      });
      captureDiagnostics.push(...rendered.diagnostics);
      captureDiagnostics.push(diagnostic('info', 'capture.display.independent-input-adapter', `Rendered independent remote-desktop session screenshot for display ${displayId} without system screen capture.`, {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }));
    } else if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
      captureDiagnostics.push(diagnostic('info', 'capture.display.dry-run', `Wrote dry-run display screenshot placeholder for display ${displayId}.`, {
        provider: captureProvider,
        captureScope,
        timestamp: captureTimestamp,
      }));
    } else {
      const args = ['-x', '-D', String(displayId), absPath];
      const result = await runCommand('screencapture', args, { timeoutMs: 15000 });
      captureDiagnostics.push(commandDiagnostic(result.exitCode === 0 ? 'info' : 'error', computerUseCaptureDiagnostics.displayProviderResult.code, {
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

export async function extractVisibleTextsFromScreenshotRefs(
  refs: ScreenshotRef[],
  config: ComputerUseConfig,
): Promise<{ visibleTexts: string[]; diagnostics: CaptureDiagnostic[] }> {
  if (!config.visibleTextExtraction?.enabled) return { visibleTexts: [], diagnostics: [] };
  if (!isDarwinPlatform(config.desktopPlatform) || config.dryRun) {
    return {
      visibleTexts: [],
      diagnostics: [
        diagnostic('warning', 'capture.visible-text.unsupported-provider', 'Visible text extraction is enabled, but macOS Vision OCR is unavailable for this capture configuration.', {
          provider: MACOS_VISION_OCR_PROVIDER,
          captureScope: refs[0]?.captureScope,
        }),
      ],
    };
  }
  const maxItems = Math.max(1, config.visibleTextExtraction.maxItems ?? 24);
  const visibleTexts: string[] = [];
  const diagnostics: CaptureDiagnostic[] = [];
  for (const ref of refs.slice(0, 2)) {
    const startedAt = new Date().toISOString();
    try {
      const binary = await macVisionOcrBinary();
      const result = await runCommand(binary, [ref.absPath], { timeoutMs: 30000 });
      diagnostics.push(commandDiagnostic(result.exitCode === 0 ? 'info' : 'warning', 'capture.visible-text.provider-result', {
        provider: MACOS_VISION_OCR_PROVIDER,
        captureScope: ref.captureScope ?? 'window',
        command: binary,
        args: [ref.path],
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timestamp: startedAt,
      }));
      if (result.exitCode !== 0) continue;
      visibleTexts.push(...parseMacVisionOcrLines(result.stdout));
    } catch (error) {
      diagnostics.push(diagnostic('warning', 'capture.visible-text.failed', error instanceof Error ? error.message : String(error), {
        provider: MACOS_VISION_OCR_PROVIDER,
        captureScope: ref.captureScope,
        timestamp: startedAt,
      }));
    }
    if (visibleTexts.length >= maxItems) break;
  }
  return {
    visibleTexts: uniqueVisibleTexts(visibleTexts).slice(0, maxItems),
    diagnostics,
  };
}

export async function createFocusedCropRefs(
  workspace: string,
  runDir: string,
  prefix: string,
  sourceRefs: ScreenshotRef[],
  focus: FocusRegion,
  config: ComputerUseConfig,
) {
  const refs: ScreenshotRef[] = [];
  for (const source of sourceRefs) {
    const sourceWidth = source.width ?? 1;
    const sourceHeight = source.height ?? 1;
    const region = {
      ...focus,
      sourceWidth,
      sourceHeight,
      sourceScreenshotRef: source.path,
    };
    const absPath = join(runDir, `${prefix}-focus-${source.id}.png`);
    const captureTimestamp = new Date().toISOString();
    const captureProvider = config.dryRun ? computerUseCaptureProviderIds.dryRunFocusRegionCopy : computerUseCaptureProviderIds.sipsFocusRegionCrop;
    const captureDiagnostics: CaptureDiagnostic[] = [
      diagnostic('info', 'capture.focus-region.start', `Creating coarse-to-fine focus crop around ${Math.round(focus.centerX)},${Math.round(focus.centerY)}.`, {
        provider: captureProvider,
        captureScope: 'focus-region',
        timestamp: captureTimestamp,
      }),
    ];
    if (config.dryRun) {
      await copyFile(source.absPath, absPath);
      captureDiagnostics.push(diagnostic('info', 'capture.focus-region.dry-run', 'Copied dry-run screenshot as focus-region crop placeholder.', {
        provider: captureProvider,
        captureScope: 'focus-region',
        timestamp: captureTimestamp,
      }));
    } else {
      const crop = await cropPngWithSips(source.absPath, absPath, region);
      captureDiagnostics.push(...crop.diagnostics);
      if (crop.exitCode !== 0) {
        await copyFile(source.absPath, absPath);
        captureDiagnostics.push(diagnostic('warning', computerUseCaptureDiagnostics.focusRegionFallbackCopy.code, computerUseCaptureDiagnostics.focusRegionFallbackCopy.message, {
          provider: captureProvider,
          captureScope: 'focus-region',
          timestamp: captureTimestamp,
        }));
      }
    }
    const stats = await stat(absPath);
    const bytes = await readFile(absPath);
    const dimensions = pngDimensions(bytes);
    refs.push({
      id: basename(absPath, '.png'),
      path: workspaceRel(workspace, absPath),
      absPath,
      displayId: source.displayId,
      windowTarget: source.windowTarget,
      captureScope: 'focus-region',
      captureProvider,
      captureTimestamp,
      diagnostics: [
        ...(source.diagnostics ?? []),
        `focus reason: ${focus.reason ?? 'vision-sense coarse-to-fine focus region'}`,
        ...captureDiagnostics.map((item) => item.message),
      ],
      captureDiagnostics,
      focusRegion: {
        ...region,
        sourceScreenshotRef: source.path,
        sourceWidth,
        sourceHeight,
      },
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
  }
  return refs;
}

async function cropPngWithSips(sourcePath: string, outPath: string, region: FocusRegion) {
  const args = [
    '--cropToHeightWidth',
    String(Math.max(1, Math.round(region.height))),
    String(Math.max(1, Math.round(region.width))),
    '--cropOffset',
    String(Math.max(0, Math.round(region.y))),
    String(Math.max(0, Math.round(region.x))),
    sourcePath,
    '--out',
    outPath,
  ];
  const result = await runCommand('sips', args, { timeoutMs: 15000 });
  return {
    ...result,
    diagnostics: [
      commandDiagnostic(result.exitCode === 0 ? 'info' : 'warning', computerUseCaptureDiagnostics.focusRegionProviderResult.code, {
        provider: computerUseCaptureProviderIds.sipsFocusRegionCrop,
        captureScope: 'focus-region',
        command: 'sips',
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    ],
  };
}

async function captureWindowScreenshot(absPath: string, targetResolution: ResolvedWindowTarget, config: ComputerUseConfig) {
  if (isDarwinPlatform(config.desktopPlatform) && targetResolution.windowId !== undefined) {
    const args = ['-x', '-l', String(targetResolution.windowId), absPath];
    let result = await runCommand('screencapture', args, { timeoutMs: 15000 });
    const attempts = [result];
    for (let attempt = 2; result.exitCode !== 0 && /could not create image from window|cannot create image|window/i.test(result.stderr || result.stdout) && attempt <= 4; attempt += 1) {
      await sleep(350 * attempt);
      result = await runCommand('screencapture', args, { timeoutMs: 15000 });
      attempts.push(result);
    }
    const stderr = attempts.map((item, index) => item.stderr ? `attempt ${index + 1}: ${item.stderr}` : '').filter(Boolean).join('\n');
    const stdout = attempts.map((item, index) => item.stdout ? `attempt ${index + 1}: ${item.stdout}` : '').filter(Boolean).join('\n');
    return {
      ...result,
      stdout: stdout || result.stdout,
      stderr: stderr || result.stderr,
      provider: computerUseCaptureProviderIds.macosWindowCapture,
      diagnostics: [
        commandDiagnostic(result.exitCode === 0 ? 'info' : 'error', computerUseCaptureDiagnostics.windowProviderResult.code, {
          provider: computerUseCaptureProviderIds.macosWindowCapture,
          captureScope: 'window',
          command: 'screencapture',
          args,
          exitCode: result.exitCode,
          stdout: stdout || result.stdout,
          stderr: stderr || result.stderr,
        }),
      ],
    };
  }
  const provider = windowCaptureProvider(targetResolution, config);
  return {
    exitCode: 125,
    stdout: '',
    stderr: computerUseCaptureDiagnostics.windowUnsupportedProvider.stderr,
    provider,
    diagnostics: [
      diagnostic('error', computerUseCaptureDiagnostics.windowUnsupportedProvider.code, computerUseCaptureDiagnostics.windowUnsupportedProvider.message, {
        provider,
        captureScope: 'window',
      }),
    ],
  };
}

function captureProviderName(config: ComputerUseConfig, scope: 'display' | 'window') {
  return computerUseCaptureProviderName({ desktopPlatform: config.desktopPlatform, captureScope: scope });
}

function windowCaptureProvider(targetResolution: ResolvedWindowTarget, config: ComputerUseConfig) {
  return computerUseWindowCaptureProvider({
    desktopPlatform: config.desktopPlatform,
    dryRun: config.dryRun,
    windowId: targetResolution.windowId,
  });
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

export function parseMacVisionOcrLines(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function uniqueVisibleTexts(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

async function macVisionOcrBinary() {
  macVisionOcrBinaryPromise ??= compileMacVisionOcrBinary();
  return macVisionOcrBinaryPromise;
}

async function compileMacVisionOcrBinary() {
  const buildDir = join(tmpdir(), `sciforge-visible-text-ocr-${randomUUID()}`);
  await mkdir(buildDir, { recursive: true });
  const scriptPath = join(buildDir, 'main.swift');
  const binaryPath = join(buildDir, 'sciforge-visible-text-ocr');
  await writeFile(scriptPath, macVisionOcrSwiftSource(), 'utf8');
  const result = await runCommand('swiftc', ['-framework', 'Vision', '-framework', 'AppKit', scriptPath, '-o', binaryPath], { timeoutMs: 30000 });
  await unlink(scriptPath).catch(() => undefined);
  if (result.exitCode !== 0) {
    throw new Error(`macOS Vision OCR helper compile failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
  }
  return binaryPath;
}

function macVisionOcrSwiftSource() {
  return `
import AppKit
import Foundation
import Vision

let path = CommandLine.arguments.dropFirst().first ?? ""
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("[]")
  exit(1)
}

let request = VNRecognizeTextRequest { request, error in
  if error != nil {
    print("[]")
    exit(2)
  }
  let values = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { observation in
    observation.topCandidates(1).first?.string
  }
  let data = try! JSONSerialization.data(withJSONObject: values, options: [])
  print(String(data: data, encoding: .utf8)!)
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 11.0, *) {
  request.recognitionLanguages = ["zh-Hans", "en-US"]
}
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])
`;
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
