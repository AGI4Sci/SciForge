import { access, copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceTaskRunResult, WorkspaceTaskSpec } from './runtime-types.js';
import { pruneTaskInputRetention } from './workspace-retention.js';
import { buildWorkspaceTaskInput } from './workspace-task-input.js';
import { workspaceTaskPythonCommandCandidates } from '../../packages/skills/runtime-policy';

const execFileAsync = promisify(execFile);

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
    await writeFile(stdoutPath, stdout);
    await writeFile(stderrPath, stderr);
    return {
      spec: concreteSpec,
      workspace,
      command,
      args,
      exitCode: typeof record.code === 'number' ? record.code : 1,
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
  if (/^(?:\{inputPath\}|<inputPath>|INPUT_PATH|inputPath)$/.test(arg)) return inputPath;
  if (/^(?:\{outputPath\}|<outputPath>|OUTPUT_PATH|outputPath)$/.test(arg)) return outputPath;
  if (/^(?:\{taskPath\}|<taskPath>|TASK_PATH|taskPath)$/.test(arg)) return taskPath;
  return arg
    .replace(/\{inputPath\}|<inputPath>|INPUT_PATH/g, inputPath)
    .replace(/\{outputPath\}|<outputPath>|OUTPUT_PATH/g, outputPath)
    .replace(/\{taskPath\}|<taskPath>|TASK_PATH/g, taskPath);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
