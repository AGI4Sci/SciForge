import type { AgentServerGenerationResponse, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { cleanUrl, errorMessage, isRecord, uniqueStrings } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { parseJsonErrorMessage, sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { coerceAgentServerToolPayload, extractJson, extractStandaloneJson } from './direct-answer-payload.js';
import { isToolPayload } from './tool-payload-contract.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseGenerationResponse(value: unknown): AgentServerGenerationResponse | undefined {
  const candidates = [
    value,
    isRecord(value) ? value.result : undefined,
    isRecord(value) ? value.text : undefined,
    isRecord(value) ? value.finalText : undefined,
    isRecord(value) ? value.handoffSummary : undefined,
    isRecord(value) ? value.outputSummary : undefined,
    ...structuredTextCandidates(value),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractStandaloneJson(candidate) ?? extractJson(candidate) : candidate;
    if (isRecord(parsed)) {
      const taskFiles = Array.isArray(parsed.taskFiles)
        ? parsed.taskFiles
          .map((file) => {
            if (isRecord(file) && stringField(file.path)) return file;
            return undefined;
          })
          .filter(isRecord)
        : [];
      const entrypoint = normalizeGenerationEntrypoint(parsed.entrypoint);
      if (taskFiles.length && typeof entrypoint.path === 'string') {
        return {
          taskFiles: taskFiles.map((file) => ({
            path: String(file.path || ''),
            content: typeof file.content === 'string' ? file.content : undefined,
            language: String(file.language || 'python'),
          })),
          entrypoint: {
            language: entrypoint.language === 'r' || entrypoint.language === 'shell' || entrypoint.language === 'cli' ? entrypoint.language : 'python',
            path: String(entrypoint.path),
            command: typeof entrypoint.command === 'string' ? entrypoint.command : undefined,
            args: Array.isArray(entrypoint.args) ? entrypoint.args.map(String) : undefined,
          },
          environmentRequirements: isRecord(parsed.environmentRequirements) ? parsed.environmentRequirements : {},
          validationCommand: String(parsed.validationCommand || ''),
          expectedArtifacts: normalizeExpectedArtifactNames(parsed.expectedArtifacts),
          patchSummary: typeof parsed.patchSummary === 'string' ? parsed.patchSummary : undefined,
        };
      }
    }
  }
  return undefined;
}

function structuredTextCandidates(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 5 || item === null || item === undefined || seen.has(item)) return;
    if (typeof item === 'string') {
      out.push(item);
      return;
    }
    if (!isRecord(item) && !Array.isArray(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    for (const key of ['finalText', 'handoffSummary', 'outputSummary', 'result', 'text', 'output', 'data', 'run', 'stages']) {
      visit(item[key], depth + 1);
    }
  };
  visit(value, 0);
  return uniqueStrings(out);
}

function normalizeExpectedArtifactNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (isRecord(entry)) return stringField(entry.type) ?? stringField(entry.id) ?? JSON.stringify(entry);
    return String(entry);
  });
}

type NormalizedGenerationEntrypoint = {
  language?: WorkspaceTaskRunResult['spec']['language'] | string;
  path?: string;
  command?: string;
  args?: unknown[];
};

function normalizeGenerationEntrypoint(value: unknown): NormalizedGenerationEntrypoint {
  if (isRecord(value)) {
    const path = stringField(value.path);
    const command = stringField(value.command);
    const resolvedPath = path;
    return {
      path: resolvedPath,
      command,
      args: Array.isArray(value.args) ? value.args : extractEntrypointArgs(command, resolvedPath),
      language: typeof value.language === 'string' ? value.language : inferLanguageFromEntrypoint(resolvedPath ?? command),
    };
  }
  return {};
}

function extractEntrypointArgs(command: unknown, path: unknown) {
  const commandText = typeof command === 'string' ? command.trim() : '';
  if (!commandText) return undefined;
  const tokens = splitCommandLine(commandText);
  if (tokens.length === 0) return undefined;
  const pathText = typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '';
  let start = 0;
  if (tokens[start] && /^(?:python(?:\d(?:\.\d+)?)?|python3|Rscript|bash|sh|node|tsx)$/.test(tokens[start])) {
    start += 1;
  }
  if (tokens[start]) {
    const tokenPath = tokens[start].replace(/^\.\//, '');
    if (!pathText || tokenPath === pathText || tokenPath.endsWith(`/${pathText}`) || pathText.endsWith(`/${tokenPath}`)) {
      start += 1;
    }
  }
  const args = tokens.slice(start);
  return args.length ? args : undefined;
}

function splitCommandLine(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function inferLanguageFromEntrypoint(value: unknown): WorkspaceTaskRunResult['spec']['language'] {
  const text = typeof value === 'string' ? value : '';
  if (/\.r(?:\s|$)/i.test(text) || /\bRscript\b/.test(text)) return 'r';
  if (/\.sh(?:\s|$)/i.test(text) || /\b(?:bash|sh)\b/.test(text)) return 'shell';
  return 'python';
}

export function parseToolPayloadResponse(run: Record<string, unknown>): ToolPayload | undefined {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates: unknown[] = [
    output.payload,
    output.toolPayload,
    output.data,
    output.result,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [
        result.payload,
        result.toolPayload,
        result.finalText,
        result.handoffSummary,
        result.output,
      ];
    }),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractStandaloneJson(candidate) : candidate;
    if (!isRecord(parsed) || !looksLikeToolPayloadCandidate(parsed)) continue;
    const payload = coerceAgentServerToolPayload(parsed);
    if (payload) return payload;
  }
  return undefined;
}

function looksLikeToolPayloadCandidate(value: Record<string, unknown>) {
  return isToolPayload(value)
    || Array.isArray(value.artifacts)
    || Array.isArray(value.executionUnits)
    || Array.isArray(value.claims)
    || Array.isArray(value.uiManifest);
}

export function agentServerRunFailure(run: Record<string, unknown>) {
  const status = typeof run.status === 'string' ? run.status : '';
  const output = isRecord(run.output) ? run.output : {};
  const success = typeof output.success === 'boolean' ? output.success : undefined;
  if (status !== 'failed' && success !== false) return undefined;
  const detail = extractAgentServerFailureDetail(run);
  return `AgentServer backend failed: ${detail || 'run failed without a usable generation result.'}`;
}

export function extractAgentServerFailureDetail(run: Record<string, unknown>) {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates = [
    output.error,
    output.result,
    output.text,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [result.error, result.finalText, result.outputSummary];
    }),
  ];
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (!text) continue;
    const parsedMessage = parseJsonErrorMessage(text);
    return sanitizeAgentServerError(parsedMessage || text);
  }
  return undefined;
}

export function agentServerSessionRef(baseUrl: string, agentId: string) {
  return `${cleanUrl(baseUrl)}/api/agent-server/agents/${encodeURIComponent(agentId)}`;
}

export function agentServerRequestFailureMessage(operation: 'generation' | 'repair', error: unknown, timeoutMs: number) {
  const message = errorMessage(error);
  if (isAbortError(error) || /abort|cancel|timeout/i.test(message)) {
    return `AgentServer ${operation} request timed out or was cancelled after ${timeoutMs}ms. Retry can resume with this repair-needed attempt in priorAttempts.`;
  }
  return `AgentServer ${operation} request failed: ${sanitizeAgentServerError(message)}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function extractAgentServerOutputText(run: Record<string, unknown>) {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates = [
    output.result,
    output.text,
    output.error,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [result.finalText, result.handoffSummary, result.outputSummary];
    }),
  ];
  return candidates
    .map((candidate) => typeof candidate === 'string' ? candidate.trim() : '')
    .find((candidate) => candidate.length > 40);
}
