import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type { ComputerUseConfig } from './types.js';
import { EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID } from './completion-evidence-policy.js';
import {
  packageBridgeInvocationProcessSummary,
  type PackageBridgeInvocationProcessSummary,
} from './package-bridge-invocation-diagnostics.js';
import { workspaceRel } from './utils.js';
import { CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF } from '../../../packages/actions/computer-use/evidence-classification.js';
import { materializeCuNextL3CompletionEvidence } from '../../../packages/actions/computer-use/materialize-l3-completion-evidence.js';

const EMBEDDED_L3_EVIDENCE_DIR = 'evidence/l3';
export const EMBEDDED_L3_DIAGNOSTIC_REF = 'embedded-l3-completion-producer-diagnostics.json';
const DEFAULT_DOCKER_IMAGE_TAG = 'sciforge-computer-use-isolated-backend:ci';
const DEFAULT_DOCKER_BASE_IMAGE = 'python:3.12-slim-bookworm';
const DEFAULT_DOCKER_APT_ACQUIRE_RETRIES = '3';
const DEFAULT_DOCKER_L3_RESOURCE_LOCK_ROOT = '/tmp/sciforge-computer-use-l3-locks';

type PackageBridgeL3State = {
  runId: string;
  runDir: string;
};

export type PackageBridgeL3CompletionProducer = (params: {
  config: ComputerUseConfig;
  finalArtifactRef?: string;
  packageResult: Record<string, unknown>;
  sourceDir: string;
  state: PackageBridgeL3State;
  workspace: string;
}) => Promise<void>;

export type PackageBridgeL3CompletionProduction = {
  status: 'skipped' | 'materialized' | 'blocked';
  attempted: boolean;
  sourceDirRef?: string;
  producerDiagnosticRef?: string;
};

let l3CompletionProducerForTests: PackageBridgeL3CompletionProducer | undefined;

export function setComputerUsePackageBridgeL3CompletionProducerForTests(
  producer: PackageBridgeL3CompletionProducer | undefined,
) {
  l3CompletionProducerForTests = producer;
}

export async function maybeProducePackageBridgeL3CompletionEvidence(params: {
  config: ComputerUseConfig;
  defaultProducerOptIn?: boolean;
  finalArtifactRef?: string;
  packageResult: Record<string, unknown>;
  producer?: PackageBridgeL3CompletionProducer;
  state: PackageBridgeL3State;
  workspace: string;
}): Promise<PackageBridgeL3CompletionProduction> {
  if (params.packageResult.status !== 'completed') return { status: 'skipped', attempted: false };
  const existingCanonical = join(params.state.runDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  if (await isRegularFileInside(params.state.runDir, existingCanonical)) return { status: 'skipped', attempted: false };

  const producer = params.producer
    ?? l3CompletionProducerForTests
    ?? enabledDefaultL3CompletionProducer(params.defaultProducerOptIn === true);
  if (!producer) return { status: 'skipped', attempted: false };

  const sourceDir = join(params.state.runDir, EMBEDDED_L3_EVIDENCE_DIR);
  const sourceDirRef = workspaceRel(params.workspace, sourceDir);
  try {
    await mkdir(sourceDir, { recursive: true });
    await producer({
      config: params.config,
      finalArtifactRef: params.finalArtifactRef,
      packageResult: params.packageResult,
      sourceDir,
      state: params.state,
      workspace: params.workspace,
    });
    await materializeCuNextL3CompletionEvidence({
      sourceDir,
      targetDir: params.state.runDir,
      sourceFile: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
      prefix: EMBEDDED_L3_EVIDENCE_DIR,
      taskFinalArtifactRef: params.finalArtifactRef,
    });
    return { status: 'materialized', attempted: true, sourceDirRef };
  } catch (error) {
    const producerDiagnosticRef = await writeL3ProducerDiagnostic({
      error,
      sourceDir,
      state: params.state,
      workspace: params.workspace,
    });
    return { status: 'blocked', attempted: true, sourceDirRef, producerDiagnosticRef };
  }
}

function enabledDefaultL3CompletionProducer(requestOptIn: boolean): PackageBridgeL3CompletionProducer | undefined {
  if (!requestOptIn && process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW !== '1') return undefined;
  return runDefaultL3CompletionProducer;
}

async function runDefaultL3CompletionProducer(params: {
  config: ComputerUseConfig;
  sourceDir: string;
}) {
  const packageDir = resolve('packages/actions/computer-use');
  const timeoutSeconds = boundedTimeoutSeconds(
    process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_TIMEOUT,
    params.config.planner?.timeoutMs,
  );
  if (defaultL3ProducerBackend(process.env, platform()) === 'docker') {
    const dockerSourceDir = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-docker-'));
    try {
      const build = await runProcess('docker', defaultL3ProducerDockerBuildArgs({ env: process.env }), {
        cwd: packageDir,
        env: l3ProducerEnv(packageDir),
        timeoutMs: dockerBuildTimeoutMs(process.env),
      });
      if (build.code !== 0 || build.signal) {
        throw new L3ProducerProcessError(
          `embedded L3 docker build exited code=${build.code ?? 'null'} signal=${build.signal ?? 'null'}`,
          build,
        );
      }
      const run = await runProcess('docker', defaultL3ProducerDockerRunArgs({
        sourceDir: dockerSourceDir,
        timeoutSeconds,
        env: process.env,
      }), {
        cwd: packageDir,
        env: l3ProducerEnv(packageDir),
        timeoutMs: (timeoutSeconds + 15) * 1000,
      });
      await copyRegularEvidenceFiles(dockerSourceDir, params.sourceDir);
      if (run.code !== 0 || run.signal) {
        throw new L3ProducerProcessError(
          `embedded L3 docker run exited code=${run.code ?? 'null'} signal=${run.signal ?? 'null'}`,
          run,
        );
      }
    } finally {
      await rm(dockerSourceDir, { recursive: true, force: true });
    }
    return;
  }
  const python = process.env.SCIFORGE_COMPUTER_USE_L3_PYTHON
    || process.env.SCIFORGE_VISION_SENSE_PYTHON
    || 'python3';
  const result = await runProcess(python, defaultL3ProducerArgs({
    sourceDir: params.sourceDir,
    timeoutSeconds,
    env: process.env,
  }), {
    cwd: packageDir,
    env: l3ProducerEnv(packageDir),
    timeoutMs: (timeoutSeconds + 10) * 1000,
  });
  if (result.code !== 0 || result.signal) {
    throw new L3ProducerProcessError(
      `embedded L3 host producer exited code=${result.code ?? 'null'} signal=${result.signal ?? 'null'}`,
      result,
    );
  }
}

class L3ProducerProcessError extends Error {
  constructor(
    message: string,
    readonly process: L3ProducerProcessResult,
  ) {
    super(message);
    this.name = 'L3ProducerProcessError';
  }
}

export function defaultL3ProducerArgs(input: {
  sourceDir: string;
  timeoutSeconds: number;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = input.env ?? process.env;
  return [
    '-m',
    'sciforge_computer_use.isolated_desktop_l3_workflow_probe',
    '--execute',
    '--output-dir',
    input.sourceDir,
    '--timeout-seconds',
    String(input.timeoutSeconds),
    ...optionalStringArg('--display', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DISPLAY),
    ...optionalPositiveIntArg('--vnc-port', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT),
    ...optionalPositiveIntArg('--novnc-port', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT),
    ...optionalStringArg('--resource-lock-root', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT),
  ];
}

export function defaultL3ProducerBackend(
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform | string = platform(),
): 'docker' | 'host' {
  const raw = env.SCIFORGE_RUN_REAL_L3_WORKFLOW_BACKEND?.trim().toLowerCase();
  if (raw === 'host' || raw === 'python') return 'host';
  if (raw === 'docker' || raw === 'container') return 'docker';
  return hostPlatform === 'linux' ? 'host' : 'docker';
}

export function defaultL3ProducerDockerBuildArgs(input: {
  env?: NodeJS.ProcessEnv;
} = {}): string[] {
  const env = input.env ?? process.env;
  return [
    'build',
    '--build-arg',
    `PYTHON_BASE_IMAGE=${env.SCIFORGE_DOCKER_BASE_IMAGE || DEFAULT_DOCKER_BASE_IMAGE}`,
    '--build-arg',
    `DEBIAN_APT_MIRROR=${env.SCIFORGE_DOCKER_DEBIAN_APT_MIRROR || ''}`,
    '--build-arg',
    `DEBIAN_SECURITY_APT_MIRROR=${env.SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR || ''}`,
    '--build-arg',
    `APT_ACQUIRE_RETRIES=${env.SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES || DEFAULT_DOCKER_APT_ACQUIRE_RETRIES}`,
    '-f',
    'sciforge_computer_use/isolated_desktop_backend.Dockerfile',
    '-t',
    dockerImageTag(env),
    '.',
  ];
}

export function defaultL3ProducerDockerRunArgs(input: {
  sourceDir: string;
  timeoutSeconds: number;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = input.env ?? process.env;
  const explicitNovncPort = positiveIntString(env.SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT);
  return [
    'run',
    '--rm',
    '--shm-size',
    '1g',
    ...(
      explicitNovncPort
        ? ['-p', `127.0.0.1:${explicitNovncPort}:${explicitNovncPort}`]
        : []
    ),
    '-v',
    `${resolve(input.sourceDir)}:/evidence/l3`,
    '--entrypoint',
    'python',
    dockerImageTag(env),
    '-m',
    'sciforge_computer_use.isolated_desktop_l3_workflow_probe',
    '--execute',
    '--output-dir',
    '/evidence/l3',
    '--timeout-seconds',
    String(input.timeoutSeconds),
    ...optionalStringArg('--display', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DISPLAY),
    ...optionalPositiveIntArg('--vnc-port', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT),
    ...optionalPositiveIntArg('--novnc-port', env.SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT),
    '--resource-lock-root',
    env.SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT || DEFAULT_DOCKER_L3_RESOURCE_LOCK_ROOT,
  ];
}

function dockerImageTag(env: NodeJS.ProcessEnv): string {
  return env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE_TAG;
}

function dockerBuildTimeoutMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DOCKER_BUILD_TIMEOUT);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(30, Math.min(Math.floor(parsed), 3600)) * 1000;
  return 900_000;
}

function optionalStringArg(flag: string, value: string | undefined): string[] {
  const trimmed = value?.trim();
  return trimmed ? [flag, trimmed] : [];
}

function optionalPositiveIntArg(flag: string, value: string | undefined): string[] {
  const parsed = positiveIntString(value);
  if (!parsed) return [];
  return [flag, parsed];
}

function positiveIntString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return String(parsed);
}

function l3ProducerEnv(packageDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
    PYTHONPATH: packageDir,
  };
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
): Promise<L3ProducerProcessResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 500).unref?.();
  }, options.timeoutMs);
  return new Promise((resolveClose, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveClose({
        code: timedOut && code === null ? 124 : code,
        command,
        cwd: options.cwd,
        args,
        env: options.env,
        signal,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut,
        timeoutMs: options.timeoutMs,
      });
    });
  });
}

type L3ProducerProcessResult = {
  args: string[];
  code: number | null;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  timeoutMs: number;
};

function boundedTimeoutSeconds(raw: string | undefined, plannerTimeoutMs: number | undefined): number {
  const parsed = raw ? Number(raw) : undefined;
  if (parsed && Number.isFinite(parsed) && parsed > 0) return Math.max(5, Math.min(Math.floor(parsed), 1800));
  if (plannerTimeoutMs && Number.isFinite(plannerTimeoutMs) && plannerTimeoutMs > 0) {
    return Math.max(30, Math.min(Math.floor(plannerTimeoutMs / 1000), 1800));
  }
  return 120;
}

async function writeL3ProducerDiagnostic(params: {
  error: unknown;
  sourceDir: string;
  state: PackageBridgeL3State;
  workspace: string;
}) {
  const diagnosticRef = workspaceRel(params.workspace, join(params.state.runDir, EMBEDDED_L3_DIAGNOSTIC_REF));
  const processResult = l3ProducerProcessResult(params.error);
  const sourceDiagnostics = await l3SourceDiagnostics({
    sourceDir: params.sourceDir,
    workspace: params.workspace,
  });
  const reason = params.error instanceof Error ? params.error.message : String(params.error);
  await writeFile(join(params.state.runDir, EMBEDDED_L3_DIAGNOSTIC_REF), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.embedded-l3-completion-producer-diagnostic.v1',
    status: 'blocked',
    runId: params.state.runId,
    reason,
    issues: uniqueStrings([
      reason,
      ...sourceDiagnostics.blockedReasons,
      ...(processResult?.timedOut ? [`embedded L3 completion producer timed out after ${processResult.timeoutMs}ms`] : []),
      ...(processResult?.stderr ? [`stderr: ${processResult.stderr}`] : []),
    ]),
    sourceDirRef: workspaceRel(params.workspace, params.sourceDir),
    sourceManifestRefs: sourceDiagnostics.refs,
    sourceBlockedReasons: sourceDiagnostics.blockedReasons,
    sourceReadinessStatus: sourceDiagnostics.status,
    producerId: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
    expectedCompletionEvidenceRef: workspaceRel(
      params.workspace,
      join(params.state.runDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
    ),
    envGateName: 'SCIFORGE_RUN_REAL_L3_WORKFLOW',
    allowedEnvKeys: ['PATH', 'LANG', 'LC_ALL', 'PYTHONPATH'],
    runnerOptions: {
      backend: defaultL3ProducerBackend(process.env, platform()),
      display: process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DISPLAY,
      vncPort: process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_VNC_PORT,
      novncPort: process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT,
      resourceLockRoot: process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT,
      dockerImage: process.env.SCIFORGE_RUN_REAL_L3_WORKFLOW_DOCKER_IMAGE,
    },
    process: processResult,
  }, null, 2)}\n`, 'utf8');
  return diagnosticRef;
}

function l3ProducerProcessResult(error: unknown): PackageBridgeInvocationProcessSummary | undefined {
  return error instanceof L3ProducerProcessError
    ? packageBridgeInvocationProcessSummary(error.process)
    : undefined;
}

async function l3SourceDiagnostics(params: {
  sourceDir: string;
  workspace: string;
}) {
  const manifestNames = [
    'isolated-desktop-l3-workflow-probe-manifest.json',
    'isolated-desktop-backend-probe-manifest.json',
  ];
  const refs: string[] = [];
  const blockedReasons: string[] = [];
  const statuses: string[] = [];
  for (const name of manifestNames) {
    const path = join(params.sourceDir, name);
    try {
      const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      refs.push(workspaceRel(params.workspace, path));
      const manifestBlockedReasons = stringList(record.blockedReasons);
      blockedReasons.push(...manifestBlockedReasons);
      const reason = stringAt(record, 'reason');
      if (reason && manifestBlockedReasons.length === 0) blockedReasons.push(reason);
      const status = stringAt(record, 'status') ?? stringAt(record, 'readinessStatus') ?? stringAt(record, 'backendReadinessStatus');
      if (status) statuses.push(`${name}:${status}`);
    } catch {
      // Source manifests are best-effort diagnostics; the primary fail-closed result is still preserved.
    }
  }
  return {
    refs: uniqueStrings(refs),
    blockedReasons: uniqueStrings(blockedReasons),
    status: uniqueStrings(statuses),
  };
}

async function isRegularFileInside(baseDir: string, path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const baseReal = await realpath(baseDir);
    const targetReal = await realpath(path);
    const rel = relative(baseReal, targetReal);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
  } catch {
    return false;
  }
}

async function copyRegularEvidenceFiles(sourceDir: string, targetDir: string) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyRegularEvidenceFiles(source, target);
    } else if (entry.isFile()) {
      await mkdir(join(target, '..'), { recursive: true });
      await copyFile(source, target);
    }
  }
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function stringAt(record: unknown, key: string) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
