import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export function pathForComputerUseChatWorkspaceRef(workspacePath: string, ref: string): string | undefined {
  const text = ref.trim().replace(/^file:/, '');
  if (!text || /^(?:https?|artifact|audit|workEvidence|EU):/i.test(text)) return undefined;
  const workspace = resolve(workspacePath);
  const resolved = text.startsWith('/') ? resolve(text) : resolve(workspace, text);
  return resolved === workspace || resolved.startsWith(`${workspace}${sep}`) ? resolved : undefined;
}

export function isComputerUseChatWorkspaceLocalRef(ref: string): boolean {
  return Boolean(ref)
    && !ref.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref)
    && !ref.split('/').includes('..');
}

export function refsFromComputerUseTuiHostRunTaskChain(chain: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...refsFromUnknown(chain),
    ...refsFromUnknown(chain.refs),
    ...recordList(chain.links).map((link) => stringAt(link, 'recordRef')),
  ]);
}

export async function readComputerUseChatJsonRefs(
  refs: string[],
  workspacePath: string,
  readIssues: string[],
): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const ref of uniqueStrings(refs)) {
    const path = pathForComputerUseChatWorkspaceRef(workspacePath, ref);
    if (!path) continue;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (isRecord(parsed)) records.push(parsed);
      else readIssues.push(`not-json-object:${ref}`);
    } catch {
      readIssues.push(`read-failed:${ref}`);
    }
  }
  return records;
}

export async function readOptionalComputerUseChatJsonRecord(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function expandComputerUseChatCurrentRunEvidenceRefs(
  refs: string[],
  workspacePath: string,
  readIssues: string[],
): Promise<string[]> {
  let expanded = uniqueStrings(refs);
  for (let index = 0; index < 3; index += 1) {
    const before = expanded.length;
    const runTaskChains = await readComputerUseChatJsonRefs(
      expanded.filter((ref) => /(?:^|\/)tui-host-run-task-chain\.json$/i.test(ref)),
      workspacePath,
      readIssues,
    );
    const directoryListings = await readComputerUseChatJsonRefs(
      expanded.filter((ref) => /(?:^|\/)directory-listing\.json$/i.test(ref)),
      workspacePath,
      readIssues,
    );
    expanded = uniqueStrings([
      ...expanded,
      ...runTaskChains.flatMap(refsFromComputerUseTuiHostRunTaskChain),
      ...directoryListings.flatMap((listing) => stringList(listing.fileRefs)),
    ]);
    if (expanded.length === before) break;
  }
  return expanded;
}

function refsFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return looksLikeEvidenceRef(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => refsFromUnknown(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => refsFromUnknown(item, depth + 1));
}

function looksLikeEvidenceRef(value: string): boolean {
  return /(?:^\.sciforge\/|^\/|\.json$|\.png$|\.jpe?g$|\.webp$|^artifact:|^audit:|^workEvidence:|^EU-)/i.test(value.trim());
}

function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
