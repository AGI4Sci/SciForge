import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { VirtualDisplayProviderProbeOptions } from '../virtual-display-provider.js';

export interface MacosDisplayInventoryEntry {
  id: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  main: boolean;
}

export interface MacosAxWindowInventoryEntry {
  pid: number;
  windowIndex: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MacosCgWindowInventoryEntry {
  pid: number;
  windowNumber: number;
  ownerName: string;
  title: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MacosDisplayFrameCapture {
  frameRef: string;
  screenshotRef: string;
  frameRecord: Record<string, unknown>;
}

export interface MacosAxWindowMoveResult {
  ok: boolean;
  stdout: string;
  targetBounds: Record<string, number>;
}

export interface MacosNativeDriverCommandRunner {
  execFileSync(command: string, args: string[], options?: Parameters<typeof execFileSync>[2]): Buffer | string;
  execFile(command: string, args: string[], options?: Parameters<typeof execFile>[2]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
}

const execFileAsync = promisify(execFile);

export const macosNativeDriverCommandRunner: MacosNativeDriverCommandRunner = {
  execFileSync: (command, args, options) => execFileSync(command, args, options),
  execFile: (command, args, options) => execFileAsync(command, args, options) as Promise<{ stdout: string | Buffer; stderr: string | Buffer }>,
};

export function commandExists(
  command: string,
  options: VirtualDisplayProviderProbeOptions = {},
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
) {
  const injected = options.commandAvailability?.[command];
  if (injected !== undefined) return injected;
  try {
    runner.execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function probeMacosAccessibility(
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): { ok: boolean; detail?: string } {
  try {
    const stdout = runOsascript(ACCESSIBILITY_PROBE_APPLESCRIPT, [], runner);
    return { ok: Number(String(stdout).trim()) >= 1 };
  } catch (error) {
    return { ok: false, detail: shortError(error) };
  }
}

export function listMacosDisplays(
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): MacosDisplayInventoryEntry[] {
  const stdout = runner.execFileSync('swift', ['-'], {
    input: DISPLAY_INVENTORY_SWIFT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  const parsed = JSON.parse(String(stdout)) as {
    error?: number;
    displays?: MacosDisplayInventoryEntry[];
  };
  if (parsed.error !== 0) throw new Error(`CGGetOnlineDisplayList failed with ${parsed.error}`);
  return Array.isArray(parsed.displays) ? parsed.displays : [];
}

export async function captureMacosDisplayFrame(params: {
  outDir: string;
  runDirRef: string;
  phase: string;
  display: MacosDisplayInventoryEntry;
  providerId: string;
  runner?: Pick<MacosNativeDriverCommandRunner, 'execFile'>;
}): Promise<MacosDisplayFrameCapture> {
  const runner = params.runner ?? macosNativeDriverCommandRunner;
  const frameRef = `${params.runDirRef}/virtual-display-provider/frames/${params.phase}.json`;
  const screenshotRef = `${params.runDirRef}/virtual-display-provider/frames/${params.phase}.png`;
  const screenshotPath = localPathForRef(params.outDir, params.runDirRef, screenshotRef);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await runner.execFile('screencapture', ['-x', '-D', String(params.display.index), screenshotPath], { timeout: 15000 });
  const screenshotStat = await stat(screenshotPath);
  if (screenshotStat.size <= 0) throw new Error(`${params.phase} capture was empty`);
  const digest = createHash('sha256').update(await readFile(screenshotPath)).digest('hex');
  const frameRecord = {
    schemaVersion: 'sciforge.computer-use.screen-frame.v1',
    ref: frameRef,
    role: params.phase,
    providerId: params.providerId,
    screenRef: `${params.runDirRef}/virtual-display-provider/screen.json`,
    screenshotRef,
    screenshotBytes: screenshotStat.size,
    screenshotSha256: digest,
    captureTool: 'screencapture',
    captureDisplayIndex: params.display.index,
    displayIdentity: params.display,
    currentRunOnly: true,
  };
  return { frameRef, screenshotRef, frameRecord };
}

export function inventoryMacosAxWindows(
  pids: number[],
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): MacosAxWindowInventoryEntry[] {
  const stdout = runOsascript(AX_WINDOW_INVENTORY_APPLESCRIPT, pids.map(String), runner);
  return String(stdout)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, windowIndex, title, x, y, width, height] = line.split('\t');
      return {
        pid: Number(pid),
        windowIndex: Number(windowIndex),
        title: title ?? '',
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
      };
    })
    .filter((entry) => Number.isInteger(entry.pid) && Number.isInteger(entry.windowIndex));
}

export async function waitForMacosAxWindows(
  pids: number[],
  timeoutMs: number,
  deps: {
    inventory?: (pids: number[]) => MacosAxWindowInventoryEntry[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MacosAxWindowInventoryEntry[]> {
  const startedAt = Date.now();
  const inventory = deps.inventory ?? ((targetPids) => inventoryMacosAxWindows(targetPids));
  const sleepFn = deps.sleep ?? sleep;
  let windows: MacosAxWindowInventoryEntry[] = [];
  do {
    windows = inventory(pids);
    if (windows.some((window) => pids.includes(window.pid))) return windows;
    await sleepFn(500);
  } while (Date.now() - startedAt < timeoutMs);
  return windows;
}

export function inventoryMacosCgWindows(
  pids: number[],
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): MacosCgWindowInventoryEntry[] {
  const stdout = runner.execFileSync('swift', ['-', ...pids.map(String)], {
    input: CG_WINDOW_INVENTORY_SWIFT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  const parsed = JSON.parse(String(stdout)) as {
    windows?: MacosCgWindowInventoryEntry[];
  };
  return Array.isArray(parsed.windows) ? parsed.windows : [];
}

export async function waitForMacosCgWindow(
  pids: number[],
  timeoutMs: number,
  deps: {
    inventory?: (pids: number[]) => MacosCgWindowInventoryEntry[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MacosCgWindowInventoryEntry | undefined> {
  const startedAt = Date.now();
  const inventory = deps.inventory ?? ((targetPids) => inventoryMacosCgWindows(targetPids));
  const sleepFn = deps.sleep ?? sleep;
  let windows: MacosCgWindowInventoryEntry[] = [];
  do {
    windows = inventory(pids);
    const targetWindow = selectMacosCgTargetWindow(windows);
    if (targetWindow) return targetWindow;
    await sleepFn(500);
  } while (Date.now() - startedAt < timeoutMs);
  return selectMacosCgTargetWindow(windows);
}

export function selectMacosCgTargetWindow(windows: MacosCgWindowInventoryEntry[]): MacosCgWindowInventoryEntry | undefined {
  const visibleWindows = windows
    .filter((window) => window.layer === 0 && window.width >= 200 && window.height >= 120)
    .sort((left, right) => (right.width * right.height) - (left.width * left.height));
  return visibleWindows[0];
}

export function moveMacosAxWindow(
  window: MacosAxWindowInventoryEntry,
  display: MacosDisplayInventoryEntry,
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): MacosAxWindowMoveResult {
  const margin = 32;
  const targetBounds = {
    x: display.x + margin,
    y: display.y + margin,
    width: Math.max(320, display.width - margin * 2),
    height: Math.max(240, display.height - margin * 2),
  };
  try {
    const stdout = runCompiledSwiftHelper('ax-move', AX_MOVE_WINDOW_SWIFT, [
      String(window.pid),
      String(window.windowIndex),
      String(Math.round(targetBounds.x)),
      String(Math.round(targetBounds.y)),
      String(Math.round(targetBounds.width)),
      String(Math.round(targetBounds.height)),
    ], runner);
    const parsed = JSON.parse(String(stdout)) as { ok?: boolean; status?: string; error?: string };
    return { ok: parsed.ok === true, stdout: parsed.status ?? parsed.error ?? String(stdout).trim(), targetBounds };
  } catch (error) {
    return { ok: false, stdout: shortError(error), targetBounds };
  }
}

export function runCompiledSwiftHelper(
  name: string,
  source: string,
  args: string[],
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): string {
  const helperDir = mkdtempSync(join(tmpdir(), `sciforge-${name}-`));
  try {
    const sourcePath = join(helperDir, `${name}.swift`);
    const binaryPath = join(helperDir, name);
    writeFileSync(sourcePath, source, 'utf8');
    runner.execFileSync('swiftc', ['-framework', 'ApplicationServices', sourcePath, '-o', binaryPath], {
      stdio: 'ignore',
      timeout: 20000,
    });
    return String(runner.execFileSync(binaryPath, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000,
    }));
  } finally {
    rmSync(helperDir, { recursive: true, force: true });
  }
}

export function windowWithinDisplay(
  window: Pick<MacosCgWindowInventoryEntry, 'x' | 'y' | 'width' | 'height'>,
  display: MacosDisplayInventoryEntry,
): boolean {
  const inset = 8;
  const windowLeft = window.x;
  const windowTop = window.y;
  const windowRight = window.x + Math.min(window.width, 80);
  const windowBottom = window.y + Math.min(window.height, 80);
  return windowLeft >= display.x - inset
    && windowTop >= display.y - inset
    && windowRight <= display.x + display.width + inset
    && windowBottom <= display.y + display.height + inset;
}

export function runOsascript(
  script: string,
  args: string[],
  runner: Pick<MacosNativeDriverCommandRunner, 'execFileSync'> = macosNativeDriverCommandRunner,
): string {
  return String(runner.execFileSync('osascript', ['-', ...args], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  }));
}

export function providerLifecycleOperationRecord(input: {
  operation: string;
  providerId: string;
  refs: Record<string, string | string[] | undefined>;
  readiness?: Record<string, unknown>;
  blockedReason?: string;
  mutatingActionExecuted?: boolean;
}) {
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent: input.operation,
    providerId: input.providerId,
    status: input.blockedReason ? 'blocked' : 'ready',
    refs: input.refs,
    readiness: input.readiness,
    blockedReason: input.blockedReason,
    providerExecuted: true,
    mutatingActionExecuted: input.mutatingActionExecuted === true,
    rawPayloadWritten: false,
    currentRunOnly: true,
  };
}

export function localPathForRef(outDir: string, runDirRef: string, ref: string): string {
  if (!ref.startsWith(`${runDirRef}/`)) return join(outDir, ref.replace(/[^a-zA-Z0-9._/-]+/g, '_'));
  return join(outDir, relative(runDirRef, ref));
}

export async function writeJsonRef(outDir: string, runDirRef: string, ref: string, data: unknown): Promise<void> {
  const path = localPathForRef(outDir, runDirRef, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function shortError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

const DISPLAY_INVENTORY_SWIFT = `
import CoreGraphics
import Foundation

let maxDisplays: UInt32 = 32
var displayIds = [CGDirectDisplayID](repeating: 0, count: Int(maxDisplays))
var displayCount: UInt32 = 0
let error = CGGetOnlineDisplayList(maxDisplays, &displayIds, &displayCount)
var displays = [[String: Any]]()
for index in 0..<Int(displayCount) {
  let displayId = displayIds[index]
  let bounds = CGDisplayBounds(displayId)
  displays.append([
    "id": Int(displayId),
    "index": index + 1,
    "x": Int(bounds.origin.x),
    "y": Int(bounds.origin.y),
    "width": Int(bounds.size.width),
    "height": Int(bounds.size.height),
    "main": CGDisplayIsMain(displayId) != 0
  ])
}
let output: [String: Any] = ["error": Int(error.rawValue), "displays": displays]
let data = try JSONSerialization.data(withJSONObject: output, options: [])
FileHandle.standardOutput.write(data)
`;

const CG_WINDOW_INVENTORY_SWIFT = `
import CoreGraphics
import Foundation

let targetPids = Set(CommandLine.arguments.dropFirst().compactMap { Int($0) })
let options = CGWindowListOption(arrayLiteral: [.optionOnScreenOnly, .excludeDesktopElements])
let windowInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var windows = [[String: Any]]()
for entry in windowInfo {
  let pid = entry[kCGWindowOwnerPID as String] as? Int ?? -1
  if !targetPids.isEmpty && !targetPids.contains(pid) {
    continue
  }
  let bounds = entry[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = bounds["Width"] as? Double ?? 0
  let height = bounds["Height"] as? Double ?? 0
  windows.append([
    "pid": pid,
    "windowNumber": entry[kCGWindowNumber as String] as? Int ?? -1,
    "ownerName": entry[kCGWindowOwnerName as String] as? String ?? "",
    "title": entry[kCGWindowName as String] as? String ?? "",
    "layer": entry[kCGWindowLayer as String] as? Int ?? -1,
    "x": Int(bounds["X"] as? Double ?? 0),
    "y": Int(bounds["Y"] as? Double ?? 0),
    "width": Int(width),
    "height": Int(height)
  ])
}
let output: [String: Any] = ["windows": windows]
let data = try JSONSerialization.data(withJSONObject: output, options: [])
FileHandle.standardOutput.write(data)
`;

const AX_MOVE_WINDOW_SWIFT = `
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
}

let args = CommandLine.arguments.dropFirst()
guard args.count == 6,
  let pid = Int32(args[args.startIndex]),
  let windowIndex = Int(args[args.index(args.startIndex, offsetBy: 1)]),
  let x = Double(args[args.index(args.startIndex, offsetBy: 2)]),
  let y = Double(args[args.index(args.startIndex, offsetBy: 3)]),
  let width = Double(args[args.index(args.startIndex, offsetBy: 4)]),
  let height = Double(args[args.index(args.startIndex, offsetBy: 5)])
else {
  emit(["ok": false, "status": "invalid-arguments"])
  exit(0)
}

let app = AXUIElementCreateApplication(pid)
var windowsValue: CFTypeRef?
let windowsResult = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue)
guard windowsResult == .success, let windows = windowsValue as? [AXUIElement], windowIndex >= 1, windowIndex <= windows.count else {
  emit(["ok": false, "status": "window-not-found", "copyResult": Int(windowsResult.rawValue)])
  exit(0)
}

let window = windows[windowIndex - 1]
var targetPoint = CGPoint(x: x, y: y)
var targetSize = CGSize(width: width, height: height)
guard let pointValue = AXValueCreate(.cgPoint, &targetPoint),
  let sizeValue = AXValueCreate(.cgSize, &targetSize)
else {
  emit(["ok": false, "status": "ax-value-create-failed"])
  exit(0)
}

let positionResult = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue)
let sizeResult = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
emit([
  "ok": positionResult == .success && sizeResult == .success,
  "status": positionResult == .success && sizeResult == .success ? "moved" : "move-failed",
  "positionResult": Int(positionResult.rawValue),
  "sizeResult": Int(sizeResult.rawValue)
])
`;

const ACCESSIBILITY_PROBE_APPLESCRIPT = `
tell application "System Events"
  return count of processes
end tell
`;

const AX_WINDOW_INVENTORY_APPLESCRIPT = `
on run argv
  set outText to ""
  tell application "System Events"
    repeat with pidText in argv
      set targetPid to pidText as integer
      repeat with proc in (every process whose unix id is targetPid)
        set windowIndex to 0
        repeat with win in windows of proc
          set windowIndex to windowIndex + 1
          try
            set posValue to position of win
            set sizeValue to size of win
            set titleText to name of win
            set outText to outText & pidText & tab & (windowIndex as text) & tab & titleText & tab & ((item 1 of posValue) as text) & tab & ((item 2 of posValue) as text) & tab & ((item 1 of sizeValue) as text) & tab & ((item 2 of sizeValue) as text) & linefeed
          end try
        end repeat
      end repeat
    end repeat
    return outText
  end tell
end run
`;
