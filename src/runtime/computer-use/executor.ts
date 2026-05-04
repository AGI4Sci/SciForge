import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComputerUseConfig, GenericSwiftGuiAction, GenericVisionAction, ResolvedWindowTarget, WindowTargetResolution } from './types.js';
import { acquireComputerUseSchedulerLease, schedulerLeaseTrace } from './scheduler.js';
import { appleScriptString, isDarwinPlatform, runCommand, sanitizeId, sleep } from './utils.js';

export async function executeGenericDesktopAction(action: GenericVisionAction, config: ComputerUseConfig, targetResolution: WindowTargetResolution) {
  if (!targetResolution.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: targetResolution.reason,
    };
  }
  const lease = await acquireComputerUseSchedulerLease({
    targetResolution,
    runId: config.runId,
    stepId: action.type,
    timeoutMs: config.schedulerLockTimeoutMs,
    staleMs: config.schedulerStaleLockMs,
  });
  if (!lease.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: lease.reason,
      schedulerLease: {
        mode: 'real-gui-executor-lock',
        lockId: lease.lockId,
        lockPath: lease.lockPath,
        waitMs: lease.waitMs,
        status: 'timeout',
        reason: lease.reason,
      },
    };
  }
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    if (isDarwinPlatform(config.desktopPlatform)) {
      result = await executeGenericMacAction(action, targetResolution);
    } else {
      result = {
        exitCode: 126,
        stdout: '',
        stderr: [
          `No real generic GUI executor is configured for desktopPlatform="${config.desktopPlatform}".`,
          'Set visionSense.desktopPlatform to a supported local executor platform, enable dryRun, or add an executor adapter for this platform.',
        ].join(' '),
      };
    }
  } finally {
    await lease.release();
  }
  return { ...result, schedulerLease: schedulerLeaseTrace(lease.lease) };
}

export function executorBoundary(config: ComputerUseConfig) {
  if (isDarwinPlatform(config.desktopPlatform)) return 'darwin-system-events-generic-gui-executor';
  return `${sanitizeId(config.desktopPlatform).toLowerCase()}-generic-gui-executor`;
}

async function executeGenericMacAction(action: GenericVisionAction, targetResolution: ResolvedWindowTarget) {
  if (action.type === 'open_app') {
    const openResult = await runCommand('open', ['-a', action.appName], { timeoutMs: 30000 });
    if (openResult.exitCode !== 0) return openResult;
    const activateResult = await activateMacApp(action.appName);
    return activateResult.exitCode === 0
      ? { ...activateResult, stdout: [openResult.stdout, activateResult.stdout].filter(Boolean).join('\n') }
      : {
          exitCode: activateResult.exitCode,
          stdout: [openResult.stdout, activateResult.stdout].filter(Boolean).join('\n'),
          stderr: activateResult.stderr || activateResult.stdout || `activate ${action.appName} failed with exit ${activateResult.exitCode}`,
        };
  }
  const isolation = await ensureMacInputTarget(action, targetResolution);
  if (isolation.exitCode !== 0) return isolation;
  if (action.type === 'click' || action.type === 'double_click' || action.type === 'drag' || action.type === 'scroll') {
    const swiftResult = await executeSwiftGuiAction(action);
    if (swiftResult.exitCode === 0) return swiftResult;
    const script = genericMacActionScript(action);
    const appleScriptResult = await runCommand('osascript', ['-e', script], { timeoutMs: 30000 });
    return appleScriptResult.exitCode === 0
      ? { ...appleScriptResult, stdout: [swiftResult.stdout, appleScriptResult.stdout].filter(Boolean).join('\n') }
      : {
          exitCode: appleScriptResult.exitCode,
          stdout: [swiftResult.stdout, appleScriptResult.stdout].filter(Boolean).join('\n'),
          stderr: [
            `Swift CGEvent executor failed: ${swiftResult.stderr || swiftResult.stdout || `exit ${swiftResult.exitCode}`}`,
            `System Events executor failed: ${appleScriptResult.stderr || appleScriptResult.stdout || `exit ${appleScriptResult.exitCode}`}`,
          ].join('\n'),
        };
  }
  const script = genericMacActionScript(action);
  return runCommand('osascript', ['-e', script], { timeoutMs: action.type === 'wait' ? Math.max(1000, (action.ms ?? 500) + 1000) : 30000 });
}

async function activateMacApp(appName: string) {
  let lastResult = { exitCode: 1, stdout: '', stderr: '' };
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    lastResult = await runCommand('osascript', ['-e', [
      `tell application ${appleScriptString(appName)} to activate`,
      'delay 0.35',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ].join('\n')], { timeoutMs: 30000 });
    const frontmost = lastResult.stdout.trim();
    if (lastResult.exitCode === 0 && frontmost === appName) {
      return { ...lastResult, stdout: `frontmost=${frontmost}` };
    }
    await sleep(250);
  }
  return {
    exitCode: lastResult.exitCode || 1,
    stdout: lastResult.stdout,
    stderr: lastResult.stderr || `App ${appName} did not become frontmost after open_app; frontmost=${lastResult.stdout.trim() || 'unknown'}`,
  };
}

async function ensureMacInputTarget(action: GenericVisionAction, targetResolution: ResolvedWindowTarget) {
  if (targetResolution.captureKind !== 'window') return { exitCode: 0, stdout: 'input-isolation=display-fallback', stderr: '' };
  if (action.type === 'wait') return { exitCode: 0, stdout: 'input-isolation=not-required-for-wait', stderr: '' };
  if (targetResolution.appName) {
    const activateResult = await activateMacApp(targetResolution.appName);
    if (activateResult.exitCode !== 0 && targetResolution.inputIsolation === 'require-focused-target') {
      return {
        exitCode: 125,
        stdout: activateResult.stdout,
        stderr: [
          'Input isolation failed before executing Computer Use action.',
          activateResult.stderr || `Could not focus target app ${targetResolution.appName}.`,
        ].join(' '),
      };
    }
  }
  if (targetResolution.inputIsolation !== 'require-focused-target') {
    return { exitCode: 0, stdout: 'input-isolation=best-effort', stderr: '' };
  }
  if (!targetResolution.appName) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: 'Input isolation requires a target appName so the scheduler can verify focus before sending mouse/keyboard events.',
    };
  }
  const frontmost = await runCommand('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeoutMs: 10000 });
  const frontmostApp = frontmost.stdout.trim();
  if (frontmost.exitCode === 0 && frontmostApp === targetResolution.appName) {
    return { exitCode: 0, stdout: `input-isolation=focused-target frontmost=${frontmostApp || 'unknown'}`, stderr: '' };
  }
  return {
    exitCode: 125,
    stdout: frontmost.stdout,
    stderr: [
      'Input isolation blocked Computer Use action because the focused window/app did not match the target window contract.',
      `expectedApp=${targetResolution.appName ?? 'unknown'} frontmost=${frontmostApp || 'unknown'}`,
    ].join(' '),
  };
}

async function executeSwiftGuiAction(action: GenericSwiftGuiAction) {
  const scriptPath = join(tmpdir(), `sciforge-gui-${randomUUID()}.swift`);
  await writeFile(scriptPath, swiftGuiActionScript(action), 'utf8');
  try {
    return await runCommand('swift', [scriptPath], { timeoutMs: 30000 });
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function swiftGuiActionScript(action: GenericSwiftGuiAction) {
  if (action.type === 'scroll') return swiftScrollActionScript(action);
  const clickCount = action.type === 'double_click' ? 2 : 1;
  const point = action.type === 'drag'
    ? { x: requiredCoordinate(action.fromX, 'fromX'), y: requiredCoordinate(action.fromY, 'fromY') }
    : { x: requiredCoordinate(action.x, 'x'), y: requiredCoordinate(action.y, 'y') };
  const dragTo = action.type === 'drag'
    ? { x: requiredCoordinate(action.toX, 'toX'), y: requiredCoordinate(action.toY, 'toY') }
    : undefined;
  return `
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)

func postMove(_ x: Double, _ y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func postClick(_ x: Double, _ y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(50000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

${dragTo
    ? `postMove(${point.x}, ${point.y})
usleep(50000)
let start = CGPoint(x: ${point.x}, y: ${point.y})
let end = CGPoint(x: ${dragTo.x}, y: ${dragTo.y})
CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
print("swift-cgevent drag ${point.x},${point.y} -> ${dragTo.x},${dragTo.y}")`
    : `postMove(${point.x}, ${point.y})
${Array.from({ length: clickCount }, () => `postClick(${point.x}, ${point.y})`).join('\n')}
print("swift-cgevent ${action.type} ${point.x},${point.y}")`}
`;
}

function swiftScrollActionScript(action: Extract<GenericVisionAction, { type: 'scroll' }>) {
  const amount = Math.max(1, Math.round(action.amount ?? 5));
  const pixelDelta = amount * 120;
  const vertical = action.direction === 'up' ? pixelDelta : action.direction === 'down' ? -pixelDelta : 0;
  const horizontal = action.direction === 'left' ? pixelDelta : action.direction === 'right' ? -pixelDelta : 0;
  return `
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)
CGEvent(
  scrollWheelEvent2Source: source,
  units: .pixel,
  wheelCount: 2,
  wheel1: Int32(${vertical}),
  wheel2: Int32(${horizontal}),
  wheel3: 0
)?.post(tap: .cghidEventTap)
print("swift-cgevent scroll ${action.direction} ${amount}")
`;
}

function genericMacActionScript(action: GenericVisionAction) {
  if (action.type === 'wait') return `delay ${Math.max(0, action.ms ?? 500) / 1000}`;
  const lines = [
    'tell application "System Events"',
  ];
  if (action.type === 'click') {
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
  } else if (action.type === 'double_click') {
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
  } else if (action.type === 'drag') {
    lines.push(`  mouse down at {${Math.round(requiredCoordinate(action.fromX, 'fromX'))}, ${Math.round(requiredCoordinate(action.fromY, 'fromY'))}}`);
    lines.push('  delay 0.1');
    lines.push(`  mouse up at {${Math.round(requiredCoordinate(action.toX, 'toX'))}, ${Math.round(requiredCoordinate(action.toY, 'toY'))}}`);
  } else if (action.type === 'type_text') {
    lines.push(`  keystroke ${appleScriptString(action.text)}`);
  } else if (action.type === 'press_key') {
    lines.push(`  ${keyStrokeScript(action.key)}`);
  } else if (action.type === 'hotkey') {
    const key = action.keys[action.keys.length - 1] || '';
    const modifiers = action.keys.slice(0, -1).map(appleScriptModifier).filter(Boolean);
    lines.push(`  ${keyStrokeScript(key, modifiers)}`);
  } else if (action.type === 'scroll') {
    if (action.direction === 'up') {
      lines.push('  key code 116');
    } else if (action.direction === 'down') {
      lines.push('  key code 121');
    } else if (action.direction === 'left') {
      lines.push('  key code 123');
    } else {
      lines.push('  key code 124');
    }
  }
  lines.push('end tell');
  return lines.join('\n');
}

function requiredCoordinate(value: number | undefined, name: string) {
  if (typeof value !== 'number') throw new Error(`Executable Computer Use action is missing ${name}`);
  return value;
}

function keyStrokeScript(key: string, modifiers: string[] = []) {
  const normalized = key.toLowerCase();
  const keyCodes: Record<string, number> = {
    return: 36,
    enter: 36,
    tab: 48,
    escape: 53,
    esc: 53,
    delete: 51,
    backspace: 51,
    space: 49,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
  };
  const code = keyCodes[normalized];
  const modifierSuffix = modifiers.length ? ` using {${modifiers.join(', ')}}` : '';
  return code !== undefined
    ? `key code ${code}${modifierSuffix}`
    : `keystroke ${appleScriptString(key)}${modifierSuffix}`;
}

function appleScriptModifier(key: string) {
  const normalized = key.toLowerCase();
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return 'command down';
  if (normalized === 'shift') return 'shift down';
  if (normalized === 'option' || normalized === 'alt') return 'option down';
  if (normalized === 'ctrl' || normalized === 'control') return 'control down';
  return '';
}
