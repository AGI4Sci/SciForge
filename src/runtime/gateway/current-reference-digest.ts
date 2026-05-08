import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GatewayRequest } from '../runtime-types.js';
import { clipForAgentServerPrompt, isRecord, safeWorkspaceRel, toRecordList, uniqueStrings } from '../gateway-utils.js';
import { fileExists, sha1 } from '../workspace-task-runner.js';

const execFileAsync = promisify(execFile);
const MAX_EXTRACT_CHARS = 700_000;
const MAX_DIGEST_EXCERPT_CHARS = 8_000;

export async function requestWithCurrentReferenceDigests(request: GatewayRequest, workspace: string): Promise<GatewayRequest> {
  const currentReferences = [
    ...toRecordList(request.uiState?.currentReferences),
    ...await promptPathReferences(request.prompt, workspace),
  ];
  if (!currentReferences.length) return request;
  const digests = (await Promise.all(currentReferences.map((entry) => digestCurrentReference(entry, workspace))))
    .filter((entry) => Boolean(entry));
  if (!digests.length) return request;
  const mergedReferences = mergeReferenceRecords(toRecordList(request.uiState?.currentReferences), currentReferences);
  return {
    ...request,
    uiState: {
      ...(isRecord(request.uiState) ? request.uiState : {}),
      currentReferences: mergedReferences,
      currentReferenceDigests: digests,
    },
  };
}

async function promptPathReferences(prompt: string, workspace: string) {
  const explicitRefs = extractWorkspaceLikeRefs(prompt);
  const siblingDirs = uniqueStrings(explicitRefs
    .map((ref) => dirname(ref.replace(/^file:/, '')))
    .filter((dir) => dir && dir !== '.'));
  const bareNames = extractBareFileNames(prompt)
    .filter((name) => !explicitRefs.some((ref) => basename(ref.replace(/^file:/, '')) === name));
  const resolvedBareRefs = await resolveBareFileRefs(bareNames, siblingDirs, workspace);
  return uniqueStrings([...explicitRefs, ...resolvedBareRefs])
    .map((ref) => ({
      ref,
      path: ref,
      source: 'prompt-path',
      label: basename(ref),
    }));
}

function extractWorkspaceLikeRefs(prompt: string) {
  const refs: string[] = [];
  const pattern = /(?:^|[\s"'`(\[，。；：、])((?:file:)?(?:\/[^\s"'`)\]，。；：、]+|(?:workspace\/|\.sciforge\/|\.\/workspace\/)[^\s"'`)\]，。；：、]+?\.(?:pdf|txt|md|markdown|csv|tsv|json|log)))(?=$|[\s"'`)\]，。；：、])/gi;
  for (const match of prompt.matchAll(pattern)) {
    const normalized = normalizePromptRef(match[1]);
    if (normalized) refs.push(normalized);
  }
  return uniqueStrings(refs);
}

function extractBareFileNames(prompt: string) {
  const refs: string[] = [];
  const pattern = /(?:^|[\s"'`(\[，。；：、])([A-Za-z0-9._-]+\.(?:pdf|txt|md|markdown|csv|tsv|json|log))(?=$|[\s"'`)\]，。；：、])/gi;
  for (const match of prompt.matchAll(pattern)) refs.push(match[1]);
  return uniqueStrings(refs);
}

function normalizePromptRef(value: string) {
  let ref = value.trim().replace(/^file:/, '').replace(/^\.\/workspace\//, 'workspace/');
  if (ref.startsWith('workspace/')) ref = ref.slice('workspace/'.length);
  return ref || undefined;
}

async function resolveBareFileRefs(names: string[], siblingDirs: string[], workspace: string) {
  if (!names.length) return [];
  const resolved: string[] = [];
  for (const name of names) {
    const sibling = siblingDirs
      .map((dir) => join(dir, name))
      .find((candidate) => workspacePath(workspace, candidate));
    if (sibling && await fileExists(workspacePath(workspace, sibling) || '')) {
      resolved.push(sibling);
      continue;
    }
    const matches = await findWorkspaceFilesByBasename(workspace, name, 2);
    if (matches.length === 1) resolved.push(matches[0]);
  }
  return uniqueStrings(resolved);
}

async function findWorkspaceFilesByBasename(workspace: string, name: string, maxMatches: number) {
  const root = resolve(workspace);
  const matches: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (matches.length >= maxMatches || depth > 7) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxMatches) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs, depth + 1);
      } else if (entry.isFile() && entry.name === name) {
        matches.push(abs.slice(root.length + 1));
      }
    }
  }
  await visit(root, 0);
  return matches;
}

function mergeReferenceRecords(existing: Record<string, unknown>[], discovered: Record<string, unknown>[]) {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const entry of [...existing, ...discovered]) {
    const key = pickReferencePath(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

async function digestCurrentReference(entry: Record<string, unknown>, workspace: string) {
  const sourceRef = pickReferencePath(entry);
  if (!sourceRef) return undefined;
  const abs = workspacePath(workspace, sourceRef);
  if (!abs || !await fileExists(abs)) {
    return {
      sourceRef,
      status: 'missing',
      failureReason: 'Current reference path is not readable from the active workspace.',
    };
  }
  const text = await extractReferenceText(abs);
  if (!text.trim()) {
    return {
      sourceRef,
      status: 'unreadable',
      failureReason: 'Current reference produced no extractable text.',
    };
  }
  const normalized = normalizeText(text).slice(0, MAX_EXTRACT_CHARS);
  const digestId = `current-reference-${sha1(`${sourceRef}:${normalized.slice(0, 4096)}`).slice(0, 12)}`;
  const rel = `.sciforge/artifacts/current-reference-digests/${digestId}.txt`;
  await mkdir(join(resolve(workspace), '.sciforge', 'artifacts', 'current-reference-digests'), { recursive: true });
  await writeFile(join(resolve(workspace), rel), normalized, 'utf8');
  return {
    sourceRef,
    status: 'ready',
    digestRef: `file:${rel}`,
    textChars: normalized.length,
    sha1: sha1(normalized),
    excerpts: boundedExcerpts(normalized),
  };
}

function pickReferencePath(entry: Record<string, unknown>) {
  const fields = ['ref', 'path', 'dataRef', 'fileRef', 'sourceRef', 'url', 'id'];
  const candidates = uniqueStrings(fields
    .map((field) => entry[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().replace(/^file:/, '')));
  return candidates.find((value) => /\.(pdf|txt|md|markdown|csv|tsv|json)$/i.test(value) || value.startsWith('.sciforge/'));
}

function workspacePath(workspace: string, ref: string) {
  if (/^[a-z]+:\/\//i.test(ref)) return undefined;
  try {
    const root = resolve(workspace);
    const path = ref.startsWith('/') ? resolve(ref) : resolve(root, safeWorkspaceRel(ref));
    if (!path.startsWith(`${root}/`) && path !== root && ref.startsWith('workspace/')) {
      const withoutWorkspace = ref.slice('workspace/'.length);
      const fallback = resolve(root, safeWorkspaceRel(withoutWorkspace));
      return fallback === root || fallback.startsWith(`${root}/`) ? fallback : undefined;
    }
    return path === root || path.startsWith(`${root}/`) ? path : undefined;
  } catch {
    return undefined;
  }
}

async function extractReferenceText(abs: string) {
  const ext = extname(abs).toLowerCase();
  if (ext === '.pdf') {
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', abs, '-'], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return '';
    }
  }
  if (['.txt', '.md', '.markdown', '.csv', '.tsv', '.json'].includes(ext)) {
    return readFile(abs, 'utf8');
  }
  return '';
}

function normalizeText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function boundedExcerpts(text: string) {
  const excerpts: Array<{ label: string; text: string }> = [];
  addExcerpt(excerpts, 'head', text.slice(0, 2200));
  for (const label of ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion']) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*(?:\\n|$)([\\s\\S]{0,2600})`, 'i'));
    if (match?.[0]) addExcerpt(excerpts, label, match[0]);
  }
  addExcerpt(excerpts, 'tail', text.slice(Math.max(0, text.length - 2200)));
  let budget = MAX_DIGEST_EXCERPT_CHARS;
  return excerpts.map((excerpt) => {
    const clipped = clipForAgentServerPrompt(excerpt.text, Math.max(400, Math.min(1800, budget))) || '';
    budget -= clipped.length;
    return { ...excerpt, text: clipped };
  }).filter((excerpt) => excerpt.text && budget > -1800);
}

function addExcerpt(excerpts: Array<{ label: string; text: string }>, label: string, text: string) {
  const clean = normalizeText(text);
  if (!clean) return;
  if (excerpts.some((entry) => entry.label === label || entry.text === clean)) return;
  excerpts.push({ label, text: clean });
}
