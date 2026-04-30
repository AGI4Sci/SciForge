import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export interface TaskInputRetentionOptions {
  maxFiles?: number;
  maxBytes?: number;
  protectedRels?: string[];
}

export interface RetentionPruneResult {
  deletedFiles: number;
  remainingFiles: number;
  remainingBytes: number;
}

const DEFAULT_TASK_INPUT_MAX_FILES = 160;
const DEFAULT_TASK_INPUT_MAX_BYTES = 1024 * 1024 * 1024;

export async function pruneTaskInputRetention(
  workspacePath: string,
  options: TaskInputRetentionOptions = {},
): Promise<RetentionPruneResult> {
  const workspace = resolve(workspacePath || process.cwd());
  const dir = join(workspace, '.bioagent', 'task-inputs');
  const localConfig = await readTaskInputRetentionConfig();
  const maxFiles = retentionLimit(
    options.maxFiles,
    'BIOAGENT_TASK_INPUT_MAX_FILES',
    localConfig.maxFiles,
    DEFAULT_TASK_INPUT_MAX_FILES,
  );
  const maxBytes = retentionLimit(
    options.maxBytes,
    'BIOAGENT_TASK_INPUT_MAX_BYTES',
    localConfig.maxBytes,
    DEFAULT_TASK_INPUT_MAX_BYTES,
  );
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { deletedFiles: 0, remainingFiles: 0, remainingBytes: 0 };
  }

  const protectedNames = new Set((options.protectedRels ?? []).map((rel) => basename(rel)));
  const files = (await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const path = join(dir, entry.name);
      try {
        const info = await stat(path);
        return {
          name: entry.name,
          path,
          size: info.size,
          mtimeMs: info.mtimeMs,
          protected: protectedNames.has(entry.name),
        };
      } catch {
        return undefined;
      }
    }))).filter((file): file is NonNullable<typeof file> => Boolean(file));

  if (!files.length) return { deletedFiles: 0, remainingFiles: 0, remainingBytes: 0 };

  const newestFirst = [...files].sort((left, right) => right.mtimeMs - left.mtimeMs);
  const keep = new Set<string>();
  for (const file of newestFirst) {
    if (file.protected) keep.add(file.name);
  }

  const protectedCount = keep.size;
  const nonProtectedAllowance = Math.max(0, maxFiles - protectedCount);
  let nonProtectedKept = 0;
  for (const file of newestFirst) {
    if (file.protected) continue;
    if (nonProtectedKept < nonProtectedAllowance) {
      keep.add(file.name);
      nonProtectedKept += 1;
    }
  }

  let remainingBytes = files
    .filter((file) => keep.has(file.name))
    .reduce((total, file) => total + file.size, 0);
  const oldestFirst = [...files].sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of oldestFirst) {
    if (remainingBytes <= maxBytes) break;
    if (file.protected || !keep.has(file.name)) continue;
    keep.delete(file.name);
    remainingBytes -= file.size;
  }

  let deletedFiles = 0;
  for (const file of files) {
    if (keep.has(file.name)) continue;
    try {
      await unlink(file.path);
      deletedFiles += 1;
    } catch {
      // Retention cleanup is best-effort; a stale file should not fail a user task.
    }
  }

  return {
    deletedFiles,
    remainingFiles: files.length - deletedFiles,
    remainingBytes,
  };
}

async function readTaskInputRetentionConfig() {
  try {
    const parsed = JSON.parse(await readFile(join(process.cwd(), 'config.local.json'), 'utf8'));
    if (!isRecord(parsed)) return {};
    const bioagent = isRecord(parsed.bioagent) ? parsed.bioagent : {};
    const direct = isRecord(bioagent.taskInputRetention) ? bioagent.taskInputRetention : {};
    const runtime = isRecord(bioagent.runtimeRetention) ? bioagent.runtimeRetention : {};
    return {
      maxFiles: numberField(direct.maxFiles) ?? numberField(runtime.taskInputMaxFiles),
      maxBytes: numberField(direct.maxBytes) ?? numberField(runtime.taskInputMaxBytes),
    };
  } catch {
    return {};
  }
}

function retentionLimit(explicit: number | undefined, envName: string, configured: number | undefined, fallback: number) {
  const value = explicit ?? numberFromEnv(envName) ?? configured ?? fallback;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function numberFromEnv(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
