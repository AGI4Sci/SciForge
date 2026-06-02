import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { VirtualDisplayProviderProbeOptions } from '../virtual-display-provider.js';

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
}

export interface LinuxXpraCommandRunner {
  execFileSync(command: string, args: string[], options?: Parameters<typeof execFileSync>[2]): Buffer | string;
  execFile(command: string, args: string[], options?: Parameters<typeof execFile>[2]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
}

const execFileAsync = promisify(execFile);

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

export function probeLinuxXpraInputIsolation(): LinuxXpraInputIsolationProbe {
  return { ok: true };
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
