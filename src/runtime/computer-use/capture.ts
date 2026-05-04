import { readFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { ComputerUseConfig, ResolvedWindowTarget, ScreenshotRef, WindowTargetResolution } from './types.js';
import { toTraceScreenshotRef } from './types.js';
import { isDarwinPlatform, pngDimensions, runCommand, sha256, workspaceRel } from './utils.js';
import { toTraceWindowTarget } from './window-target.js';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);

export async function captureDisplays(
  workspace: string,
  runDir: string,
  prefix: string,
  config: ComputerUseConfig,
  targetResolution: WindowTargetResolution,
) {
  const refs: ScreenshotRef[] = [];
  if (targetResolution.ok && targetResolution.captureKind === 'window') {
    const displayId = config.captureDisplays[0] ?? 1;
    const absPath = join(runDir, `${prefix}-window-${targetResolution.windowId ?? 'active'}.png`);
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
    } else {
      const result = await captureWindowScreenshot(absPath, targetResolution, config);
      if (result.exitCode !== 0) {
        throw new Error(`target window capture failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
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
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
    return refs;
  }

  for (const displayId of config.captureDisplays) {
    const absPath = join(runDir, `${prefix}-display-${displayId}.png`);
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
    } else {
      const result = await runCommand('screencapture', ['-x', '-D', String(displayId), absPath], { timeoutMs: 15000 });
      if (result.exitCode !== 0) {
        throw new Error(`screencapture display ${displayId} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
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
    return runCommand('screencapture', ['-x', '-l', String(targetResolution.windowId), absPath], { timeoutMs: 15000 });
  }
  return {
    exitCode: 125,
    stdout: '',
    stderr: 'Target-window capture requires a resolved windowId for the configured desktop platform.',
  };
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
