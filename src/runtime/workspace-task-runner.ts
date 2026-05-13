import { access, copyFile, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { WorkspaceTaskRunResult, WorkspaceTaskSpec } from './runtime-types.js';
import { pruneTaskInputRetention } from './workspace-retention.js';
import { buildWorkspaceTaskInput } from './workspace-task-input.js';
import { workspaceTaskPythonCommandCandidates } from '../../packages/skills/runtime-policy';

const execFileAsync = promisify(execFile);
const PARTIAL_CHECKPOINT_MAX_FILES = 40;
const PARTIAL_CHECKPOINT_SCAN_LIMIT = 600;
const unknownArtifactInspectorComponentId = ['unknown', 'artifact', 'inspector'].join('-');
const executionUnitTableComponentId = ['execution', 'unit', 'table'].join('-');
const workspaceTaskRunnerToolId = ['workspace', 'task', 'runner'].join('-');
const partialCheckpointArtifactId = ['partial', 'checkpoint'].join('-');
const tableArtifactType = ['data', 'table'].join('-');
const reportArtifactType = ['research', 'report'].join('-');

export async function runWorkspaceTask(workspacePath: string, spec: WorkspaceTaskSpec): Promise<WorkspaceTaskRunResult> {
  const workspace = resolve(workspacePath || process.cwd());
  const taskRel = spec.taskRel ?? `.sciforge/tasks/${safeId(spec.id)}.task`;
  const concreteSpec = { ...spec, taskRel };
  const taskPath = join(workspace, taskRel);
  const inputRel = spec.inputRel ?? `.sciforge/task-inputs/${safeId(spec.id)}.json`;
  const inputPath = join(workspace, inputRel);
  const outputPath = join(workspace, spec.outputRel);
  const stdoutPath = join(workspace, spec.stdoutRel);
  const stderrPath = join(workspace, spec.stderrRel);
  const sessionBundleRel = spec.sessionBundleRel ?? inferSessionBundleRel(spec.outputRel, spec.inputRel, taskRel);

  await Promise.all([
    mkdir(dirname(taskPath), { recursive: true }),
    mkdir(dirname(inputPath), { recursive: true }),
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(stdoutPath), { recursive: true }),
    mkdir(dirname(stderrPath), { recursive: true }),
  ]);
  if (spec.codeTemplatePath) {
    await copyFile(resolve(spec.codeTemplatePath), taskPath);
  }
  await writeFile(inputPath, JSON.stringify(buildWorkspaceTaskInput(spec.input, {
    workspacePath: workspace,
    workspaceRootPath: workspace,
    sessionBundleRef: sessionBundleRel,
    sessionResourceRootPath: sessionBundleRel ? join(workspace, sessionBundleRel) : undefined,
    taskCodeRef: taskRel,
    inputRef: inputRel,
    outputRef: spec.outputRel,
    stdoutRef: spec.stdoutRel,
    stderrRef: spec.stderrRel,
  }), null, 2));
  await ensureWorkspaceCompatibilityRefs(workspace);
  await pruneTaskInputRetention(workspace, {
    protectedRels: [inputRel, ...(spec.retentionProtectedInputRels ?? [])],
  });

  const command = await commandFor(workspace, spec.language, spec.entrypoint);
  const taskInputArg = spec.inputArgMode === 'empty-data-path' ? '' : inputPath;
  const explicitEntrypointArgs = Array.isArray(spec.entrypointArgs) && spec.entrypointArgs.length > 0
    ? spec.entrypointArgs
    : undefined;
  const entrypointArgs = explicitEntrypointArgs ?? await inferEntrypointArgsFromTask(taskPath, taskInputArg);
  const args = argsFor(spec.language, taskPath, taskInputArg, outputPath, spec.entrypoint, entrypointArgs);
  const runtimeFingerprint = await fingerprint(command, spec.language);
  const checkpointBaseline = await snapshotSessionBundleFiles(workspace, sessionBundleRel);
  try {
    const result = await execFileAsync(command, args, {
      cwd: workspace,
      env: workspaceTaskEnv(sessionBundleRel ? join(workspace, sessionBundleRel) : undefined, sessionBundleRel),
      timeout: spec.timeoutMs ?? 120000,
      maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(stdoutPath, result.stdout || '');
    await writeFile(stderrPath, result.stderr || '');
    return {
      spec: concreteSpec,
      workspace,
      command,
      args,
      exitCode: 0,
      stdoutRef: spec.stdoutRel,
      stderrRef: spec.stderrRel,
      outputRef: spec.outputRel,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      runtimeFingerprint,
    };
  } catch (error) {
    const record = isRecord(error) ? error : {};
    const stdout = typeof record.stdout === 'string' ? record.stdout : '';
    const stderr = typeof record.stderr === 'string' ? record.stderr : errorMessage(error);
    const exitCode = typeof record.code === 'number' ? record.code : 1;
    await writeFile(stdoutPath, stdout);
    await writeFile(stderrPath, stderr);
    await maybeWritePartialCheckpointPayload({
      workspace,
      spec: concreteSpec,
      sessionBundleRel,
      taskRel,
      inputRel,
      outputRel: spec.outputRel,
      stdoutRel: spec.stdoutRel,
      stderrRel: spec.stderrRel,
      outputPath,
      exitCode,
      stderr,
      error,
      baseline: checkpointBaseline,
    });
    return {
      spec: concreteSpec,
      workspace,
      command,
      args,
      exitCode,
      stdoutRef: spec.stdoutRel,
      stderrRef: spec.stderrRel,
      outputRef: spec.outputRel,
      stdout,
      stderr,
      runtimeFingerprint,
    };
  }
}

async function ensureWorkspaceCompatibilityRefs(workspace: string) {
  const sciforgeRoot = join(workspace, '.sciforge');
  await Promise.all([
    ensureCompatibilityLink(join(sciforgeRoot, '.sciforge', 'artifacts'), join(sciforgeRoot, 'artifacts')),
    ensureCompatibilityLink(join(sciforgeRoot, '.sciforge', 'uploads'), join(sciforgeRoot, 'uploads')),
    ensureCompatibilityLink(join(sciforgeRoot, 'task-inputs', '.sciforge', 'artifacts'), join(sciforgeRoot, 'artifacts')),
    ensureCompatibilityLink(join(sciforgeRoot, 'task-inputs', '.sciforge', 'uploads'), join(sciforgeRoot, 'uploads')),
  ]);
}

async function ensureCompatibilityLink(linkPath: string, targetPath: string) {
  try {
    await access(linkPath);
    return;
  } catch {
    // Create below.
  }
  try {
    await mkdir(targetPath, { recursive: true });
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(targetPath, linkPath, 'dir');
  } catch {
    // Compatibility refs are best-effort; task execution still uses canonical workspace paths.
  }
}

export async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function sha1(value: string | Buffer) {
  return createHash('sha1').update(value).digest('hex');
}

async function commandFor(workspace: string, language: WorkspaceTaskSpec['language'], entrypoint: string) {
  if (language === 'python') {
    const candidates = workspaceTaskPythonCommandCandidates(workspace);
    const available: string[] = [];
    for (const candidate of candidates) {
      if (await commandExists(candidate)) available.push(candidate);
    }
    for (const candidate of available) {
      if (await pythonSupportsModernAnnotations(candidate)) return candidate;
    }
    return available[0] ?? 'python3';
  }
  if (language === 'r') return 'Rscript';
  if (language === 'shell') return 'sh';
  return entrypoint;
}

async function commandExists(command: string) {
  if (command.includes('/')) return fileExists(command);
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function pythonSupportsModernAnnotations(command: string) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 5000 });
    const version = `${stdout || stderr}`.match(/Python\s+(\d+)\.(\d+)/);
    if (!version) return false;
    const major = Number(version[1]);
    const minor = Number(version[2]);
    return major > 3 || (major === 3 && minor >= 10);
  } catch {
    return false;
  }
}

function argsFor(
  language: WorkspaceTaskSpec['language'],
  taskPath: string,
  inputPath: string,
  outputPath: string,
  entrypoint: string,
  entrypointArgs?: string[],
) {
  const resolvedTemplate = normalizeEntrypointArgTemplate(entrypointArgs, taskPath, inputPath, outputPath);
  if (resolvedTemplate.length > 0) {
    if (language === 'python' || language === 'r' || language === 'shell') {
      return [taskPath, ...stripEntrypointCommandTokens(resolvedTemplate, taskPath, entrypoint)];
    }
    return resolvedTemplate;
  }
  if (language === 'python' || language === 'r' || language === 'shell') return [taskPath, inputPath, outputPath];
  return [inputPath, outputPath].filter((item) => item !== entrypoint);
}

function normalizeEntrypointArgTemplate(args: string[] | undefined, taskPath: string, inputPath: string, outputPath: string) {
  if (!Array.isArray(args)) return [];
  return args
    .map((arg) => normalizeEntrypointArgToken(String(arg), taskPath, inputPath, outputPath))
    .filter((arg) => arg.length > 0);
}

function normalizeEntrypointArgToken(arg: string, taskPath: string, inputPath: string, outputPath: string) {
  if (isInputPathPlaceholder(arg)) return inputPath;
  if (isOutputPathPlaceholder(arg)) return outputPath;
  if (/^(?:\{taskPath\}|<taskPath>|TASK_PATH|taskPath)$/.test(arg)) return taskPath;
  return arg
    .replace(/\{inputPath\}|<inputPath>|INPUT_PATH/g, inputPath)
    .replace(/\{outputPath\}|<outputPath>|OUTPUT_PATH/g, outputPath)
    .replace(/\{taskPath\}|<taskPath>|TASK_PATH/g, taskPath);
}

function isInputPathPlaceholder(value: string) {
  const normalized = normalizeEntrypointArgPathLike(value);
  return /^(?:\{inputPath\}|<inputPath>|INPUT_PATH|inputPath|input\.json|task-input\.json)$/.test(normalized);
}

function isOutputPathPlaceholder(value: string) {
  const normalized = normalizeEntrypointArgPathLike(value);
  return /^(?:\{outputPath\}|<outputPath>|OUTPUT_PATH|outputPath|output\.json|task-output\.json)$/.test(normalized);
}

function normalizeEntrypointArgPathLike(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function stripEntrypointCommandTokens(args: string[], taskPath: string, entrypoint: string) {
  const normalizedTaskPath = taskPath.replace(/\\/g, '/');
  const normalizedEntrypoint = entrypoint.replace(/\\/g, '/');
  let next = [...args];
  while (next.length > 0 && isInterpreterToken(next[0])) {
    next = next.slice(1);
  }
  if (next.length > 0) {
    const first = next[0].replace(/\\/g, '/');
    if (first === normalizedTaskPath || first === normalizedEntrypoint || normalizedTaskPath.endsWith(`/${first}`)) {
      next = next.slice(1);
    }
  }
  return next;
}

function isInterpreterToken(value: string) {
  return /^(?:python(?:\d(?:\.\d+)?)?|python3|Rscript|bash|sh|node|tsx)$/.test(value);
}

async function inferEntrypointArgsFromTask(taskPath: string, inputPath: string) {
  let text = '';
  try {
    text = await readFile(taskPath, 'utf8');
  } catch {
    return undefined;
  }
  const hasOutputFlag = /--outputPath\b|--output-path\b|--output\b/.test(text);
  if (!hasOutputFlag) return undefined;
  const outputFlag = /--outputPath\b/.test(text) ? '--outputPath' : /--output-path\b/.test(text) ? '--output-path' : '--output';
  const inputFlag = /--inputPath\b/.test(text) ? '--inputPath' : /--input-path\b/.test(text) ? '--input-path' : /--input\b/.test(text) ? '--input' : undefined;
  return inputFlag && inputPath
    ? [inputFlag, '{inputPath}', outputFlag, '{outputPath}']
    : [outputFlag, '{outputPath}'];
}

async function fingerprint(command: string, language: WorkspaceTaskSpec['language']) {
  try {
    const versionArgs = language === 'r' ? ['--version'] : ['--version'];
    const { stdout, stderr } = await execFileAsync(command, versionArgs, { timeout: 5000 });
    return {
      language,
      command,
      version: `${stdout || stderr}`.trim().split(/\r?\n/)[0] || 'available',
    };
  } catch (error) {
    return { language, command, error: errorMessage(error) };
  }
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
}

function inferSessionBundleRel(...refs: Array<string | undefined>) {
  for (const ref of refs) {
    const normalized = ref?.replace(/\\/g, '/');
    const match = normalized?.match(/^(\.sciforge\/sessions\/[^/]+)\//);
    if (match) return match[1];
  }
  return undefined;
}

function workspaceTaskEnv(sessionResourceRootPath: string | undefined, sessionBundleRel: string | undefined) {
  return {
    ...process.env,
    SCIFORGE_SESSION_BUNDLE_REF: sessionBundleRel ?? '',
    SCIFORGE_SESSION_RESOURCE_ROOT: sessionResourceRootPath ?? '',
  };
}

interface PartialCheckpointFile {
  rel: string;
  sizeBytes: number;
  mtimeMs: number;
}

async function maybeWritePartialCheckpointPayload(input: {
  workspace: string;
  spec: WorkspaceTaskSpec;
  sessionBundleRel?: string;
  taskRel: string;
  inputRel: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
  outputPath: string;
  exitCode: number;
  stderr: string;
  error: unknown;
  baseline: Map<string, number>;
}) {
  if (!input.sessionBundleRel || await fileExists(input.outputPath)) return;
  const files = await discoverPartialCheckpointFiles(input);
  if (!files.length) return;

  const partialRefs = files.map((file) => file.rel);
  const failureReason = taskFailureReason(input.error, input.exitCode, input.stderr);
  const payload = {
    message: `Generated workspace task stopped before a final result, but SciForge preserved ${files.length} partial file${files.length === 1 ? '' : 's'} for repair or continuation.`,
    confidence: 0.35,
    claimType: 'partial-checkpoint',
    evidenceLevel: 'partial-runtime',
    reasoningTrace: [
      'SciForge runtime wrote this checkpoint after the workspace task failed before producing a final ToolPayload.',
      `failureReason=${failureReason}`,
      `taskRef=${input.taskRel}`,
      `inputRef=${input.inputRel}`,
      `outputRef=${input.outputRel}`,
      `stdoutRef=${input.stdoutRel}`,
      `stderrRef=${input.stderrRel}`,
      `partialRefs=${partialRefs.join(', ')}`,
    ].join('\n'),
    claims: [{
      text: `${files.length} partial file${files.length === 1 ? '' : 's'} are available for continuation.`,
      type: 'partial-checkpoint',
      confidence: 0.35,
      evidenceLevel: 'partial-runtime',
      supportingRefs: partialRefs,
    }],
    uiManifest: [
      { componentId: unknownArtifactInspectorComponentId, artifactRef: partialCheckpointArtifactId, priority: 1 },
      { componentId: executionUnitTableComponentId, artifactRef: partialCheckpointArtifactId, priority: 2 },
    ],
    executionUnits: [{
      id: `${safeId(input.spec.id)}-partial-checkpoint`,
      status: 'repair-needed',
      tool: workspaceTaskRunnerToolId,
      codeRef: input.taskRel,
      inputRef: input.inputRel,
      outputRef: input.outputRel,
      stdoutRef: input.stdoutRel,
      stderrRef: input.stderrRel,
      exitCode: input.exitCode,
      failureReason,
      recoverActions: [
        'reuse-partial-artifact-refs',
        'inspect-stdout-stderr',
        'resume-or-repair-generated-task',
      ],
      nextStep: 'Continue or repair the generated task using the preserved partial file refs instead of starting from an empty failed run.',
      partialRefs,
    }],
    artifacts: [
      partialCheckpointDiagnosticArtifact(input, files, failureReason),
      ...files.map((file) => partialFileArtifact(input, file)),
    ],
    objectReferences: files.map((file) => ({
      id: `file:${file.rel}`,
      title: basename(file.rel),
      kind: 'file',
      ref: `file:${file.rel}`,
      status: 'partial',
      actions: ['inspect', 'pin', 'resume'],
      provenance: {
        path: file.rel,
        outputRef: input.outputRel,
        taskCodeRef: input.taskRel,
      },
    })),
    logs: [
      { kind: 'stdout', ref: input.stdoutRel },
      { kind: 'stderr', ref: input.stderrRel },
    ],
    workEvidence: [{
      kind: 'artifact',
      id: `${safeId(input.spec.id)}-partial-files`,
      status: 'partial',
      provider: 'workspace-task-runner',
      resultCount: files.length,
      outputSummary: `Preserved ${files.length} partial file${files.length === 1 ? '' : 's'} after a failed generated workspace task.`,
      evidenceRefs: partialRefs,
      failureReason,
      recoverActions: [
        'reuse-partial-artifact-refs',
        'inspect-stdout-stderr',
        'resume-or-repair-generated-task',
      ],
      nextStep: 'Use the partial refs as continuation input before retrying expensive external fetch work.',
      rawRef: input.outputRel,
      diagnostics: [
        `exitCode=${input.exitCode}`,
        `stdoutRef=${input.stdoutRel}`,
        `stderrRef=${input.stderrRel}`,
      ],
    }],
  };

  try {
    await writeFile(input.outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    // The checkpoint is a best-effort recovery surface; stdout/stderr still carry the hard failure.
  }
}

function partialCheckpointDiagnosticArtifact(
  input: {
    spec: WorkspaceTaskSpec;
    taskRel: string;
    inputRel: string;
    outputRel: string;
    stdoutRel: string;
    stderrRel: string;
    exitCode: number;
  },
  files: PartialCheckpointFile[],
  failureReason: string,
) {
  return {
    id: 'partial-checkpoint',
    type: 'runtime-diagnostic',
    schemaVersion: 'sciforge.partial-checkpoint.v1',
    data: {
      status: 'partial',
      taskId: input.spec.id,
      failureReason,
      exitCode: input.exitCode,
      partialFiles: files.map((file) => ({
        ref: file.rel,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        type: partialArtifactType(file.rel),
      })),
      refs: {
        taskRel: input.taskRel,
        inputRel: input.inputRel,
        outputRel: input.outputRel,
        stdoutRel: input.stdoutRel,
        stderrRel: input.stderrRel,
      },
      recoverActions: [
        'reuse-partial-artifact-refs',
        'inspect-stdout-stderr',
        'resume-or-repair-generated-task',
      ],
    },
    metadata: {
      status: 'partial',
      source: 'workspace-task-runner',
      taskCodeRef: input.taskRel,
      inputRef: input.inputRel,
      outputRef: input.outputRel,
      stdoutRef: input.stdoutRel,
      stderrRef: input.stderrRel,
      createdAt: new Date().toISOString(),
    },
  };
}

function partialFileArtifact(
  input: {
    taskRel: string;
    inputRel: string;
    outputRel: string;
    stdoutRel: string;
    stderrRel: string;
  },
  file: PartialCheckpointFile,
) {
  const type = partialArtifactType(file.rel);
  const extension = extname(file.rel).replace(/^\./, '').toLowerCase();
  const id = safeId(`partial-${basename(file.rel).replace(/\.[^.]+$/, '') || type}`);
  return {
    id,
    type,
    dataRef: file.rel,
    path: file.rel,
    data: {
      ref: file.rel,
      sizeBytes: file.sizeBytes,
      extension,
      status: 'partial',
    },
    metadata: {
      title: basename(file.rel),
      status: 'partial',
      partialCheckpoint: true,
      source: 'workspace-task-runner',
      taskCodeRef: input.taskRel,
      inputRef: input.inputRel,
      outputRef: input.outputRel,
      stdoutRef: input.stdoutRel,
      stderrRef: input.stderrRel,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
    },
  };
}

async function discoverPartialCheckpointFiles(input: {
  workspace: string;
  sessionBundleRel?: string;
  baseline: Map<string, number>;
  taskRel: string;
  inputRel: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
}): Promise<PartialCheckpointFile[]> {
  if (!input.sessionBundleRel) return [];
  const current = await snapshotSessionBundleFiles(input.workspace, input.sessionBundleRel);
  const excluded = new Set([
    input.taskRel,
    input.inputRel,
    input.outputRel,
    input.stdoutRel,
    input.stderrRel,
  ]);
  const files: PartialCheckpointFile[] = [];
  for (const [rel, mtimeMs] of current) {
    if (excluded.has(rel)) continue;
    if (isRuntimeOnlySessionRef(input.sessionBundleRel, rel)) continue;
    const previousMtime = input.baseline.get(rel);
    const createdOrUpdated = previousMtime === undefined
      || mtimeMs > previousMtime + 1;
    if (!createdOrUpdated) continue;
    const absolutePath = join(input.workspace, rel);
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(absolutePath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    files.push({ rel, sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
    if (files.length >= PARTIAL_CHECKPOINT_MAX_FILES) break;
  }
  return files.sort((left, right) => left.rel.localeCompare(right.rel));
}

async function snapshotSessionBundleFiles(workspace: string, sessionBundleRel?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!sessionBundleRel) return out;
  const root = join(workspace, sessionBundleRel);
  let visited = 0;
  async function visit(dir: string) {
    if (visited >= PARTIAL_CHECKPOINT_SCAN_LIMIT) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= PARTIAL_CHECKPOINT_SCAN_LIMIT) return;
      const absolutePath = join(dir, entry.name);
      const rel = workspaceRel(workspace, absolutePath);
      if (!rel) continue;
      if (entry.isDirectory()) {
        if (!isRuntimeOnlySessionRef(sessionBundleRel, rel)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      let stats: Awaited<ReturnType<typeof stat>>;
      try {
        stats = await stat(absolutePath);
      } catch {
        continue;
      }
      visited += 1;
      out.set(rel, stats.mtimeMs);
    }
  }
  await visit(root);
  return out;
}

function workspaceRel(workspace: string, absolutePath: string) {
  const rel = relative(workspace, absolutePath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || rel.split('/').includes('..')) return undefined;
  return rel;
}

function isRuntimeOnlySessionRef(sessionBundleRel: string | undefined, rel: string) {
  if (!sessionBundleRel) return false;
  const prefix = `${sessionBundleRel.replace(/\/+$/, '')}/`;
  if (!rel.startsWith(prefix)) return false;
  const rest = rel.slice(prefix.length);
  return /^(?:records|tasks|task-inputs)(?:\/|$)/.test(rest);
}

function partialArtifactType(ref: string) {
  const ext = extname(ref).toLowerCase();
  if (ext === '.pdf') return 'document';
  if (ext === '.json' || ext === '.jsonl') return 'metadata';
  if (ext === '.csv' || ext === '.tsv') return tableArtifactType;
  if (ext === '.md' || ext === '.markdown') return reportArtifactType;
  if (ext === '.txt' || ext === '.log') return 'text';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  return 'file';
}

function taskFailureReason(error: unknown, exitCode: number, stderr: string) {
  const record = isRecord(error) ? error : {};
  const message = typeof record.message === 'string' ? record.message : errorMessage(error);
  const signal = typeof record.signal === 'string' ? record.signal : undefined;
  const timedOut = record.killed === true || /timed out|timeout/i.test(message) || signal === 'SIGTERM';
  const prefix = timedOut
    ? `Workspace task timed out or was terminated before final output (exitCode=${exitCode})`
    : `Workspace task exited ${exitCode}`;
  return `${prefix}: ${clipTaskFailureText(stderr || message)}`;
}

function clipTaskFailureText(value: string) {
  const text = String(value || '').trim();
  if (!text) return 'no stderr';
  return text.length <= 500 ? text : `${text.slice(0, 477)}...[truncated ${text.length - 477} chars]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
