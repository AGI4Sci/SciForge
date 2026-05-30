import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { scrubRuntimeCodexAuditText } from './codex-runtime-audit-bundle.js';
import { SUBAGENT_SPAWN_AGENT_TOOL_NAME } from './subagent-extension-manifest.js';

export type SubagentMcpToolName = typeof SUBAGENT_SPAWN_AGENT_TOOL_NAME;

export interface SubagentSpawnAgentResult extends Record<string, unknown> {
  ok: true;
  agentId: string;
  parentAgentId: string;
  resultSummary: string;
  ref: string;
  resultRef: string;
  transcriptRef: string;
  refs: string[];
  status: 'completed';
  exitCode: 0;
}

export interface SubagentMcpToolCallResult extends Record<string, unknown> {
  content: [{ type: 'text'; text: string }];
  structuredContent: SubagentSpawnAgentResult;
}

export interface SubagentRuntimeOptions {
  workspace: string;
  profile?: string;
  sandbox?: string;
  codexHome?: string;
  codexCommand?: string;
  env?: NodeJS.ProcessEnv;
  transcriptRoot?: string;
  parentCommandId?: string;
  parentAttemptId?: string;
  now?: () => Date;
}

interface SubagentInvocation {
  prompt: string;
  agentType?: string;
  agentId?: string;
  refs: string[];
}

type WorkspaceTextRef = {
  relPath: string;
  text: string;
};

export async function callSubagentMcpTool(
  name: SubagentMcpToolName,
  args: Record<string, unknown>,
  options: SubagentRuntimeOptions,
): Promise<SubagentMcpToolCallResult> {
  if (name !== SUBAGENT_SPAWN_AGENT_TOOL_NAME) {
    throw new Error(`Unsupported sub-agent MCP tool: ${name}`);
  }
  const structuredContent = await spawnLocalSubagent(args, options);
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export async function spawnLocalSubagent(args: Record<string, unknown>, options: SubagentRuntimeOptions): Promise<SubagentSpawnAgentResult> {
  const workspace = resolve(options.workspace);
  const invocation = subagentInvocationFromArgs(args);
  const requestedRefs = uniqueStrings([
    ...invocation.refs,
    ...extractCandidatePaths(invocation.prompt).map((path) => `file:${path}`),
  ]);
  const readableRefs = await Promise.all(requestedRefs.map((ref) => readWorkspaceTextRef(workspace, ref)));
  const readable = uniqueWorkspaceTextRefs(readableRefs.filter((entry): entry is WorkspaceTextRef => Boolean(entry)));
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const digest = sha256([
    createdAt,
    invocation.prompt,
    ...readable.map((entry) => `${entry.relPath}\n${entry.text.slice(0, 2048)}`),
  ].join('\0')).slice(0, 12);
  const agentType = safeRuntimeIdentifier(invocation.agentType)?.slice(0, 32) ?? 'worker';
  const agentId = safeRuntimeIdentifier(invocation.agentId) ?? `${agentType}-${digest}`;
  const parentAgentId = safeRuntimeIdentifier(options.parentCommandId) ?? 'runtime-codex';
  const transcriptRef = `artifact:subagent-transcript-${digest}`;
  const resultRef = `artifact:subagent-result-${digest}`;
  const resultSummary = subagentResultSummary({
    prompt: invocation.prompt,
    readable,
  });
  const refs = uniqueRefs([
    resultRef,
    transcriptRef,
    ...readable.map((entry) => `file:${entry.relPath}`),
  ]);
  const result: SubagentSpawnAgentResult = {
    ok: true,
    agentId,
    parentAgentId,
    resultSummary,
    ref: resultRef,
    resultRef,
    transcriptRef,
    refs,
    status: 'completed',
    exitCode: 0,
  };
  await persistTranscript(options, {
    agentId,
    parentAgentId,
    createdAt,
    transcriptRef,
    resultRef,
    refs,
    status: 'completed',
    exitCode: 0,
    resultSummary,
    promptDigest: sha256(invocation.prompt),
    inspectedRefs: readable.map((entry) => `file:${entry.relPath}`),
  });
  return result;
}

function subagentInvocationFromArgs(args: Record<string, unknown>): SubagentInvocation {
  const itemText = inputItems(args.items)
    .map((item) => [item.name, item.path, item.text].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
  const prompt = stringField(args.message)
    ?? stringField(args.prompt)
    ?? stringField(args.task)
    ?? stringField(args.instructions)
    ?? stringField(args.input)
    ?? itemText
    ?? 'Read-only delegated worker request.';
  return {
    prompt,
    agentType: stringField(args.agentType) ?? stringField(args.agent_type) ?? stringField(args.role),
    agentId: stringField(args.agentId) ?? stringField(args.agent_id),
    refs: [
      ...stringArrayField(args.refs),
      ...stringArrayField(args.contextRefs),
      ...stringArrayField(args.context_refs),
      ...stringArrayField(args.evidenceRefs),
      ...stringArrayField(args.evidence_refs),
      ...inputItems(args.items).flatMap((item) => [item.path, item.name]),
      stringField(args.ref),
    ].filter((ref): ref is string => Boolean(ref)),
  };
}

function inputItems(value: unknown): Array<{ name?: string; path?: string; text?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = recordField(entry);
    if (!record) return [];
    return [{
      name: stringField(record.name),
      path: stringField(record.path),
      text: stringField(record.text),
    }];
  });
}

async function readWorkspaceTextRef(workspace: string, ref: string): Promise<WorkspaceTextRef | undefined> {
  const relPath = ref.startsWith('file:')
    ? safeRelativePath(ref.slice('file:'.length))
    : safeRelativePath(ref);
  if (!relPath) return undefined;
  const absolutePath = resolve(workspace, relPath);
  if (!isPathInside(workspace, absolutePath)) return undefined;
  const info = await stat(absolutePath).catch(() => undefined);
  if (!info?.isFile() || info.size > 256_000) return undefined;
  const text = await readFile(absolutePath, 'utf8').catch(() => undefined);
  if (!text) return undefined;
  return { relPath, text: text.slice(0, 48_000) };
}

function subagentResultSummary(input: { prompt: string; readable: WorkspaceTextRef[] }): string {
  const combined = input.readable.map((entry) => `# ${entry.relPath}\n${entry.text}`).join('\n\n');
  const todoLines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /sub-?agent|delegated-worker|tool surface|mcp tool|transcript\/ref|transcript ref|result ref|live evidence|open difference|blocked/i.test(line))
    .filter((line) => !/^[-*]\s*\[[xX]\]/.test(line))
    .slice(0, 4)
    .map((line) => line.replace(/^[-*]\s*\[[^\]]*\]\s*/, '').replace(/^\s*[-*]\s*/, ''));
  if (todoLines.length) {
    return compactRuntimeText(
      `Read ${input.readable.map((entry) => entry.relPath).join(', ')}. Remaining live parity TODO: ${todoLines.join(' ')}`,
      520,
    ) ?? 'Read-only delegated worker completed.';
  }
  if (input.readable.length) {
    return compactRuntimeText(
      `Read ${input.readable.map((entry) => entry.relPath).join(', ')}. No explicit sub-agent live parity TODO was found in the inspected refs.`,
      360,
    ) ?? 'Read-only delegated worker completed.';
  }
  return compactRuntimeText(
    `Read-only delegated worker completed. Request summary: ${input.prompt}`,
    360,
  ) ?? 'Read-only delegated worker completed.';
}

async function persistTranscript(options: SubagentRuntimeOptions, transcript: Record<string, unknown>): Promise<void> {
  if (!options.transcriptRoot) return;
  try {
    await mkdir(options.transcriptRoot, { recursive: true });
    await writeFile(join(options.transcriptRoot, `${transcript.agentId}.json`), `${JSON.stringify({
      schemaVersion: 'sciforge.runtime-codex.subagent-transcript.v1',
      parentCommandId: safeRuntimeIdentifier(options.parentCommandId),
      parentAttemptId: safeRuntimeIdentifier(options.parentAttemptId),
      ...transcript,
    }, null, 2)}\n`, 'utf8');
  } catch {
    // Transcript persistence is best-effort; the public MCP result remains stable and safe.
  }
}

function extractCandidatePaths(text: string): string[] {
  const matches = [...text.matchAll(/(?:^|[\s`"'])((?:\.\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9][\w.-]*)(?=$|[\s`"',.;:!?，。；：！？)])/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/^\.\//, ''));
  if (/\bPROJECT\.md\b/.test(text) && !matches.includes('PROJECT.md')) matches.unshift('PROJECT.md');
  return matches;
}

function sanitizeRuntimeResultText(value: string): string {
  return scrubRuntimeCodexAuditText(value)
    .replace(/(^|[\s("'`])(?:\/(?:Users|Applications|Volumes|private|var|tmp)\/[^\s"'`),;]*)/gi, '$1[local-path]')
    .replace(/(^|[\s("'`])~\/[^\s"'`),;]*/g, '$1[local-path]')
    .replace(/(^|[\s("'`])[A-Za-z]:[\\/][^\s"'`),;]*/g, '$1[local-path]')
    .replace(/(^|[\s("'`])\.sciforge(?:\/[^\s"'`),;]*)?/gi, '$1[private-workspace-state]')
    .replace(/\b(?:stdout|stderr|raw|logs?)\b/gi, 'diagnostic')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactRuntimeText(value: string | undefined, limit: number): string | undefined {
  const text = sanitizeRuntimeResultText(value ?? '');
  if (!text) return undefined;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18)).replace(/\s+\S*$/, '')} ... ${text.slice(-14)}`;
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(safeRuntimeRef).filter((value): value is string => Boolean(value))));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function uniqueWorkspaceTextRefs(values: WorkspaceTextRef[]): WorkspaceTextRef[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.relPath)) return false;
    seen.add(value.relPath);
    return true;
  });
}

function safeRuntimeRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('artifact:')) {
    const opaque = text.slice('artifact:'.length);
    return safeOpaqueRefPart(opaque) ? `artifact:${opaque}` : undefined;
  }
  if (text.startsWith('file:')) {
    const path = safeRelativePath(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (/\.[A-Za-z0-9][\w.-]*$/.test(text)) {
    const path = safeRelativePath(text);
    return path ? `file:${path}` : undefined;
  }
  return safeOpaqueRefPart(text) ? text : undefined;
}

function safeRuntimeIdentifier(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return undefined;
  if (text.startsWith('/') || text.startsWith('~') || text.includes('://')) return undefined;
  if (text.includes('..')) return undefined;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return undefined;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return undefined;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function safeOpaqueRefPart(value: string): boolean {
  const text = value.trim();
  if (!text || text.startsWith('/') || text.startsWith('~') || text.includes('://')) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/[\r\n\t<>|?*]/.test(text)) return false;
  if (text.includes('..')) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function safeRelativePath(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text) return undefined;
  if (/^(?:\/|[A-Za-z]:\/)/.test(text) || text.includes('://') || text.startsWith('~')) return undefined;
  if (/[\r\n\t<>|?*:]/.test(text)) return undefined;
  if (text.split('/').some((part) => part === '..' || part === '' || part === '.')) return undefined;
  if (/(?:^|\/)(?:node_modules|dist|build|coverage|\.git|\.sciforge|reports)(?:\/|$)/i.test(text)) return undefined;
  if (/(?:^|[\/_.:-])(?:stdout|stderr|raw|logs?)(?:$|[\/_.:-])/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function isPathInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
