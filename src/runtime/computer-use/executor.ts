import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computerUseExecutorBoundary,
  computerUseRealInputBlockReason,
  computerUseSystemEventsResultLine,
  computerUseUsesSharedSystemInput,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type { ComputerUseConfig, GenericSwiftGuiAction, GenericVisionAction, ResolvedWindowTarget, WindowTargetResolution } from './types.js';
import { acquireComputerUseSchedulerLease, computerUseSchedulerLockId, schedulerLeaseTrace } from './scheduler.js';
import { appleScriptString, isDarwinPlatform, runCommand, sleep } from './utils.js';

export async function executeGenericDesktopAction(action: GenericVisionAction, config: ComputerUseConfig, targetResolution: WindowTargetResolution) {
  if (!targetResolution.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: targetResolution.reason,
    };
  }
  const inputBlockReason = realInputBlockReason(action, config);
  if (inputBlockReason) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: inputBlockReason,
    };
  }
  const lease = await acquireComputerUseSchedulerLease({
    targetResolution,
    lockId: computerUseSchedulerLockId(targetResolution, { sharedSystemInput: usesSharedSystemInput(config) }),
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
      result = await executeGenericMacAction(action, config, targetResolution);
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

function usesSharedSystemInput(config: ComputerUseConfig) {
  return computerUseUsesSharedSystemInput(config);
}

export function executorBoundary(config: ComputerUseConfig) {
  return computerUseExecutorBoundary(config.desktopPlatform);
}

function realInputBlockReason(action: GenericVisionAction, config: ComputerUseConfig) {
  return computerUseRealInputBlockReason({
    actionType: action.type,
    desktopPlatform: config.desktopPlatform,
    dryRun: config.dryRun,
    inputAdapter: config.inputAdapter,
    allowSharedSystemInput: config.allowSharedSystemInput,
  });
}

async function executeGenericMacAction(action: GenericVisionAction, config: ComputerUseConfig, targetResolution: ResolvedWindowTarget) {
  if (action.type === 'open_app') {
    const appName = resolveAppAlias(action.appName);
    const openResult = await runCommand('open', ['-a', appName], { timeoutMs: 30000 });
    if (openResult.exitCode !== 0) return openResult;
    const activateResult = await activateMacApp(appName);
    return activateResult.exitCode === 0
      ? { ...activateResult, stdout: [openResult.stdout, activateResult.stdout, appName !== action.appName ? `app-alias ${action.appName} -> ${appName}` : ''].filter(Boolean).join('\n') }
      : {
          exitCode: activateResult.exitCode,
          stdout: [openResult.stdout, activateResult.stdout].filter(Boolean).join('\n'),
          stderr: activateResult.stderr || activateResult.stdout || `activate ${appName} failed with exit ${activateResult.exitCode}`,
        };
  }
  const isolation = await ensureMacInputTarget(action, targetResolution);
  if (isolation.exitCode !== 0) return isolation;
  if (action.type === 'scroll') {
    return executeSwiftGuiAction(action, targetResolution, Boolean(config.showVisualCursor));
  }
  if (action.type === 'click' || action.type === 'double_click' || action.type === 'drag') {
    const swiftResult = await executeSwiftGuiAction(action, targetResolution, Boolean(config.showVisualCursor));
    if (swiftResult.exitCode === 0) return swiftResult;
    const script = genericMacActionScript(action);
    const appleScriptResult = await runCommand('osascript', ['-e', script], { timeoutMs: 30000 });
    if (appleScriptResult.exitCode === 0) {
      return {
        ...appleScriptResult,
        stdout: [
          appleScriptResult.stdout,
          computerUseSystemEventsResultLine(action.type, config.showVisualCursor),
        ].filter(Boolean).join('\n'),
      };
    }
    return {
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

function resolveAppAlias(appName: string) {
  const aliases = parseAppAliases(process.env.SCIFORGE_VISION_APP_ALIASES_JSON);
  return aliases[appName] || aliases[appName.toLowerCase()] || appName;
}

function parseAppAliases(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
  } catch {
    return {};
  }
}

async function activateMacApp(appName: string, bundleId?: string) {
  let lastResult = { exitCode: 1, stdout: '', stderr: '' };
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const activationLine = bundleId
      ? `tell application id ${appleScriptString(bundleId)} to activate`
      : `tell application ${appleScriptString(appName)} to activate`;
    lastResult = await runCommand('osascript', ['-e', [
      activationLine,
      'delay 0.35',
      'tell application "System Events"',
      '  set frontProcess to first application process whose frontmost is true',
      '  set frontName to name of frontProcess',
      '  set frontBundle to bundle identifier of frontProcess',
      'end tell',
      'return frontName & "|" & frontBundle',
    ].join('\n')], { timeoutMs: 30000 });
    const frontmost = parseFrontmostProcess(lastResult.stdout);
    if (lastResult.exitCode === 0 && frontmostMatches(frontmost, appName, bundleId)) {
      return { ...lastResult, stdout: `frontmost=${frontmost.name || 'unknown'} bundle=${frontmost.bundleId || 'unknown'}` };
    }
    await sleep(250);
  }
  const frontmost = parseFrontmostProcess(lastResult.stdout);
  return {
    exitCode: lastResult.exitCode || 1,
    stdout: lastResult.stdout,
    stderr: lastResult.stderr || `App ${appName} did not become frontmost after open_app; frontmost=${frontmost.name || 'unknown'} bundle=${frontmost.bundleId || 'unknown'}`,
  };
}

async function ensureMacInputTarget(action: GenericVisionAction, targetResolution: ResolvedWindowTarget) {
  if (targetResolution.captureKind !== 'window') return { exitCode: 0, stdout: 'input-isolation=display-fallback', stderr: '' };
  if (action.type === 'wait') return { exitCode: 0, stdout: 'input-isolation=not-required-for-wait', stderr: '' };
  if (targetResolution.focused && targetResolution.inputIsolation === 'require-focused-target') {
    return {
      exitCode: 0,
      stdout: `input-isolation=focused-target resolved-window app=${targetResolution.appName ?? 'unknown'} bundle=${targetResolution.bundleId ?? 'unknown'}`,
      stderr: '',
    };
  }
  if (targetResolution.appName) {
    const activateResult = await activateMacApp(targetResolution.appName, targetResolution.bundleId);
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
  const frontmost = await runCommand('osascript', ['-e', [
    'tell application "System Events"',
    '  set frontProcess to first application process whose frontmost is true',
    '  set frontName to name of frontProcess',
    '  set frontBundle to bundle identifier of frontProcess',
    'end tell',
    'return frontName & "|" & frontBundle',
  ].join('\n')], { timeoutMs: 10000 });
  const frontmostProcess = parseFrontmostProcess(frontmost.stdout);
  if (frontmost.exitCode === 0 && frontmostMatches(frontmostProcess, targetResolution.appName, targetResolution.bundleId)) {
    return { exitCode: 0, stdout: `input-isolation=focused-target frontmost=${frontmostProcess.name || 'unknown'} bundle=${frontmostProcess.bundleId || 'unknown'}`, stderr: '' };
  }
  return {
    exitCode: 125,
    stdout: frontmost.stdout,
    stderr: [
      'Input isolation blocked Computer Use action because the focused window/app did not match the target window contract.',
      `expectedApp=${targetResolution.appName ?? 'unknown'} expectedBundle=${targetResolution.bundleId ?? 'unknown'} frontmost=${frontmostProcess.name || 'unknown'} frontmostBundle=${frontmostProcess.bundleId || 'unknown'}`,
    ].join(' '),
  };
}

function parseFrontmostProcess(stdout: string) {
  const [name = '', bundleId = ''] = stdout.trim().split('|');
  return { name: name.trim(), bundleId: bundleId.trim() };
}

function frontmostMatches(frontmost: { name?: string; bundleId?: string }, appName?: string, bundleId?: string) {
  if (bundleId && frontmost.bundleId && frontmost.bundleId.toLowerCase() === bundleId.toLowerCase()) return true;
  if (!appName || !frontmost.name) return false;
  return frontmost.name.toLowerCase() === appName.toLowerCase();
}

async function executeSwiftGuiAction(action: GenericSwiftGuiAction, targetResolution: ResolvedWindowTarget, showVisualCursor: boolean) {
  const scriptPath = join(tmpdir(), `sciforge-gui-${randomUUID()}.swift`);
  await writeFile(scriptPath, swiftGuiActionScript(action, targetResolution, showVisualCursor), 'utf8');
  try {
    return await runSwiftGuiScript(scriptPath);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

async function runSwiftGuiScript(scriptPath: string) {
  const interpreted = await runCommand('swift', [scriptPath], { timeoutMs: 30000 });
  if (interpreted.exitCode === 0) return interpreted;
  const stderr = `${interpreted.stderr}\n${interpreted.stdout}`;
  if (!/AppKit|NSApplication|NSWindow|NSView|JIT session error|Symbols not found/i.test(stderr)) return interpreted;
  const buildDir = join(tmpdir(), `sciforge-gui-build-${randomUUID()}`);
  const binaryPath = join(buildDir, 'sciforge-gui-action');
  await mkdir(buildDir, { recursive: true });
  try {
    const compile = await runCommand('swiftc', ['-framework', 'AppKit', '-framework', 'CoreGraphics', scriptPath, '-o', binaryPath], { timeoutMs: 30000 });
    if (compile.exitCode !== 0) {
      return {
        exitCode: compile.exitCode,
        stdout: [interpreted.stdout, compile.stdout].filter(Boolean).join('\n'),
        stderr: [interpreted.stderr, compile.stderr].filter(Boolean).join('\n'),
      };
    }
    const executed = await runCommand(binaryPath, [], { timeoutMs: 30000 });
    return {
      exitCode: executed.exitCode,
      stdout: [interpreted.stdout, executed.stdout].filter(Boolean).join('\n'),
      stderr: executed.stderr,
    };
  } finally {
    await unlink(binaryPath).catch(() => undefined);
  }
}

function swiftGuiActionScript(action: GenericSwiftGuiAction, targetResolution: ResolvedWindowTarget, showVisualCursor: boolean) {
  if (action.type === 'scroll') return swiftScrollActionScript(action, targetResolution, showVisualCursor);
  const clickCount = action.type === 'double_click' ? 2 : 1;
  const point = action.type === 'drag'
    ? { x: requiredCoordinate(action.fromX, 'fromX'), y: requiredCoordinate(action.fromY, 'fromY') }
    : { x: requiredCoordinate(action.x, 'x'), y: requiredCoordinate(action.y, 'y') };
  const dragTo = action.type === 'drag'
    ? { x: requiredCoordinate(action.toX, 'toX'), y: requiredCoordinate(action.toY, 'toY') }
    : undefined;
  const actionBody = dragTo
    ? `postMove(${point.x}, ${point.y})
usleep(50000)
let start = CGPoint(x: ${point.x}, y: ${point.y})
let end = CGPoint(x: ${dragTo.x}, y: ${dragTo.y})
CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
print("swift-cgevent drag ${point.x},${point.y} -> ${dragTo.x},${dragTo.y} visualCursor=${showVisualCursor ? 'shown' : 'off'}")`
    : `postMove(${point.x}, ${point.y})
${Array.from({ length: clickCount }, () => `postClick(${point.x}, ${point.y})`).join('\n')}
print("swift-cgevent ${action.type} ${point.x},${point.y} visualCursor=${showVisualCursor ? 'shown' : 'off'}")`;
  return showVisualCursor
    ? swiftVisualCursorScript({ x: point.x, y: point.y, toX: dragTo?.x, toY: dragTo?.y }, actionBody)
    : `
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

${actionBody}
`;
}

function swiftScrollActionScript(action: Extract<GenericVisionAction, { type: 'scroll' }>, targetResolution: ResolvedWindowTarget, showVisualCursor: boolean) {
  const amount = Math.max(1, Math.round(action.amount ?? 5));
  const pixelDelta = amount * 120;
  const vertical = action.direction === 'up' ? pixelDelta : action.direction === 'down' ? -pixelDelta : 0;
  const horizontal = action.direction === 'left' ? pixelDelta : action.direction === 'right' ? -pixelDelta : 0;
  const center = targetWindowCenter(targetResolution);
  const actionBody = `
let location = CGPoint(x: ${center.x}, y: ${center.y})
CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(50000)
let event = CGEvent(
  scrollWheelEvent2Source: source,
  units: .pixel,
  wheelCount: 2,
  wheel1: Int32(${vertical}),
  wheel2: Int32(${horizontal}),
  wheel3: 0
)
event?.location = location
event?.post(tap: .cghidEventTap)
print("swift-cgevent scroll ${action.direction} ${amount} at ${center.x},${center.y} visualCursor=${showVisualCursor ? 'shown' : 'off'}")
`;
  return showVisualCursor
    ? swiftVisualCursorScript({ x: center.x, y: center.y }, actionBody)
    : `
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)
let location = CGPoint(x: ${center.x}, y: ${center.y})
${actionBody}
`;
}

function swiftVisualCursorScript(point: { x: number; y: number; toX?: number; toY?: number }, actionBody: string) {
  return `
import AppKit
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

func appKitPoint(cgX: Double, cgY: Double) -> CGPoint {
  for screen in NSScreen.screens {
    let frame = screen.frame
    if cgX >= frame.minX && cgX <= frame.maxX {
      let convertedY = frame.maxY - cgY
      if convertedY >= frame.minY && convertedY <= frame.maxY {
        return CGPoint(x: cgX, y: convertedY)
      }
    }
  }
  let frame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
  return CGPoint(x: cgX, y: frame.maxY - cgY)
}

class SciForgeCursorView: NSView {
  override func draw(_ dirtyRect: NSRect) {
    NSColor.clear.setFill()
    dirtyRect.fill()
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    NSColor(calibratedRed: 0.0, green: 1.0, blue: 0.85, alpha: 0.92).setFill()
    NSColor(calibratedRed: 1.0, green: 0.18, blue: 0.55, alpha: 0.98).setStroke()
    let diamond = NSBezierPath()
    diamond.move(to: CGPoint(x: center.x, y: center.y + 18))
    diamond.line(to: CGPoint(x: center.x + 18, y: center.y))
    diamond.line(to: CGPoint(x: center.x, y: center.y - 18))
    diamond.line(to: CGPoint(x: center.x - 18, y: center.y))
    diamond.close()
    diamond.fill()
    diamond.lineWidth = 4
    diamond.stroke()
    NSColor.white.setStroke()
    let crosshair = NSBezierPath()
    crosshair.move(to: CGPoint(x: center.x - 24, y: center.y))
    crosshair.line(to: CGPoint(x: center.x + 24, y: center.y))
    crosshair.move(to: CGPoint(x: center.x, y: center.y - 24))
    crosshair.line(to: CGPoint(x: center.x, y: center.y + 24))
    crosshair.lineWidth = 2
    crosshair.stroke()
    let label = "SciForge"
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.boldSystemFont(ofSize: 14),
      .foregroundColor: NSColor.white,
      .backgroundColor: NSColor(calibratedRed: 0.0, green: 0.0, blue: 0.0, alpha: 0.72)
    ]
    label.draw(at: CGPoint(x: center.x - 31, y: center.y - 46), withAttributes: attributes)
  }
}

let cursorPoint = appKitPoint(cgX: ${point.x}, cgY: ${point.y})
let size = CGSize(width: 116, height: 124)
let window = NSWindow(
  contentRect: CGRect(x: cursorPoint.x - size.width / 2, y: cursorPoint.y - size.height / 2, width: size.width, height: size.height),
  styleMask: [.borderless],
  backing: .buffered,
  defer: false
)
window.isOpaque = false
window.backgroundColor = .clear
window.level = .screenSaver
window.ignoresMouseEvents = true
window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
window.contentView = SciForgeCursorView(frame: CGRect(origin: .zero, size: size))
window.orderFrontRegardless()

DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) {
${indentSwift(actionBody, '  ')}
}
DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
  NSApp.terminate(nil)
}
NSApplication.shared.setActivationPolicy(.accessory)
NSApp.run()
`;
}

function indentSwift(value: string, prefix: string) {
  return value.trim().split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function targetWindowCenter(targetResolution: ResolvedWindowTarget) {
  const bounds = targetResolution.contentRect ?? targetResolution.bounds;
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
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
    lines.push('  set previousClipboard to the clipboard');
    lines.push(`  set the clipboard to ${appleScriptString(action.text)}`);
    lines.push('  keystroke "v" using {command down}');
    lines.push('  delay 0.1');
    lines.push('  set the clipboard to previousClipboard');
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
    pagedown: 121,
    page_down: 121,
    'page down': 121,
    pageup: 116,
    page_up: 116,
    'page up': 116,
    home: 115,
    end: 119,
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
