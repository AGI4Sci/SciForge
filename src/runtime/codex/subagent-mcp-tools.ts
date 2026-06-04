import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { SUBAGENT_SPAWN_AGENT_TOOL_NAME } from './subagent-extension-manifest.js';
import {
  createSubagentRuntimeStore,
  type StoredSubagentBackgroundMetadata,
  type StoredSubagentResumeMetadata,
  type StoredSubagentRun,
  type StoredSubagentStatus,
} from './subagent-runtime-store.js';
import type { AgentCliApprovalPolicy, AgentCliSandbox } from './agent-cli-adapter.js';
import { compactSubagentPublicText, createAgentHostSubagentRunner, type SubagentRunner } from './subagent-runner.js';

export type SubagentMcpToolName = typeof SUBAGENT_SPAWN_AGENT_TOOL_NAME;

export interface SubagentSpawnAgentResult {
  ok: boolean;
  agentId: string;
  parentAgentId: string;
  agentType: string;
  resultSummary: string;
  ref?: string;
  resultRef?: string;
  transcriptRef?: string;
  refs: string[];
  status: StoredSubagentStatus;
  exitCode?: number | null;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  background: StoredSubagentBackgroundMetadata;
  resume: StoredSubagentResumeMetadata;
  errorCode?: string;
}

export interface SubagentMcpToolCallResult extends Record<string, unknown> {
  content: [{ type: 'text'; text: string }];
  structuredContent: SubagentSpawnAgentResult;
}

export interface SubagentRuntimeOptions {
  workspace: string;
  profile?: string;
  approvalPolicy?: AgentCliApprovalPolicy;
  sandbox?: AgentCliSandbox;
  codexHome?: string;
  codexCommand?: string;
  env?: NodeJS.ProcessEnv;
  transcriptRoot?: string;
  parentCommandId?: string;
  parentAttemptId?: string;
  timeoutMs?: number;
  now?: () => Date;
  runner?: SubagentRunner;
}

interface SubagentInvocation {
  prompt: string;
  agentType?: string;
  agentId?: string;
  refs: string[];
}

type SubagentBaseProjection = Pick<
  SubagentSpawnAgentResult,
  'agentId' | 'parentAgentId' | 'agentType' | 'startedAt' | 'background' | 'resume'
>;

export async function callSubagentMcpTool(
  name: SubagentMcpToolName,
  args: Record<string, unknown>,
  options: SubagentRuntimeOptions,
): Promise<SubagentMcpToolCallResult> {
  if (name !== SUBAGENT_SPAWN_AGENT_TOOL_NAME) {
    const structuredContent = blockedSubagentResult({
      args,
      options,
      resultSummary: 'NO_SUBAGENT_TOOL_AVAILABLE: The requested sub-agent tool is not available in this runtime.',
      errorCode: 'NO_SUBAGENT_TOOL_AVAILABLE',
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
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
  const base = subagentBaseProjection(args, options, invocation);
  const requestedExplicitRefs = uniqueStrings(invocation.refs);
  const unsafeRef = requestedExplicitRefs.find((ref) => !safeRuntimeRef(ref));
  if (unsafeRef) {
    return blockedFromBase(base, options, 'Sub-agent request blocked: unsafe reference requested.');
  }
  const unsafeResumeBoundary = unsafeResumeBoundarySummary(args);
  if (unsafeResumeBoundary) {
    return blockedFromBase(base, options, unsafeResumeBoundary);
  }
  const requestedRefs = uniqueStrings([
    ...requestedExplicitRefs.map((ref) => safeRuntimeRef(ref)),
    ...extractCandidatePaths(invocation.prompt).map((path) => `file:${path}`),
  ]);
  const resumeBlocker = await validateExplicitResumeBoundary(base, options);
  if (resumeBlocker) {
    return blockedFromBase(base, options, resumeBlocker);
  }
  const runner = options.runner ?? createAgentHostSubagentRunner({ env: options.env });

  if (base.background.runInBackground) {
    return spawnBackgroundSubagent({
      workspace,
      invocation,
      base,
      options,
      requestedRefs,
      runner,
    });
  }

  const runnerResult = await runner.spawn({
    workspace,
    prompt: invocation.prompt,
    refs: requestedRefs,
    agentId: base.agentId,
    parentAgentId: base.parentAgentId,
    agentType: base.agentType,
    profile: options.profile,
    approvalPolicy: options.approvalPolicy,
    sandbox: options.sandbox,
    codexCommand: options.codexCommand,
    timeoutMs: options.timeoutMs,
    runInBackground: false,
    ...base.resume,
  });
  return completedSubagentResult({
    invocation,
    base,
    options,
    runnerResult,
    writeTranscript: Boolean(options.transcriptRoot),
  });
}

async function spawnBackgroundSubagent(input: {
  workspace: string;
  invocation: SubagentInvocation;
  base: SubagentBaseProjection;
  options: SubagentRuntimeOptions;
  requestedRefs: string[];
  runner: SubagentRunner;
}): Promise<SubagentSpawnAgentResult> {
  if (!input.options.transcriptRoot) {
    return blockedFromBase(input.base, input.options, 'Sub-agent request blocked: background state store unavailable.');
  }
  const stateRef = input.base.background.stateRef;
  const refs = uniqueRefs([stateRef]);
  const resultSummary = 'Sub-agent is running in background. Track the runtime state ref and resume only by explicit child agent id or ref.';
  const storeRecord: StoredSubagentRun = {
    schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
    agentId: input.base.agentId,
    parentAgentId: input.base.parentAgentId,
    workspaceScope: workspaceScopeFromPath(input.workspace),
    agentType: input.base.agentType,
    status: 'running',
    resultSummary,
    refs,
    startedAt: input.base.startedAt,
    background: input.base.background,
    resume: input.base.resume,
    inspectedRefs: input.requestedRefs,
    promptDigest: sha256(input.invocation.prompt),
  };
  const store = createSubagentRuntimeStore({ transcriptRoot: input.options.transcriptRoot });
  try {
    await store.writeRun(storeRecord);
  } catch {
    return blockedFromBase(input.base, input.options, 'Sub-agent request blocked: background state store unavailable.');
  }

  void settleBackgroundSubagent(input);

  return {
    ...input.base,
    ok: true,
    status: 'running',
    resultSummary,
    ref: stateRef,
    refs,
  };
}

async function settleBackgroundSubagent(input: {
  workspace: string;
  invocation: SubagentInvocation;
  base: SubagentBaseProjection;
  options: SubagentRuntimeOptions;
  requestedRefs: string[];
  runner: SubagentRunner;
}): Promise<void> {
  const runnerResult = await input.runner.spawn({
    workspace: input.workspace,
    prompt: input.invocation.prompt,
    refs: input.requestedRefs,
    agentId: input.base.agentId,
    parentAgentId: input.base.parentAgentId,
    agentType: input.base.agentType,
    profile: input.options.profile,
    approvalPolicy: input.options.approvalPolicy,
    sandbox: input.options.sandbox,
    codexCommand: input.options.codexCommand,
    timeoutMs: input.options.timeoutMs,
    runInBackground: true,
    ...input.base.resume,
  }).catch((error): Awaited<ReturnType<SubagentRunner['spawn']>> => ({
    status: 'blocked',
    exitCode: null,
    resultSummary: compactSubagentPublicText(
      `Sub-agent request blocked: Agent Host execution unavailable. ${error instanceof Error ? error.message : String(error)}`,
      420,
    ) ?? 'Sub-agent request blocked: Agent Host execution unavailable.',
    inspectedRefs: [],
    readable: [],
  }));
  await completedSubagentResult({
    invocation: input.invocation,
    base: input.base,
    options: input.options,
    runnerResult,
    writeTranscript: true,
  });
}

async function completedSubagentResult(input: {
  invocation: SubagentInvocation;
  base: SubagentBaseProjection;
  options: SubagentRuntimeOptions;
  runnerResult: Awaited<ReturnType<SubagentRunner['spawn']>>;
  writeTranscript: boolean;
}): Promise<SubagentSpawnAgentResult> {
  const { invocation, base, options, runnerResult } = input;
  const completedAt = (options.now?.() ?? new Date()).toISOString();
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(base.startedAt));
  const digest = sha256([
    base.agentId,
    base.startedAt,
    invocation.prompt,
    ...runnerResult.readable.map((entry) => `${entry.relPath}\n${entry.text.slice(0, 2048)}`),
  ].join('\0')).slice(0, 12);
  const transcriptRef = `artifact:subagent-transcript-${digest}`;
  const resultRef = `artifact:subagent-result-${digest}`;
  const refs = uniqueRefs([
    resultRef,
    transcriptRef,
    base.background.stateRef,
    ...runnerResult.inspectedRefs,
  ]);
  const result: SubagentSpawnAgentResult = {
    ...base,
    ok: true,
    resultSummary: compactSubagentPublicText(runnerResult.resultSummary, 720) ?? 'Delegated worker completed.',
    ref: resultRef,
    resultRef,
    transcriptRef,
    refs,
    status: runnerResult.status,
    exitCode: runnerResult.exitCode,
    completedAt,
    durationMs,
  };
  if (input.writeTranscript && options.transcriptRoot) {
    const storeRecord: StoredSubagentRun = {
      schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
      agentId: result.agentId,
      parentAgentId: result.parentAgentId,
      workspaceScope: workspaceScopeFromPath(options.workspace),
      agentType: result.agentType,
      status: result.status,
      resultSummary: result.resultSummary,
      resultRef,
      transcriptRef,
      refs,
      startedAt: result.startedAt,
      completedAt,
      durationMs,
      background: result.background,
      resume: result.resume,
      inspectedRefs: runnerResult.inspectedRefs,
      promptDigest: sha256(invocation.prompt),
    };
    try {
      await createSubagentRuntimeStore({ transcriptRoot: options.transcriptRoot }).writeRun(storeRecord);
    } catch {
      return {
        ...base,
        ok: false,
        status: 'blocked',
        resultSummary: 'Sub-agent request blocked: transcript store unavailable.',
        refs: [],
        completedAt,
        durationMs,
      };
    }
  }
  return result;
}

function subagentBaseProjection(
  args: Record<string, unknown>,
  options: SubagentRuntimeOptions,
  invocation: SubagentInvocation,
): SubagentBaseProjection {
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  const digest = sha256([
    startedAt,
    randomBytes(8).toString('hex'),
    invocation.prompt,
    invocation.agentType ?? '',
    invocation.agentId ?? '',
    options.parentCommandId ?? '',
  ].join('\0')).slice(0, 12);
  const agentType = safeRuntimeIdentifier(invocation.agentType)?.slice(0, 32) ?? 'worker';
  const agentId = safeRuntimeIdentifier(invocation.agentId) ?? `${agentType}-${digest}`;
  const parentAgentId = safeRuntimeIdentifier(options.parentCommandId) ?? 'runtime-codex';
  const stateRef = safeRuntimeRef(`subagent:${agentId}`);
  const rawResumeAgentId = resumeAgentIdFromArgs(args);
  const resumeAgentId = safeRuntimeIdentifier(rawResumeAgentId);
  const rawResumeRef = resumeRefFromArgs(args);
  const resumeRef = rawResumeRef ? safeRuntimeRef(rawResumeRef) : undefined;
  const resumeRequested = Boolean(rawResumeAgentId || rawResumeRef);
  return {
    agentId,
    parentAgentId,
    agentType,
    startedAt,
    background: {
      runInBackground: booleanField(args.runInBackground) ?? booleanField(args.run_in_background) ?? booleanField(args.background) ?? false,
      stateRef,
    },
    resume: {
      resumeRequested,
      ...(resumeAgentId ? { resumeAgentId } : {}),
      ...(resumeRef ? { resumeRef } : {}),
      resumeBoundary: resumeRequested ? 'explicit' : 'none',
    },
  };
}

function unsafeResumeBoundarySummary(args: Record<string, unknown>): string | undefined {
  const rawResumeAgentId = resumeAgentIdFromArgs(args);
  if (rawResumeAgentId && !safeRuntimeIdentifier(rawResumeAgentId)) {
    return 'Sub-agent request blocked: unsafe resume boundary requested.';
  }
  const rawResumeRef = resumeRefFromArgs(args);
  if (rawResumeRef && !safeRuntimeRef(rawResumeRef)) {
    return 'Sub-agent request blocked: unsafe resume reference requested.';
  }
  return undefined;
}

async function validateExplicitResumeBoundary(
  base: SubagentBaseProjection,
  options: SubagentRuntimeOptions,
): Promise<string | undefined> {
  if (!base.resume.resumeRequested) return undefined;
  if (!options.transcriptRoot) return 'Sub-agent request blocked: resume boundary store unavailable.';
  const store = createSubagentRuntimeStore({ transcriptRoot: options.transcriptRoot });
  try {
    const agentRun = base.resume.resumeAgentId
      ? await store.readRunByAgentId(base.resume.resumeAgentId)
      : undefined;
    const refRun = base.resume.resumeRef
      ? await store.findRunByRef(base.resume.resumeRef)
      : undefined;
    if (base.resume.resumeAgentId && !agentRun) return 'Sub-agent request blocked: explicit resume boundary not found.';
    if (base.resume.resumeRef && !refRun) return 'Sub-agent request blocked: explicit resume boundary not found.';
    if (agentRun && refRun && agentRun.agentId !== refRun.agentId) {
      return 'Sub-agent request blocked: ambiguous resume boundary requested.';
    }
    if (!agentRun && !refRun) return 'Sub-agent request blocked: explicit resume boundary not found.';
    const currentWorkspaceScope = workspaceScopeFromPath(options.workspace);
    for (const run of [agentRun, refRun].filter((entry): entry is StoredSubagentRun => Boolean(entry))) {
      if (run.parentAgentId !== base.parentAgentId) {
        return 'Sub-agent request blocked: explicit resume boundary is outside the current parent.';
      }
      if (run.workspaceScope !== currentWorkspaceScope) {
        return 'Sub-agent request blocked: explicit resume boundary is outside the current workspace.';
      }
    }
  } catch {
    return 'Sub-agent request blocked: resume boundary store unavailable.';
  }
  return undefined;
}

function blockedSubagentResult(input: {
  args: Record<string, unknown>;
  options: SubagentRuntimeOptions;
  resultSummary: string;
  errorCode?: string;
}): SubagentSpawnAgentResult {
  const invocation = subagentInvocationFromArgs(input.args);
  const base = subagentBaseProjection(input.args, input.options, invocation);
  return blockedFromBase(base, input.options, input.resultSummary, input.errorCode);
}

function blockedFromBase(
  base: Omit<SubagentSpawnAgentResult, 'ok' | 'status' | 'resultSummary' | 'refs'>,
  options: SubagentRuntimeOptions,
  resultSummary: string,
  errorCode?: string,
): SubagentSpawnAgentResult {
  const completedAt = (options.now?.() ?? new Date()).toISOString();
  return {
    ...base,
    ok: false,
    status: 'blocked',
    resultSummary,
    refs: [],
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(base.startedAt)),
    ...(errorCode ? { errorCode } : {}),
  };
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

function extractCandidatePaths(text: string): string[] {
  const matches = [...text.matchAll(/(?:^|[\s`"'])((?:\.\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9][\w.-]*)(?=$|[\s`"',.;:!?，。；：！？)])/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/^\.\//, ''));
  if (/\bPROJECT\.md\b/.test(text) && !matches.includes('PROJECT.md')) matches.unshift('PROJECT.md');
  return matches;
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(safeRuntimeRef).filter((value): value is string => Boolean(value))));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
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

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function resumeRefFromArgs(args: Record<string, unknown>): string | undefined {
  return stringField(args.resumeRef)
    ?? stringField(args.resume_ref)
    ?? stringField(args.resume)
    ?? stringField(args.resumeCandidateRef)
    ?? stringField(args.resume_candidate_ref);
}

function resumeAgentIdFromArgs(args: Record<string, unknown>): string | undefined {
  return stringField(args.resumeAgentId) ?? stringField(args.resume_agent_id);
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceScopeFromPath(workspace: string): string {
  return `scope-${sha256(resolve(workspace)).slice(0, 16)}`;
}
