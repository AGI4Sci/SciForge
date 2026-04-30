import { readFile, readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';

interface CandidateFile {
  abs: string;
  rel: string;
  size: number;
  mtimeMs: number;
}

const DEFAULT_TARGETS = ['task-inputs', 'task-results', 'logs', 'debug', 'task-attempts', 'versions'];

const args = parseArgs(process.argv.slice(2));
const workspace = resolve(String(args.workspace || await readConfiguredWorkspacePath() || join(process.cwd(), 'workspace')));
const targets = String(args.targets || DEFAULT_TARGETS.join(','))
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);
const apply = Boolean(args.apply);
const keepDays = numberArg(args['keep-days']);
const maxBytes = numberArg(args['max-bytes']);
const runFilter = stringArg(args.run);
const sessionFilter = stringArg(args.session);

const candidates = (await Promise.all(targets.map((target) => collectFiles(join(workspace, '.bioagent', target), `.bioagent/${target}`)))).flat();
const matched = candidates.filter((file) => matchesScope(file, runFilter, sessionFilter));
const byAge = keepDays === undefined
  ? []
  : matched.filter((file) => file.mtimeMs <= Date.now() - keepDays * 24 * 60 * 60 * 1000);
const byBudget = maxBytes === undefined ? [] : filesOverBudget(matched, maxBytes);
const selected = dedupeFiles([...byAge, ...byBudget]).sort((left, right) => left.rel.localeCompare(right.rel));

if (apply) {
  for (const file of selected) {
    await rm(file.abs, { force: true });
  }
}

const summary = {
  workspace,
  apply,
  targets,
  scope: { run: runFilter, session: sessionFilter },
  policy: { keepDays, maxBytes },
  scannedFiles: candidates.length,
  matchedFiles: matched.length,
  deletedFiles: apply ? selected.length : 0,
  prunableFiles: selected.length,
  prunableBytes: selected.reduce((total, file) => total + file.size, 0),
  sample: selected.slice(0, 20).map((file) => ({ rel: file.rel, size: file.size })),
};

console.log(JSON.stringify(summary, null, 2));

async function collectFiles(dir: string, relPrefix: string): Promise<CandidateFile[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const abs = join(dir, entry.name);
    const rel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) return collectFiles(abs, rel);
    if (!entry.isFile()) return [];
    try {
      const info = await stat(abs);
      return [{ abs, rel, size: info.size, mtimeMs: info.mtimeMs }];
    } catch {
      return [];
    }
  }));
  return nested.flat();
}

function filesOverBudget(files: CandidateFile[], maxBytes: number) {
  const newestFirst = [...files].sort((left, right) => right.mtimeMs - left.mtimeMs);
  let total = newestFirst.reduce((sum, file) => sum + file.size, 0);
  const remove: CandidateFile[] = [];
  for (const file of [...newestFirst].reverse()) {
    if (total <= maxBytes) break;
    remove.push(file);
    total -= file.size;
  }
  return remove;
}

function matchesScope(file: CandidateFile, run?: string, session?: string) {
  const haystack = `${file.rel}\n${relative(workspace, file.abs)}`;
  if (run && !haystack.includes(run)) return false;
  if (session && !haystack.includes(session)) return false;
  return true;
}

function dedupeFiles(files: CandidateFile[]) {
  const seen = new Set<string>();
  const out: CandidateFile[] = [];
  for (const file of files) {
    if (seen.has(file.abs)) continue;
    seen.add(file.abs);
    out.push(file);
  }
  return out;
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function readConfiguredWorkspacePath() {
  try {
    const parsed = JSON.parse(await readFile(join(process.cwd(), 'config.local.json'), 'utf8'));
    if (isRecord(parsed) && isRecord(parsed.bioagent) && typeof parsed.bioagent.workspacePath === 'string') {
      return parsed.bioagent.workspacePath;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function numberArg(value: unknown) {
  if (value === undefined || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringArg(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
