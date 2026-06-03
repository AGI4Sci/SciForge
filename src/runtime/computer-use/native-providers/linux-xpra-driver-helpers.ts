import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { VirtualDisplayProviderProbeOptions } from '../virtual-display-provider.js';
import {
  nativeDriverInputControlDefaultRefs,
  type NativeVirtualDisplayDriverInputControlContext,
  type NativeVirtualDisplayDriverInputControlOperation,
  type NativeVirtualDisplayDriverInputControlResult,
} from './native-driver-input-control.js';

export interface LinuxXpraSessionHandle {
  sessionId: string;
  display: string;
  width: number;
  height: number;
  stdout?: string;
  raw?: unknown;
}

export interface LinuxXpraTargetAppSpec {
  kind?: string;
  name?: string;
  command?: string;
  args?: string[];
  processMatch?: string;
  windowTitlePattern?: string;
}

export interface LinuxXpraLaunchResult {
  pids: number[];
  stdout?: string;
  launchRef?: string;
  targetAppRef?: string;
  details?: Record<string, unknown>;
}

export interface LinuxXpraWindowInventoryEntry {
  id: string;
  title: string;
  pid?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  raw?: Record<string, string>;
}

export interface LinuxXpraFrameCapture {
  frameRef: string;
  screenshotRef: string;
  frameRecord: Record<string, unknown>;
}

export interface LinuxXpraInputIsolationProbe {
  ok: boolean;
  detail?: string;
  tool?: LinuxXpraInputControlTool;
}

export interface LinuxXpraCommandRunner {
  execFileSync(command: string, args: string[], options?: Parameters<typeof execFileSync>[2]): Buffer | string;
  execFile(command: string, args: string[], options?: Parameters<typeof execFile>[2]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
}

export type LinuxXpraInputControlTool = 'xdotool';

export interface LinuxXpraInputControlHookOptions {
  context: NativeVirtualDisplayDriverInputControlContext;
  outDir: string;
  runDirRef: string;
  runner?: Pick<LinuxXpraCommandRunner, 'execFile'>;
  writeJsonRef?: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  captureFrame: (phase: string) => LinuxXpraFrameCapture | Promise<LinuxXpraFrameCapture>;
  inputTool?: LinuxXpraInputControlTool;
  now?: () => number;
}

const execFileAsync = promisify(execFile);
const LINUX_XPRA_INPUT_CONTROL_TOOL_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_INPUT_TOOL';

export const linuxXpraCommandRunner: LinuxXpraCommandRunner = {
  execFileSync: (command, args, options) => execFileSync(command, args, options),
  execFile: (command, args, options) => execFileAsync(command, args, options) as Promise<{ stdout: string | Buffer; stderr: string | Buffer }>,
};

export function commandExists(
  command: string,
  options: VirtualDisplayProviderProbeOptions = {},
  runner: Pick<LinuxXpraCommandRunner, 'execFileSync'> = linuxXpraCommandRunner,
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

export function probeLinuxXpraInputIsolation(
  options: {
    probeOptions?: VirtualDisplayProviderProbeOptions;
    inputTool?: LinuxXpraInputControlTool;
    runner?: Pick<LinuxXpraCommandRunner, 'execFileSync'>;
  } = {},
): LinuxXpraInputIsolationProbe {
  const tool = linuxXpraInputControlTool(options.inputTool);
  if (!tool) return { ok: false, detail: 'unsupported Linux Xpra input tool; only xdotool is supported.' };
  if (!commandExists(tool, options.probeOptions, options.runner)) {
    return { ok: false, detail: `${tool} command is not available for Xpra isolated input.`, tool };
  }
  return { ok: true, tool };
}

export async function runLinuxXpraInputControlHook(
  input: LinuxXpraInputControlHookOptions,
): Promise<NativeVirtualDisplayDriverInputControlResult> {
  const session = linuxXpraSessionFromPlatformState(input.context.platformState);
  const targetWindow = linuxXpraWindowFromPlatformState(input.context.platformState);
  if (!session || !targetWindow) {
    return { ok: false, detail: 'missing Xpra session or target window.' };
  }
  if (!isIsolatedXpraDisplay(session.display)) {
    return { ok: false, detail: 'session display is not a scoped Xpra virtual display.' };
  }
  if (!isUsableXWindowId(targetWindow.id)) {
    return { ok: false, detail: 'target window id is not usable by isolated input tooling.' };
  }

  const inputTool = linuxXpraInputControlTool(input.inputTool);
  if (!inputTool) return { ok: false, detail: 'unsupported Linux Xpra input tool.' };

  const providerRootRef = stringRef(input.context.refs.providerRootRef);
  if (!providerRootRef) return { ok: false, detail: 'missing providerRootRef.' };
  const refs = nativeDriverInputControlDefaultRefs({
    providerRootRef,
    operation: input.context.operation,
    operationOptions: input.context.operationOptions,
  });
  const writeJson = input.writeJsonRef ?? writeJsonRef;
  const now = input.now?.() ?? Date.now();
  let before: LinuxXpraFrameCapture;
  let after: LinuxXpraFrameCapture;
  try {
    before = await input.captureFrame(phaseForFrameRef(requiredString(refs.beforeFrameRef, 'beforeFrameRef')));
    await writeJson(input.outDir, input.runDirRef, requiredString(refs.beforeFrameRef, 'beforeFrameRef'), frameEvidenceRecord(before, 'before-input-control'));

    const execution = await executeLinuxXpraInputControl({
      context: input.context,
      inputTool,
      session,
      targetWindow,
      runner: input.runner ?? linuxXpraCommandRunner,
    });
    if (!execution.ok) return { ok: false, detail: execution.detail };

    after = await input.captureFrame(phaseForFrameRef(requiredString(refs.afterFrameRef, 'afterFrameRef')));
    await writeJson(input.outDir, input.runDirRef, requiredString(refs.afterFrameRef, 'afterFrameRef'), frameEvidenceRecord(after, 'after-input-control'));

    await writeLinuxXpraInputControlRecords({
      context: input.context,
      refs,
      outDir: input.outDir,
      runDirRef: input.runDirRef,
      writeJson,
      now,
      session,
      targetWindow,
      execution,
      before,
      after,
    });
    return {
      ok: true,
      refs,
      mutatingActionExecuted: true,
      providerEvidenceWritten: true,
      affectsPhysicalDisplay: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    };
  } catch (error) {
    return { ok: false, detail: shortError(error) };
  }
}

export async function startLinuxXpraSession(params: {
  sessionId: string;
  display: string;
  width: number;
  height: number;
  runner?: Pick<LinuxXpraCommandRunner, 'execFile'>;
}): Promise<LinuxXpraSessionHandle> {
  const runner = params.runner ?? linuxXpraCommandRunner;
  const result = await runner.execFile('xpra', [
    'start',
    params.display,
    '--daemon=yes',
    '--exit-with-children=no',
    `--resize-display=${Math.round(params.width)}x${Math.round(params.height)}`,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return {
    sessionId: params.sessionId,
    display: params.display,
    width: params.width,
    height: params.height,
    stdout: String(result.stdout),
  };
}

export async function launchLinuxXpraApp(params: {
  session: LinuxXpraSessionHandle;
  spec: LinuxXpraTargetAppSpec;
  runner?: Pick<LinuxXpraCommandRunner, 'execFile'>;
}): Promise<LinuxXpraLaunchResult> {
  if (!params.spec.command) {
    throw new Error('Linux Xpra launch requires an explicit target app command.');
  }
  const runner = params.runner ?? linuxXpraCommandRunner;
  const result = await runner.execFile('xpra', [
    'control',
    params.session.display,
    'start-child',
    params.spec.command,
    ...(params.spec.args ?? []),
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const stdout = String(result.stdout);
  return {
    pids: pidsFromText(stdout),
    stdout,
    details: { launchMode: 'xpra-control-start-child' },
  };
}

export async function inventoryLinuxXpraWindows(
  session: LinuxXpraSessionHandle,
  runner: Pick<LinuxXpraCommandRunner, 'execFile'> = linuxXpraCommandRunner,
): Promise<LinuxXpraWindowInventoryEntry[]> {
  const result = await runner.execFile('xpra', ['info', session.display], {
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseLinuxXpraWindowInventory(String(result.stdout));
}

export async function waitForLinuxXpraWindow(
  input: {
    session: LinuxXpraSessionHandle;
    pids?: number[];
    spec?: LinuxXpraTargetAppSpec;
    timeoutMs: number;
  },
  deps: {
    inventory?: (session: LinuxXpraSessionHandle) => Promise<LinuxXpraWindowInventoryEntry[]> | LinuxXpraWindowInventoryEntry[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<LinuxXpraWindowInventoryEntry | undefined> {
  const startedAt = Date.now();
  const inventory = deps.inventory ?? ((session) => inventoryLinuxXpraWindows(session));
  const sleepFn = deps.sleep ?? sleep;
  let windows: LinuxXpraWindowInventoryEntry[] = [];
  do {
    windows = await inventory(input.session);
    const selected = selectLinuxXpraTargetWindow(windows, input);
    if (selected) return selected;
    await sleepFn(500);
  } while (Date.now() - startedAt < input.timeoutMs);
  return selectLinuxXpraTargetWindow(windows, input);
}

export function selectLinuxXpraTargetWindow(
  windows: LinuxXpraWindowInventoryEntry[],
  input: { pids?: number[]; spec?: LinuxXpraTargetAppSpec } = {},
): LinuxXpraWindowInventoryEntry | undefined {
  const titlePattern = input.spec?.windowTitlePattern
    ? new RegExp(input.spec.windowTitlePattern, 'iu')
    : undefined;
  const processPattern = input.spec?.processMatch
    ? new RegExp(input.spec.processMatch, 'iu')
    : undefined;
  const visibleWindows = windows
    .filter((window) => window.width >= 160 && window.height >= 100)
    .filter((window) => !input.pids?.length || (window.pid !== undefined && input.pids.includes(window.pid)))
    .filter((window) => !titlePattern || titlePattern.test(window.title))
    .filter((window) => !processPattern || processPattern.test(`${window.raw?.command ?? ''} ${window.raw?.process ?? ''} ${window.title}`))
    .sort((left, right) => (right.width * right.height) - (left.width * left.height));
  return visibleWindows[0];
}

export async function captureLinuxXpraSessionFrame(params: {
  outDir: string;
  runDirRef: string;
  phase: string;
  session: LinuxXpraSessionHandle;
  providerId: string;
  runner?: Pick<LinuxXpraCommandRunner, 'execFile'>;
}): Promise<LinuxXpraFrameCapture> {
  const runner = params.runner ?? linuxXpraCommandRunner;
  const frameRef = `${params.runDirRef}/virtual-display-provider/frames/${params.phase}.json`;
  const screenshotRef = `${params.runDirRef}/virtual-display-provider/frames/${params.phase}.png`;
  const screenshotPath = localPathForRef(params.outDir, params.runDirRef, screenshotRef);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await runner.execFile('xpra', ['screenshot', params.session.display, screenshotPath], {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
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
    captureTool: 'xpra screenshot',
    sessionDisplay: params.session.display,
    currentRunOnly: true,
  };
  return { frameRef, screenshotRef, frameRecord };
}

export function parseLinuxXpraWindowInventory(stdout: string): LinuxXpraWindowInventoryEntry[] {
  const byId = new Map<string, Record<string, string>>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:windows?|window)(?:\.|\[)([^\].]+)(?:\]|\.)?\.?([^=]+)=(.*)$/iu);
    if (!match) continue;
    const [, id = '', rawKey = '', rawValue = ''] = match;
    const record = byId.get(id) ?? {};
    record[rawKey.trim().toLowerCase()] = rawValue.trim();
    byId.set(id, record);
  }
  return [...byId.entries()]
    .map(([id, raw]) => windowFromRecord(id, raw))
    .filter((entry): entry is LinuxXpraWindowInventoryEntry => Boolean(entry));
}

export function localPathForRef(outDir: string, runDirRef: string, ref: string) {
  if (!ref.startsWith(runDirRef)) throw new Error(`Ref ${ref} is outside current run ${runDirRef}.`);
  return join(outDir, relative(runDirRef, ref));
}

export async function writeJsonRef(outDir: string, runDirRef: string, ref: string, data: unknown) {
  const localPath = localPathForRef(outDir, runDirRef, ref);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function shortError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

export function xpraDisplayForRunId(runId: string) {
  const digest = createHash('sha256').update(runId).digest();
  const slot = digest.readUInt16BE(0) % 7000;
  return `:${2000 + slot}`;
}

interface LinuxXpraInputControlExecution {
  ok: boolean;
  detail?: string;
  tool: LinuxXpraInputControlTool;
  operation: NativeVirtualDisplayDriverInputControlOperation;
  commandRecords: Array<Record<string, unknown>>;
  display: string;
  targetWindowId: string;
  actionType?: string;
  agentQueueState?: 'paused' | 'resumed' | 'closed';
}

async function executeLinuxXpraInputControl(input: {
  context: NativeVirtualDisplayDriverInputControlContext;
  inputTool: LinuxXpraInputControlTool;
  session: LinuxXpraSessionHandle;
  targetWindow: LinuxXpraWindowInventoryEntry;
  runner: Pick<LinuxXpraCommandRunner, 'execFile'>;
}): Promise<LinuxXpraInputControlExecution> {
  const base = {
    tool: input.inputTool,
    operation: input.context.operation,
    commandRecords: [] as Array<Record<string, unknown>>,
    display: input.session.display,
    targetWindowId: input.targetWindow.id,
  };
  if (input.context.operation !== 'sendInputIntent') {
    return {
      ...base,
      ok: true,
      agentQueueState: input.context.operation === 'pause'
        ? 'paused'
        : input.context.operation === 'resume'
          ? 'resumed'
          : 'closed',
    };
  }

  const intent = recordValue(input.context.operationOptions.inputIntent);
  const action = recordValue(intent?.action);
  const actionType = stringValue(action?.type) ?? stringValue(intent?.kind);
  if (!actionType) return { ...base, ok: false, detail: 'input action type is missing.' };

  const commands = linuxXpraXdotoolCommandsForAction({
    actionType,
    action,
    intent,
    targetWindow: input.targetWindow,
  });
  if ('detail' in commands) return { ...base, ok: false, detail: commands.detail, actionType };

  const env = {
    ...process.env,
    DISPLAY: input.session.display,
  };
  for (const command of commands.commands) {
    await input.runner.execFile(input.inputTool, command.args, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env,
    });
    base.commandRecords.push({
      tool: input.inputTool,
      args: sanitizeInputToolArgs(command.args, actionType),
      display: input.session.display,
      targetWindowId: input.targetWindow.id,
      actionType,
    });
  }
  return { ...base, ok: true, actionType };
}

function linuxXpraXdotoolCommandsForAction(input: {
  actionType: string;
  action: Record<string, unknown> | undefined;
  intent: Record<string, unknown> | undefined;
  targetWindow: LinuxXpraWindowInventoryEntry;
}): { commands: Array<{ args: string[] }> } | { detail: string } {
  const actionType = input.actionType.trim().toLowerCase();
  if (actionType === 'click' || actionType === 'double_click') {
    const point = pointForIntent(input.action, input.intent, input.targetWindow, 'x-ratio', 'y-ratio');
    if ('detail' in point) return point;
    const clicks = actionType === 'double_click' ? 2 : 1;
    return { commands: [{ args: ['mousemove', '--window', input.targetWindow.id, String(point.x), String(point.y), 'click', String(clicks)] }] };
  }
  if (actionType === 'drag') {
    const from = pointForIntent(input.action, input.intent, input.targetWindow, 'start-x-ratio', 'start-y-ratio', 'fromX', 'fromY');
    if ('detail' in from) return from;
    const to = pointForIntent(input.action, input.intent, input.targetWindow, 'end-x-ratio', 'end-y-ratio', 'toX', 'toY');
    if ('detail' in to) return to;
    return {
      commands: [{
        args: [
          'mousemove',
          '--window',
          input.targetWindow.id,
          String(from.x),
          String(from.y),
          'mousedown',
          '1',
          'mousemove',
          '--window',
          input.targetWindow.id,
          String(to.x),
          String(to.y),
          'mouseup',
          '1',
        ],
      }],
    };
  }
  if (actionType === 'scroll') {
    const direction = stringValue(input.action?.direction) ?? 'down';
    const button = direction === 'up' ? '4' : direction === 'left' ? '6' : direction === 'right' ? '7' : '5';
    const amount = Math.max(1, Math.min(20, Math.round(numberValue(input.action?.amount) ?? 1)));
    return {
      commands: Array.from({ length: amount }, () => ({
        args: ['click', '--window', input.targetWindow.id, button],
      })),
    };
  }
  if (actionType === 'type_text') {
    const text = stringValue(input.action?.text);
    if (!text) return { detail: 'type_text input action requires text.' };
    return { commands: [{ args: ['type', '--window', input.targetWindow.id, '--clearmodifiers', '--delay', '10', text] }] };
  }
  if (actionType === 'press_key') {
    const key = stringValue(input.action?.key);
    if (!key) return { detail: 'press_key input action requires key.' };
    return { commands: [{ args: ['key', '--window', input.targetWindow.id, '--clearmodifiers', key] }] };
  }
  if (actionType === 'hotkey') {
    const keys = Array.isArray(input.action?.keys)
      ? input.action.keys.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      : [];
    if (!keys.length) return { detail: 'hotkey input action requires keys.' };
    return { commands: [{ args: ['key', '--window', input.targetWindow.id, '--clearmodifiers', keys.join('+')] }] };
  }
  return { detail: `unsupported Linux Xpra input action type "${input.actionType}".` };
}

function pointForIntent(
  action: Record<string, unknown> | undefined,
  intent: Record<string, unknown> | undefined,
  window: LinuxXpraWindowInventoryEntry,
  xRatioKey: string,
  yRatioKey: string,
  xActionKey = 'x',
  yActionKey = 'y',
): { x: number; y: number } | { detail: string } {
  const ratios = recordValue(intent?.ratios);
  const xRatio = numberValue(ratios?.[xRatioKey]);
  const yRatio = numberValue(ratios?.[yRatioKey]);
  const x = xRatio !== undefined
    ? Math.round(clampRatio(xRatio) * window.width)
    : Math.round(numberValue(action?.[xActionKey]) ?? Number.NaN);
  const y = yRatio !== undefined
    ? Math.round(clampRatio(yRatio) * window.height)
    : Math.round(numberValue(action?.[yActionKey]) ?? Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { detail: `pointer input requires ${xRatioKey}/${yRatioKey} ratios or action coordinates.` };
  }
  return {
    x: Math.max(0, Math.min(window.width, x)),
    y: Math.max(0, Math.min(window.height, y)),
  };
}

async function writeLinuxXpraInputControlRecords(input: {
  context: NativeVirtualDisplayDriverInputControlContext;
  refs: Record<string, string | string[] | undefined>;
  outDir: string;
  runDirRef: string;
  writeJson: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  now: number;
  session: LinuxXpraSessionHandle;
  targetWindow: LinuxXpraWindowInventoryEntry;
  execution: LinuxXpraInputControlExecution;
  before: LinuxXpraFrameCapture;
  after: LinuxXpraFrameCapture;
}) {
  const write = (ref: string | undefined, data: unknown) => ref ? input.writeJson(input.outDir, input.runDirRef, ref, data) : undefined;
  const writeMany = (refs: string[] | undefined, data: unknown) => Promise.all((refs ?? []).map((ref) => input.writeJson(input.outDir, input.runDirRef, ref, data)));
  const inputIntentRecord = {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.input-intent.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    inputIntent: sanitizedInputIntent(input.context.operationOptions.inputIntent),
    sessionRef: input.context.refs.sessionRef,
    targetWindowId: input.targetWindow.id,
    display: input.session.display,
    currentRunOnly: true,
    recordedAt: input.now,
  };
  const executorRecord = {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.executor-event.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    tool: input.execution.tool,
    commandRecords: input.execution.commandRecords,
    agentQueueState: input.execution.agentQueueState,
    display: input.session.display,
    targetWindowId: input.targetWindow.id,
    displayScoped: true,
    currentRunOnly: true,
    recordedAt: input.now,
  };
  const beforeAfterRecord = {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.before-after.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    beforeFrameRef: input.refs.beforeFrameRef,
    afterFrameRef: input.refs.afterFrameRef,
    beforeScreenshotRef: input.before.screenshotRef,
    afterScreenshotRef: input.after.screenshotRef,
    currentRunOnly: true,
  };
  const verificationRecord = {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.input-verification.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    actionType: input.execution.actionType,
    tool: input.execution.tool,
    display: input.session.display,
    displayScoped: true,
    targetWindowId: input.targetWindow.id,
    targetWindow: input.targetWindow,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    commandCount: input.execution.commandRecords.length,
    agentQueueState: input.execution.agentQueueState,
    beforeFrameRef: input.refs.beforeFrameRef,
    afterFrameRef: input.refs.afterFrameRef,
    currentRunOnly: true,
    recordedAt: input.now,
  };

  await writeMany(stringList(input.refs.inputIntentRefs), inputIntentRecord);
  await writeMany(stringList(input.refs.executorEventRefs), executorRecord);
  await writeMany(stringList(input.refs.beforeAfterFrameRefs), beforeAfterRecord);
  await writeMany(stringList(input.refs.verificationRefs), verificationRecord);
  await writeMany(stringList(input.refs.isolationEvidenceRefs), {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.input-isolation.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    display: input.session.display,
    displayScoped: true,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    currentRunOnly: true,
    recordedAt: input.now,
  });
  await writeMany(stringList(input.refs.physicalDesktopProbeRefs), {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.physical-desktop-probe.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    display: input.session.display,
    targetWindowId: input.targetWindow.id,
    probedScope: 'xpra-virtual-display',
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    currentRunOnly: true,
    recordedAt: input.now,
  });
  await write(stringRef(input.refs.agentQueueRef), {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.agent-queue.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    state: input.execution.agentQueueState,
    display: input.session.display,
    currentRunOnly: true,
    recordedAt: input.now,
  });
  await write(stringRef(input.refs.currentFrameRefreshRef), {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.current-frame-refresh.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    frameRef: input.refs.afterFrameRef,
    display: input.session.display,
    currentRunOnly: true,
    recordedAt: input.now,
  });
  await write(stringRef(input.refs.safeStopRef), {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.safe-stop.v1',
    providerId: input.context.providerId,
    operation: input.context.operation,
    mode: 'safe-close-or-pause-virtual-session-only',
    display: input.session.display,
    currentRunOnly: true,
    recordedAt: input.now,
  });
}

function linuxXpraInputControlTool(value?: LinuxXpraInputControlTool): LinuxXpraInputControlTool | undefined {
  const raw = value ?? process.env[LINUX_XPRA_INPUT_CONTROL_TOOL_ENV]?.trim().toLowerCase() ?? 'xdotool';
  return raw === 'xdotool' ? 'xdotool' : undefined;
}

function linuxXpraSessionFromPlatformState(value: Record<string, unknown>): LinuxXpraSessionHandle | undefined {
  const session = recordValue(value.session);
  const display = stringValue(session?.display);
  const sessionId = stringValue(session?.sessionId);
  const width = numberValue(session?.width);
  const height = numberValue(session?.height);
  if (!display || !sessionId || width === undefined || height === undefined) return undefined;
  return {
    sessionId,
    display,
    width,
    height,
    stdout: stringValue(session?.stdout),
    raw: session?.raw,
  };
}

function linuxXpraWindowFromPlatformState(value: Record<string, unknown>): LinuxXpraWindowInventoryEntry | undefined {
  const window = recordValue(value.targetWindow);
  const id = stringValue(window?.id);
  const title = stringValue(window?.title) ?? '';
  const x = numberValue(window?.x);
  const y = numberValue(window?.y);
  const width = numberValue(window?.width);
  const height = numberValue(window?.height);
  if (!id || x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return {
    id,
    title,
    pid: numberValue(window?.pid),
    x,
    y,
    width,
    height,
    raw: recordStringMap(window?.raw),
  };
}

function sanitizedInputIntent(value: unknown) {
  const intent = recordValue(value);
  const action = recordValue(intent?.action);
  const text = stringValue(action?.text);
  return {
    source: stringValue(intent?.source),
    kind: stringValue(intent?.kind),
    controlKind: stringValue(intent?.controlKind),
    actionType: stringValue(action?.type),
    textLength: text?.length,
    refs: recordValue(intent?.refs),
    ratios: recordValue(intent?.ratios),
  };
}

function sanitizeInputToolArgs(args: string[], actionType: string) {
  if (actionType !== 'type_text') return args;
  const textIndex = args.length - 1;
  return args.map((arg, index) => index === textIndex ? `[text:${arg.length}]` : arg);
}

function frameEvidenceRecord(capture: LinuxXpraFrameCapture, role: string) {
  return {
    ...capture.frameRecord,
    frameRef: capture.frameRef,
    screenshotRef: capture.screenshotRef,
    role,
    currentRunOnly: true,
  };
}

function phaseForFrameRef(ref: string) {
  const leaf = ref.split('/').pop() ?? 'input-control-frame.json';
  return leaf.replace(/\.json$/u, '');
}

function isIsolatedXpraDisplay(value: string) {
  return /^:\d+$/u.test(value.trim());
}

function isUsableXWindowId(value: string) {
  return /^(?:\d+|0x[0-9a-f]+)$/iu.test(value.trim());
}

function requiredString(value: string | string[] | undefined, label: string) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`Linux Xpra input/control hook missing ${label}.`);
}

function stringRef(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringList(value: unknown) {
  if (typeof value === 'string' && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recordStringMap(value: unknown): Record<string, string> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const entries = Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function windowFromRecord(id: string, raw: Record<string, string>): LinuxXpraWindowInventoryEntry | undefined {
  const geometry = parseGeometry(raw.geometry ?? raw['client-geometry'] ?? raw['window-geometry']);
  const x = numberFrom(raw.x) ?? geometry?.x ?? 0;
  const y = numberFrom(raw.y) ?? geometry?.y ?? 0;
  const width = numberFrom(raw.width) ?? numberFrom(raw.w) ?? geometry?.width ?? 0;
  const height = numberFrom(raw.height) ?? numberFrom(raw.h) ?? geometry?.height ?? 0;
  if (width <= 0 || height <= 0) return undefined;
  return {
    id,
    title: raw.title ?? raw.name ?? '',
    pid: numberFrom(raw.pid),
    x,
    y,
    width,
    height,
    raw,
  };
}

function parseGeometry(value: string | undefined) {
  if (!value) return undefined;
  const numbers = [...value.matchAll(/-?\d+/gu)].map((match) => Number(match[0]));
  if (numbers.length < 4 || numbers.some((entry) => !Number.isFinite(entry))) return undefined;
  return {
    x: numbers[0]!,
    y: numbers[1]!,
    width: numbers[2]!,
    height: numbers[3]!,
  };
}

function numberFrom(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pidsFromText(value: string) {
  return [...value.matchAll(/\bpid(?:s)?\D+(\d+)\b/giu)]
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}
