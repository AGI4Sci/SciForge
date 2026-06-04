import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { AgentCliAdapter, AgentCliApprovalPolicy, AgentCliSandbox } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import {
  safeSubagentRelativePath,
  safeSubagentRuntimeRef,
  type StoredSubagentStatus,
} from './subagent-runtime-store.js';

export interface SubagentRunnerRequest {
  workspace: string;
  prompt: string;
  refs: string[];
  agentId?: string;
  parentAgentId?: string;
  agentType?: string;
  profile?: string;
  approvalPolicy?: AgentCliApprovalPolicy;
  sandbox?: AgentCliSandbox;
  codexCommand?: string;
  timeoutMs?: number;
  runInBackground?: boolean;
  resumeAgentId?: string;
  resumeRef?: string;
  resumeBoundary?: 'explicit' | 'none';
}

export interface SubagentRunnerResult {
  status: StoredSubagentStatus;
  exitCode: number | null;
  resultSummary: string;
  inspectedRefs: string[];
  readable: Array<{ relPath: string; text: string }>;
}

export interface SubagentRunner {
  spawn(request: SubagentRunnerRequest): Promise<SubagentRunnerResult>;
}

export function createReadOnlySubagentRunner(): SubagentRunner {
  return {
    async spawn(request) {
      const workspace = resolve(request.workspace);
      const readableRefs = await Promise.all(request.refs.map((ref) => readWorkspaceTextRef(workspace, ref)));
      const readable = uniqueWorkspaceTextRefs(readableRefs.filter((entry): entry is { relPath: string; text: string } => Boolean(entry)));
      return {
        status: 'completed',
        exitCode: 0,
        resultSummary: subagentResultSummary({
          prompt: request.prompt,
          readable,
        }),
        inspectedRefs: readable.map((entry) => `file:${entry.relPath}`),
        readable,
      };
    },
  };
}

export function createAgentHostSubagentRunner(options: {
  adapter?: AgentCliAdapter;
  env?: NodeJS.ProcessEnv;
} = {}): SubagentRunner {
  return {
    async spawn(request) {
      const controller = new AbortController();
      const timeout = request.timeoutMs && request.timeoutMs > 0
        ? setTimeout(() => controller.abort(), request.timeoutMs)
        : undefined;
      timeout?.unref?.();
      const env = {
        ...(options.env ?? process.env),
        ...(request.codexCommand ? { SCIFORGE_RUNTIME_CODEX_COMMAND: request.codexCommand } : {}),
      };
      const adapter = options.adapter ?? await createDefaultAgentHostSubagentAdapter(env, request);

      try {
        const turn = await adapter.startTurn({
          commandText: subagentCommandText(request),
          workspacePath: request.workspace,
          commandId: safeSubagentCommandId(request),
          profile: request.profile,
          approvalPolicy: request.approvalPolicy,
          sandbox: request.sandbox,
          guiExtension: { enabled: false },
          abortSignal: controller.signal,
        });
        const events: NormalizedAgentEvent[] = [];
        for await (const event of turn.events) events.push(event);
        return subagentRunnerResultFromEvents(events);
      } catch (error) {
        return {
          status: controller.signal.aborted ? 'cancelled' : 'blocked',
          exitCode: null,
          resultSummary: compactSubagentPublicText(
            controller.signal.aborted
              ? 'Sub-agent request cancelled before completion.'
              : `Sub-agent request blocked: Agent Host execution unavailable. ${error instanceof Error ? error.message : String(error)}`,
            420,
          ) ?? 'Sub-agent request blocked: Agent Host execution unavailable.',
          inspectedRefs: [],
          readable: [],
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

async function createDefaultAgentHostSubagentAdapter(
  env: NodeJS.ProcessEnv,
  request: SubagentRunnerRequest,
): Promise<AgentCliAdapter> {
  const [{ CodexAppServerAdapter }, { createCodexAppServerClient }] = await Promise.all([
    import('./codex-app-server-adapter.js'),
    import('./codex-app-server-client.js'),
  ]);
  return new CodexAppServerAdapter({
    client: createCodexAppServerClient({
      command: request.codexCommand ?? env.SCIFORGE_RUNTIME_CODEX_COMMAND,
      env,
      approvalPolicy: request.approvalPolicy,
    }),
    profile: request.profile,
  });
}

async function readWorkspaceTextRef(workspace: string, ref: string): Promise<{ relPath: string; text: string } | undefined> {
  const safeRef = safeSubagentRuntimeRef(ref);
  if (!safeRef) return undefined;
  const relPath = safeRef.startsWith('file:')
    ? safeSubagentRelativePath(safeRef.slice('file:'.length))
    : undefined;
  if (!relPath) return undefined;
  const absolutePath = resolve(workspace, relPath);
  if (!isPathInside(workspace, absolutePath)) return undefined;
  const info = await stat(absolutePath).catch(() => undefined);
  if (!info?.isFile() || info.size > 256_000) return undefined;
  const text = await readFile(absolutePath, 'utf8').catch(() => undefined);
  if (!text) return undefined;
  return { relPath, text: text.slice(0, 48_000) };
}

function subagentCommandText(request: SubagentRunnerRequest): string {
  const refs = request.refs
    .map((ref) => safeSubagentRuntimeRef(ref))
    .filter((ref): ref is string => Boolean(ref));
  const resumeLines = request.resumeBoundary === 'explicit'
    ? [
      'Resume boundary: explicit.',
      request.resumeAgentId ? `Resume agent: ${safeSubagentRuntimeRef(`subagent:${request.resumeAgentId}`) ?? request.resumeAgentId}` : '',
      request.resumeRef ? `Resume ref: ${safeSubagentRuntimeRef(request.resumeRef) ?? request.resumeRef}` : '',
    ].filter(Boolean)
    : [];
  return [
    'You are a SciForge delegated sub-agent running under Agent Host ownership.',
    'Complete only the delegated task. Return a concise public summary, safe refs, and blockers.',
    'Do not expose provider routes, raw model names, API keys, local absolute paths, stdout/stderr, raw JSON, or transcript bodies.',
    request.runInBackground ? 'Runtime mode: background child task. Persist progress through runtime-owned state refs only.' : '',
    ...resumeLines,
    '',
    `Task:\n${request.prompt}`,
    refs.length ? `\nPublic refs:\n${refs.map((ref) => `- ${ref}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function safeSubagentCommandId(request: SubagentRunnerRequest): string {
  const parent = safeCommandSegment(request.parentAgentId) ?? 'runtime-codex';
  const agent = safeCommandSegment(request.agentId) ?? safeCommandSegment(request.agentType) ?? 'worker';
  return `subagent-${parent}-${agent}`.slice(0, 96);
}

function safeCommandSegment(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const safe = text.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || undefined;
}

function subagentRunnerResultFromEvents(events: NormalizedAgentEvent[]): SubagentRunnerResult {
  const terminal = [...events].reverse().find((event) => event.type === 'done' || event.type === 'failed' || event.type === 'cancelled');
  const status: StoredSubagentStatus = terminal?.type === 'failed'
    ? 'failed'
    : terminal?.type === 'cancelled'
      ? 'cancelled'
      : 'completed';
  const exitCode = terminal?.exitCode ?? (status === 'completed' ? 0 : null);
  const messageText = events
    .filter((event) => event.type === 'message' || event.type === 'gui_present')
    .map((event) => event.text ?? event.message)
    .filter((text): text is string => Boolean(text?.trim()));
  const fallback = terminal?.message ?? (status === 'completed' ? 'Delegated worker completed.' : 'Delegated worker did not complete.');
  return {
    status,
    exitCode,
    resultSummary: compactSubagentPublicText(messageText.at(-1) ?? fallback, 720) ?? fallback,
    inspectedRefs: uniqueRuntimeRefs(events.flatMap((event) => [
      event.ref,
      event.resultRef,
      event.transcriptRef,
      event.fileRef,
      ...(event.refs ?? []),
    ])),
    readable: [],
  };
}

function uniqueRuntimeRefs(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    const ref = safeSubagentRuntimeRef(value);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function subagentResultSummary(input: { prompt: string; readable: Array<{ relPath: string; text: string }> }): string {
  const combined = input.readable.map((entry) => `# ${entry.relPath}\n${entry.text}`).join('\n\n');
  const todoLines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /sub-?agent|delegated-worker|tool surface|mcp tool|transcript\/ref|transcript ref|result ref|lifecycle refs|live evidence|open difference|blocked/i.test(line))
    .filter((line) => !/^[-*]\s*\[[xX]\]/.test(line))
    .slice(0, 4)
    .map((line) => line.replace(/^[-*]\s*\[[^\]]*\]\s*/, '').replace(/^\s*[-*]\s*/, ''));
  if (todoLines.length) {
    return compactSubagentPublicText(
      `Read ${input.readable.map((entry) => entry.relPath).join(', ')}. Remaining live parity TODO: ${todoLines.join(' ')}`,
      520,
    ) ?? 'Read-only delegated worker completed.';
  }
  if (input.readable.length) {
    return compactSubagentPublicText(
      `Read ${input.readable.map((entry) => entry.relPath).join(', ')}. No explicit sub-agent live parity TODO was found in the inspected refs.`,
      360,
    ) ?? 'Read-only delegated worker completed.';
  }
  return compactSubagentPublicText(
    `Read-only delegated worker completed. Request summary: ${input.prompt}`,
    360,
  ) ?? 'Read-only delegated worker completed.';
}

export function sanitizeSubagentPublicText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{4,})/gi,
      '$1=[redacted]',
    )
    .replace(/\b[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\b/g, '[redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[url]')
    .replace(/(^|[\s("'`])(?:\/(?:Users|Applications|Volumes|private|var|tmp)\/[^\s"'`),;]*)/gi, '$1[local-path]')
    .replace(/(^|[\s("'`])~\/[^\s"'`),;]*/g, '$1[local-path]')
    .replace(/(^|[\s("'`])[A-Za-z]:[\\/][^\s"'`),;]*/g, '$1[local-path]')
    .replace(/(^|[\s("'`])\.sciforge(?:\/[^\s"'`),;]*)?/gi, '$1[private-workspace-state]')
    .replace(/\bproviders?\b/gi, 'runtime route')
    .replace(/\bJSONL?\b/g, 'structured payload')
    .replace(/\b(?:stdout|stderr|raw|logs?)\b/gi, 'diagnostic')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactSubagentPublicText(value: string | undefined, limit: number): string | undefined {
  const text = sanitizeSubagentPublicText(value ?? '');
  if (!text) return undefined;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18)).replace(/\s+\S*$/, '')} ... ${text.slice(-14)}`;
}

function uniqueWorkspaceTextRefs(values: Array<{ relPath: string; text: string }>): Array<{ relPath: string; text: string }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.relPath)) return false;
    seen.add(value.relPath);
    return true;
  });
}

function isPathInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
