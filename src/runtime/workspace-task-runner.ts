import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceTaskRunResult, WorkspaceTaskSpec } from './runtime-types.js';

const execFileAsync = promisify(execFile);

export async function runWorkspaceTask(workspacePath: string, spec: WorkspaceTaskSpec): Promise<WorkspaceTaskRunResult> {
  const workspace = resolve(workspacePath || process.cwd());
  const taskRel = spec.taskRel ?? `.bioagent/tasks/${safeId(spec.id)}.task`;
  const concreteSpec = { ...spec, taskRel };
  const taskPath = join(workspace, taskRel);
  const inputRel = `.bioagent/task-inputs/${safeId(spec.id)}.json`;
  const inputPath = join(workspace, inputRel);
  const outputPath = join(workspace, spec.outputRel);
  const stdoutPath = join(workspace, spec.stdoutRel);
  const stderrPath = join(workspace, spec.stderrRel);

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
  await writeFile(inputPath, JSON.stringify({
    ...spec.input,
    workspacePath: workspace,
    taskCodeRef: taskRel,
    inputRef: inputRel,
    outputRef: spec.outputRel,
    stdoutRef: spec.stdoutRel,
    stderrRef: spec.stderrRel,
  }, null, 2));

  const command = await commandFor(workspace, spec.language, spec.entrypoint);
  const taskInputArg = spec.inputArgMode === 'empty-data-path' ? '' : inputPath;
  const args = argsFor(spec.language, taskPath, taskInputArg, outputPath, spec.entrypoint);
  const runtimeFingerprint = await fingerprint(command, spec.language);
  try {
    const result = await execFileAsync(command, args, {
      cwd: workspace,
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
    const candidates = [
      join(workspace, '.venv-bioagent', 'bin', 'python'),
      join(workspace, '.venv-bioagent-omics', 'bin', 'python'),
      join(workspace, '.venv', 'bin', 'python'),
      'python3',
    ];
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

function argsFor(language: WorkspaceTaskSpec['language'], taskPath: string, inputPath: string, outputPath: string, entrypoint: string) {
  if (language === 'python' || language === 'r' || language === 'shell') return [taskPath, inputPath, outputPath];
  return [inputPath, outputPath].filter((item) => item !== entrypoint);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
