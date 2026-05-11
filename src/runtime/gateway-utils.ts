import { readFile } from 'node:fs/promises';
import { sha1 } from './workspace-task-runner.js';

export function extractLikelyErrorLine(text: string) {
  const matches = Array.from(text.matchAll(/line\s+(\d+)/gi));
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  const line = Number(last[1]);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

export function excerptAroundFailureLine(code: string, failureEvidence: string) {
  const line = extractLikelyErrorLine(failureEvidence);
  if (!line) return headForAgentServer(code, 8000);
  const lines = code.split(/\r?\n/);
  const start = Math.max(0, line - 16);
  const end = Math.min(lines.length, line + 15);
  return lines.slice(start, end).map((entry, index) => {
    const lineNumber = start + index + 1;
    const marker = lineNumber === line ? '>>' : '  ';
    return `${marker} ${lineNumber}: ${entry}`;
  }).join('\n');
}

export function headForAgentServer(value: string, maxLength: number) {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... [truncated head ${value.length - maxLength} chars]` : value;
}

export function tailForAgentServer(value: string, maxLength: number) {
  if (!value) return '';
  return value.length > maxLength ? `[truncated tail ${value.length - maxLength} chars] ...\n${value.slice(-maxLength)}` : value;
}

export function hashJson(value: unknown) {
  return sha1(JSON.stringify(clipForAgentServerJson(value, 0))).slice(0, 16);
}

export function clipForAgentServerPrompt(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function clipForAgentServerJson(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 2400 ? `${normalized.slice(0, 2400)}... [truncated ${normalized.length - 2400} chars]` : normalized;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 5) return '[truncated-depth]';
  if (Array.isArray(value)) {
    const limit = depth <= 1 ? 24 : 12;
    const clipped = value.slice(0, limit).map((entry) => clipForAgentServerJson(entry, depth + 1));
    if (value.length > limit) clipped.push(`[truncated ${value.length - limit} entries]`);
    return clipped;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
      continue;
    }
    out[key] = clipForAgentServerJson(entry, depth + 1);
  }
  return out;
}

export function safeWorkspaceRel(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error(`Unsafe workspace-relative path: ${path}`);
  return normalized;
}

export function generatedTaskArchiveRel(taskId: string, path: string, sessionBundleRel?: string) {
  const rel = safeWorkspaceRel(path);
  const archivePrefix = '.sciforge/tasks/';
  const withoutArchivePrefix = rel.startsWith(archivePrefix) ? rel.slice(archivePrefix.length) : rel;
  const withoutTaskPrefix = withoutArchivePrefix.startsWith(`${taskId}/`)
    ? withoutArchivePrefix.slice(taskId.length + 1)
    : withoutArchivePrefix;
  const archived = withoutTaskPrefix || 'task.py';
  if (sessionBundleRel) return `${sessionBundleRel.replace(/\/+$/, '')}/tasks/${taskId}/${archived}`;
  return `${archivePrefix}${taskId}/${archived}`;
}

export function isTaskInputRel(path: string) {
  return safeWorkspaceRel(path).startsWith('.sciforge/task-inputs/');
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function cleanUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export async function readTextIfExists(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export function summarizeTextChange(before: string, after: string, agentSummary?: string) {
  const lines = [
    agentSummary ? `AgentServer summary:\n${agentSummary}` : '',
    before === after
      ? 'No direct change detected in the task code file.'
      : [
          'Task code changed.',
          `Before SHA1: ${sha1(before).slice(0, 12)}`,
          `After SHA1: ${sha1(after).slice(0, 12)}`,
          simpleLineDiff(before, after),
        ].join('\n'),
  ].filter(Boolean);
  return lines.join('\n\n');
}

function simpleLineDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const changes: string[] = [];
  for (let index = 0; index < max && changes.length < 80; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (beforeLines[index] !== undefined) changes.push(`-${index + 1}: ${beforeLines[index]}`);
    if (afterLines[index] !== undefined) changes.push(`+${index + 1}: ${afterLines[index]}`);
  }
  if (changes.length === 80) changes.push('...diff truncated...');
  return changes.join('\n') || 'Content changed, but no line-level preview was produced.';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
