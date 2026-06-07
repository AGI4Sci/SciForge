import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { sha1 } from '../workspace-task-runner.js';
import type { WorkEvidence } from './work-evidence-types.js';

export interface GeneratedTaskWorkspaceSideEffectSnapshot {
  workspace: string;
  files: Record<string, GeneratedTaskWorkspaceFileSnapshot>;
  truncated: boolean;
}

interface GeneratedTaskWorkspaceFileSnapshot {
  size: number;
  mtimeMs: number;
  sha1?: string;
}

const DEFAULT_MAX_FILES = 1200;
const DEFAULT_MAX_HASH_BYTES = 2 * 1024 * 1024;

export async function captureGeneratedTaskWorkspaceSideEffectSnapshot(
  workspace: string,
  options: { maxFiles?: number; maxHashBytes?: number } = {},
): Promise<GeneratedTaskWorkspaceSideEffectSnapshot> {
  const root = resolve(workspace);
  const files: Record<string, GeneratedTaskWorkspaceFileSnapshot> = {};
  let truncated = false;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxHashBytes = options.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES;

  async function walk(dir: string) {
    if (Object.keys(files).length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (Object.keys(files).length >= maxFiles) {
        truncated = true;
        return;
      }
      const absolute = join(dir, entry.name);
      const rel = workspaceRel(root, absolute);
      if (!rel || ignoredWorkspaceSideEffectPath(rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !candidateExtensionAllowed(rel)) continue;
      try {
        const info = await stat(absolute);
        const hash = info.size <= maxHashBytes ? sha1(await readFile(absolute)) : undefined;
        files[rel] = { size: info.size, mtimeMs: info.mtimeMs, sha1: hash };
      } catch {
        // Best-effort side-effect capture; runtime failure handling must still proceed.
      }
    }
  }

  await walk(root);
  return { workspace: root, files, truncated };
}

export async function workEvidenceFromGeneratedTaskWorkspaceSideEffects(
  before: GeneratedTaskWorkspaceSideEffectSnapshot | undefined,
  workspace: string,
  options: { maxFiles?: number; maxHashBytes?: number } = {},
): Promise<WorkEvidence[]> {
  if (!before) return [];
  const after = await captureGeneratedTaskWorkspaceSideEffectSnapshot(workspace, options);
  return Object.entries(after.files)
    .filter(([rel, snapshot]) => workspaceFileChanged(before.files[rel], snapshot))
    .slice(0, 12)
    .map(([rel, snapshot]) => {
      const existedBefore = Boolean(before.files[rel]);
      return {
        kind: 'write',
        status: 'success',
        input: {
          path: rel,
          sideEffect: existedBefore ? 'modified-existing-file' : 'created-file',
        },
        outputSummary: existedBefore
          ? 'Backend generated-task flow modified an existing workspace file before terminal response failed.'
          : 'Backend generated-task flow created a workspace file before terminal response failed.',
        evidenceRefs: [rel],
        recoverActions: [
          'Inspect and verify the changed file before using it as the final answer.',
          'Rerun the relevant tests or commands against the changed workspace file.',
        ],
        diagnostics: [
          `size=${snapshot.size}`,
          before.truncated || after.truncated ? 'snapshot=truncated' : '',
        ].filter(Boolean),
        rawRef: rel,
      } satisfies WorkEvidence;
    });
}

function workspaceFileChanged(before: GeneratedTaskWorkspaceFileSnapshot | undefined, after: GeneratedTaskWorkspaceFileSnapshot) {
  if (!before) return true;
  if (before.sha1 && after.sha1) return before.sha1 !== after.sha1;
  return before.size !== after.size || before.mtimeMs !== after.mtimeMs;
}

function workspaceRel(root: string, absolute: string) {
  const rel = relative(root, resolve(absolute)).split(sep).join('/');
  if (!rel || rel.startsWith('..') || rel.includes('/../')) return undefined;
  return rel;
}

function ignoredWorkspaceSideEffectPath(rel: string, isDirectory: boolean) {
  const first = rel.split('/')[0];
  if (['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', 'dist', 'build'].includes(first)) return true;
  if (first === '.sciforge') return true;
  if (isDirectory && rel.includes('/__pycache__')) return true;
  return false;
}

function candidateExtensionAllowed(ref: string) {
  const ext = extname(ref).toLowerCase();
  return [
    '.py', '.ipynb', '.r', '.jl', '.m', '.js', '.jsx', '.ts', '.tsx', '.sh',
    '.md', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html',
  ].includes(ext);
}
