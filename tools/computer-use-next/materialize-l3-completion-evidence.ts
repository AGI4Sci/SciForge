import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF } from './evidence-classification.js';

interface MaterializeArgs {
  sourceDir: string;
  targetDir: string;
  sourceFile: string;
  prefix: string;
  taskFinalArtifactRef?: string;
}

export async function materializeCuNextL3CompletionEvidence(options: MaterializeArgs): Promise<string> {
  const sourceDir = resolve(options.sourceDir);
  const targetDir = resolve(options.targetDir);
  const sourceFile = options.sourceFile || CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF;
  const prefix = normalizePrefix(options.prefix);
  const sourcePath = resolve(sourceDir, sourceFile);
  await assertRegularFileInside(sourceDir, sourcePath, 'source completion evidence');
  await mkdir(targetDir, { recursive: true });
  const payload = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
  const materialized = addTaskArtifactBinding(
    await prefixExistingLocalRefs(payload, sourceDir, prefix),
    options.taskFinalArtifactRef,
  );
  const targetPath = resolve(targetDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  if (!isPathInsideOrSame(targetDir, targetPath)) {
    throw new Error('target completion evidence path escapes targetDir');
  }
  await writeFile(targetPath, `${JSON.stringify(materialized, null, 2)}\n`, 'utf8');
  return targetPath;
}

function addTaskArtifactBinding(value: unknown, taskFinalArtifactRef: string | undefined): unknown {
  if (!taskFinalArtifactRef || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    taskFinalArtifactRefs: uniqueStrings([
      ...stringArray(record.taskFinalArtifactRefs),
      taskFinalArtifactRef,
    ]),
    taskArtifactBinding: {
      ...(record.taskArtifactBinding && typeof record.taskArtifactBinding === 'object' && !Array.isArray(record.taskArtifactBinding)
        ? record.taskArtifactBinding as Record<string, unknown>
        : {}),
      finalArtifactRef: taskFinalArtifactRef,
      finalArtifactRefs: uniqueStrings([
        ...stringArray(recordValue(record.taskArtifactBinding).finalArtifactRefs),
        taskFinalArtifactRef,
      ]),
      supportingL3FinalArtifactRef: typeof record.finalArtifactRef === 'string' ? record.finalArtifactRef : undefined,
      source: 'cu-next-current-task-final-artifact-binding',
    },
  };
}

async function prefixExistingLocalRefs(value: unknown, sourceDir: string, prefix: string): Promise<unknown> {
  if (typeof value === 'string') return prefixLocalRefIfExisting(value, sourceDir, prefix);
  if (Array.isArray(value)) return Promise.all(value.map((item) => prefixExistingLocalRefs(item, sourceDir, prefix)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, entry]) => [
      key,
      await prefixExistingLocalRefs(entry, sourceDir, prefix),
    ] as const));
    return Object.fromEntries(entries);
  }
  return value;
}

async function prefixLocalRefIfExisting(value: string, sourceDir: string, prefix: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed || !isBundleLocalRef(trimmed)) return value;
  const [refPath, suffix] = splitRefSuffix(trimmed);
  const sourcePath = resolve(sourceDir, refPath);
  try {
    await assertRegularFileInside(sourceDir, sourcePath, `nested ref ${trimmed}`);
  } catch {
    return value;
  }
  return `${prefix}${refPath}${suffix}`;
}

function splitRefSuffix(ref: string): [string, string] {
  const hash = ref.indexOf('#');
  const query = ref.indexOf('?');
  const positions = [hash, query].filter((index) => index >= 0);
  if (!positions.length) return [ref, ''];
  const split = Math.min(...positions);
  return [ref.slice(0, split), ref.slice(split)];
}

function isBundleLocalRef(ref: string): boolean {
  if (isAbsolute(ref) || ref.startsWith('~')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
  return ref.replace(/\\/g, '/').split('/').every((part) => part && part !== '.' && part !== '..');
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || !isBundleLocalRef(`${normalized}/placeholder`)) {
    throw new Error(`Invalid bundle-local prefix: ${prefix}`);
  }
  return `${normalized}/`;
}

async function assertRegularFileInside(baseDir: string, path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  const baseReal = await realpath(baseDir);
  const targetReal = await realpath(path);
  if (!isPathInsideOrSame(baseReal, targetReal)) throw new Error(`${label} must stay inside sourceDir`);
}

function isPathInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function parseArgs(argv: string[]): MaterializeArgs {
  const args: Partial<MaterializeArgs> = {
    sourceFile: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-dir') {
      args.sourceDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--target-dir') {
      args.targetDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--source-file') {
      args.sourceFile = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--prefix') {
      args.prefix = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--task-final-artifact-ref') {
      args.taskFinalArtifactRef = requiredValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.sourceDir) throw new Error('--source-dir is required');
  if (!args.targetDir) throw new Error('--target-dir is required');
  if (!args.prefix) throw new Error('--prefix is required');
  return args as MaterializeArgs;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function isMaterializeL3CompletionEvidenceCliEntrypoint(argv1 = process.argv[1]): boolean {
  const entry = argv1 ? basename(argv1) : '';
  return entry === 'materialize-l3-completion-evidence.ts' || entry === 'materialize-l3-completion-evidence.js';
}

if (isMaterializeL3CompletionEvidenceCliEntrypoint()) {
  const targetPath = await materializeCuNextL3CompletionEvidence(parseArgs(process.argv.slice(2)));
  process.stdout.write(`[ok] materialized ${targetPath}\n`);
}
