import { spawn } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { isRecord } from '../gateway-utils.js';
import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { packageBridgeInvocationProcessSummary } from './package-bridge-invocation-diagnostics.js';
import {
  isClosedPipeError,
  type HostPortCall,
  writeHostPortResult,
} from './package-bridge-stdio.js';

export type PackageBridgeHostPortHandler = (call: HostPortCall) => Promise<unknown>;

export type PackageBridgeProcessHandle = {
  stdin?: Writable | null;
  stdout: Readable;
  stderr: Readable;
  killed?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): PackageBridgeProcessHandle;
  on(event: 'error', listener: (error: Error) => void): PackageBridgeProcessHandle;
};

export type SpawnPackageBridgeProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => PackageBridgeProcessHandle;

export type RunComputerUsePackageProcessOptions = {
  actionProviderRequest: Record<string, unknown>;
  callbacks: WorkspaceRuntimeCallbacks;
  handleHostPortCall: PackageBridgeHostPortHandler;
  packageDir?: string;
  python?: string;
  processEnv?: NodeJS.ProcessEnv;
  spawnPackageProcess?: SpawnPackageBridgeProcess;
  abortKillGraceMs?: number;
};

export async function runComputerUsePackageProcess(
  options: RunComputerUsePackageProcessOptions,
): Promise<Record<string, unknown>> {
  const packageDir = options.packageDir ?? resolve('packages/actions/computer-use');
  const python = options.python
    || options.processEnv?.SCIFORGE_COMPUTER_USE_PACKAGE_PYTHON
    || options.processEnv?.SCIFORGE_VISION_SENSE_PYTHON
    || process.env.SCIFORGE_COMPUTER_USE_PACKAGE_PYTHON
    || process.env.SCIFORGE_VISION_SENSE_PYTHON
    || 'python3';
  const processEnv = options.processEnv ?? process.env;
  const packageArgs = [
    '-m',
    'sciforge_computer_use',
    '--request-json',
    JSON.stringify(options.actionProviderRequest),
    '--host-port-stdio',
  ];
  const packageEnv: NodeJS.ProcessEnv = {
    ...processEnv,
    PYTHONPATH: [packageDir, processEnv.PYTHONPATH].filter(Boolean).join(delimiter),
  };
  const spawnPackageProcess = options.spawnPackageProcess ?? spawnPackageProcessDefault;
  const child = spawnPackageProcess(python, packageArgs, {
    cwd: packageDir,
    env: packageEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stdout = '';
  let stderr = '';
  let finalResult: Record<string, unknown> | undefined;
  const pending = new Set<Promise<void>>();
  let aborted = false;
  let abortReason = '';

  child.stdin?.on('error', (error) => {
    if (isClosedPipeError(error)) return;
    stderr = [stderr, `Computer Use package stdin error: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join('\n');
  });

  const abortPackageProcess = () => {
    aborted = true;
    const reason = runtimeAbortReason(options.callbacks.signal);
    abortReason = reason
      ? `Computer Use package bridge aborted by workspace runtime signal: ${reason}.`
      : 'Computer Use package bridge aborted by workspace runtime signal.';
    if (child.killed !== true) child.kill('SIGTERM');
    setTimeout(() => {
      if (child.killed !== true) child.kill('SIGKILL');
    }, options.abortKillGraceMs ?? 500).unref?.();
  };

  if (options.callbacks.signal?.aborted) {
    abortPackageProcess();
  } else {
    options.callbacks.signal?.addEventListener('abort', abortPackageProcess, { once: true });
  }

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      stderr = [stderr, `Non-JSON stdout from Computer Use package: ${line}`].filter(Boolean).join('\n');
      return;
    }
    if (!isRecord(message)) return;
    if (message.type === 'hostPortCall') {
      const task = options.handleHostPortCall(message as HostPortCall)
        .then((result) => writeHostPortResult(child, String(message.id), true, result))
        .catch((error) => writeHostPortResult(child, String(message.id), false, undefined, error instanceof Error ? error.message : String(error)))
        .finally(() => pending.delete(task));
      pending.add(task);
      return;
    }
    if (message.type === 'finalResult' && isRecord(message.result)) {
      finalResult = message.result;
    }
  };

  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    stdout += text;
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const close = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
    child.on('close', (code, signal) => resolveClose({ code, signal }));
    child.on('error', (error) => {
      stderr = [stderr, error.message].filter(Boolean).join('\n');
      resolveClose({ code: 127, signal: null });
    });
  }).finally(() => {
    options.callbacks.signal?.removeEventListener('abort', abortPackageProcess);
  });
  if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
  if (pending.size) {
    if (aborted) {
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise((resolvePending) => setTimeout(resolvePending, 1_500)),
      ]);
    } else {
      await Promise.allSettled([...pending]);
    }
  }
  if (finalResult) return finalResult;

  const processDiagnostic = packageBridgeInvocationProcessSummary({
    args: packageArgs,
    code: close.code,
    command: python,
    cwd: packageDir,
    env: packageEnv,
    signal: close.signal,
    stderr,
    stdout,
  });
  return {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'failed-with-reason',
    reason: [
      aborted ? abortReason : undefined,
      'Computer Use package process exited without finalResult.',
      `exitCode=${close.code ?? 'signal'}`,
      close.signal ? `signal=${close.signal}` : undefined,
      processDiagnostic.stderr || undefined,
    ].filter(Boolean).join(' '),
    message: processDiagnostic.stderr,
    failureDiagnostics: {
      failedStage: 'package-bridge',
      stderr: processDiagnostic.stderr,
      stdout: processDiagnostic.stdout,
      process: processDiagnostic,
    },
    traceRefs: [],
    metrics: {},
  };
}

function runtimeAbortReason(signal: AbortSignal | undefined) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message.trim()) return reason.message.trim();
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  return '';
}

const spawnPackageProcessDefault: SpawnPackageBridgeProcess = (command, args, options) => (
  spawn(command, args, options) as PackageBridgeProcessHandle
);
