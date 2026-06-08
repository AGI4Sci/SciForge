import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { attemptIdForCommand, codexSessionIdFromRaw, commandIdForText, exitEvent, invalidJsonlAuditEvent, normalizeCodexJsonlEvent, resumeFailureAuditEvent, runStartedEvent, stderrAuditEvent, type CodexRuntimeMetadata, type NormalizedAgentEvent } from './codex-event-normalizer.js';
import { type AgentCliAdapter, type AgentCliApprovalPolicy, type AgentCliStartTurnInput, type AgentCliTurn } from './agent-cli-adapter.js';
import { assertCodexNoForkGate } from '../../../packages/backend/src/codex-compatibility-gate.js';
import {
  RUNTIME_CODEX_DISABLE_PLUGIN_ARGS,
  resolveRuntimeCodexSandbox,
  RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
} from '../../../packages/backend/src/runtime-home.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex-runtime-config.js';
import {
  createRuntimeCodexAuditBundle,
  scrubRuntimeCodexAuditText,
  scrubRuntimeCodexEventForAudit,
  type RuntimeCodexAuditBundle,
} from './codex-runtime-audit-bundle.js';
import { prepareRuntimeSubagentInjection } from './subagent-extension-manifest.js';

const RUNTIME_CODEX_EXEC_ISOLATION_ARGS = ['--skip-git-repo-check', '--ignore-rules'];

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => CodexChildProcess;

const RUNTIME_CODEX_APPROVAL_POLICY: AgentCliApprovalPolicy = 'never';

interface CodexChildProcess {
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export class CodexExecJsonAdapter implements AgentCliAdapter {
  private readonly activeTurns = new Map<string, CodexChildProcess>();

  constructor(private readonly options: { spawnProcess?: SpawnCodexProcess; env?: NodeJS.ProcessEnv } = {}) {}

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    const config = await assertCodexRuntimeConfig({
      workspacePath: input.workspacePath,
      profile: input.profile,
      allowOpenAiRuntime: false,
      env: this.options.env,
    });
    const commandText = input.commandText.trim();
    if (!commandText) throw new Error('Runtime Codex command text is required.');
    const commandId = input.commandId?.trim() || commandIdForText(commandText, config.workspace);
    const attemptId = input.attemptId?.trim() || attemptIdForCommand(commandId);
    const resumeRequested = Boolean(input.codexSessionId);
    const evidenceRefs = evidenceRefsForTurn(commandId, attemptId);
    const runtimeEnv = this.options.env ?? process.env;
    const runtimeSandbox = input.sandbox ?? resolveRuntimeCodexSandbox(runtimeEnv);
    const approvalPolicy = input.approvalPolicy ?? RUNTIME_CODEX_APPROVAL_POLICY;
    const codexGate = assertCodexNoForkGate({ codexCommand: runtimeEnv.SCIFORGE_RUNTIME_CODEX_COMMAND });
    const subagentInjection = await prepareRuntimeSubagentInjection({
      workspace: config.workspace,
      profile: config.profile,
      sandbox: runtimeSandbox,
      approvalPolicy,
      codexHome: config.codexHome,
      codexCommand: codexGate.codexCommand,
      parentCommandId: commandId,
      parentAttemptId: attemptId,
    });
    const metadata: CodexRuntimeMetadata = {
      provider: config.provider,
      model: config.model,
      profile: config.profile,
      workspace: config.workspace,
      commandId,
      attemptId,
      commandText,
      codexSessionId: input.codexSessionId,
      runtimeSandbox,
      evidenceRefs,
      resumeRequested,
    };
    const auditBundle = createRuntimeCodexAuditBundle(metadata);
    await auditBundle.initialize();
    const args = codexExecArgs({
      profile: config.profile,
      workspace: config.workspace,
      commandText,
      codexSessionId: input.codexSessionId,
      sandbox: runtimeSandbox,
      approvalPolicy,
      configArgs: [
        ...subagentInjection.configArgs,
      ],
    });
    const env = codexRuntimeEnv(runtimeEnv, config.codexHome);
    const child = (this.options.spawnProcess ?? spawn)(codexGate.codexCommand, args, {
      cwd: config.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeTurns.set(commandId, child);

    const abort = () => {
      void this.cancel(commandId);
    };
    input.abortSignal?.addEventListener('abort', abort, { once: true });

    const events = this.eventsForChild(child, metadata, {
      auditBundle,
      cleanup: () => {
        input.abortSignal?.removeEventListener('abort', abort);
        this.activeTurns.delete(commandId);
      },
    });
    return { turnId: commandId, attemptId, codexSessionId: input.codexSessionId, events };
  }

  async cancel(turnId: string): Promise<void> {
    const child = this.activeTurns.get(turnId);
    if (!child || child.killed) return;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 500).unref?.();
  }

  private async *eventsForChild(
    child: CodexChildProcess,
    metadata: CodexRuntimeMetadata,
    options: { auditBundle: RuntimeCodexAuditBundle; cleanup: () => void },
  ): AsyncIterable<NormalizedAgentEvent> {
    const started = runStartedEvent(metadata);
    options.auditBundle.appendNormalizedEvent(started);
    const queue: NormalizedAgentEvent[] = [started];
    const waiters: Array<() => void> = [];
    let stdoutRemainder = '';
    let closed = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | string | null = null;
    let spawnError: unknown;
    const stderrChunks: string[] = [];

    const wake = () => waiters.splice(0).forEach((resolve) => resolve());
    const push = (event: NormalizedAgentEvent) => {
      const scrubbedEvent = scrubRuntimeCodexEventForAudit(event);
      options.auditBundle.appendNormalizedEvent(scrubbedEvent);
      queue.push(scrubbedEvent);
      wake();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        options.auditBundle.appendRawJsonlLine(line);
        try {
          const raw = JSON.parse(line) as unknown;
          metadata.codexSessionId = codexSessionIdFromRaw(raw) ?? metadata.codexSessionId;
          for (const event of normalizeCodexJsonlEvent(raw, metadata)) push(event);
        } catch (error) {
          push(invalidJsonlAuditEvent(metadata, line, error));
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      options.auditBundle.appendStderr(chunk);
      push(stderrAuditEvent(metadata, scrubRuntimeCodexAuditText(chunk)));
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', async (code, signal) => {
      try {
        if (stdoutRemainder.trim()) {
          options.auditBundle.appendRawJsonlLine(stdoutRemainder);
          try {
            const raw = JSON.parse(stdoutRemainder) as unknown;
            metadata.codexSessionId = codexSessionIdFromRaw(raw) ?? metadata.codexSessionId;
            for (const event of normalizeCodexJsonlEvent(raw, metadata)) push(event);
          } catch (error) {
            push(invalidJsonlAuditEvent(metadata, stdoutRemainder, error));
          }
        }
        exitCode = code;
        exitSignal = signal;
        if (spawnError) {
          push({
            ...exitEvent(metadata, { exitCode: 1, signal: null }),
            message: spawnError instanceof Error ? spawnError.message : String(spawnError),
          });
          await options.auditBundle.finalize({ status: 'failed', exitCode: 1, signal: null });
        } else {
          if (metadata.resumeRequested && code !== 0) {
            push(resumeFailureAuditEvent(metadata, {
              exitCode: code,
              signal: exitSignal,
              stderrSummary: summarizeStderr(stderrChunks.join('')),
            }));
          }
          push(exitEvent(metadata, {
            exitCode,
            signal: exitSignal,
            stderrSummary: code === 0 ? undefined : summarizeStderr(stderrChunks.join('')),
          }));
          await options.auditBundle.finalize({
            status: signal ? 'cancelled' : code === 0 ? 'done' : 'failed',
            exitCode,
            signal: exitSignal,
          });
        }
      } finally {
        closed = true;
        options.cleanup();
        wake();
      }
    });

    try {
      while (!closed || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (!closed) await new Promise<void>((resolve) => waiters.push(resolve));
      }
    } finally {
      options.cleanup();
    }
  }
}

function evidenceRefsForTurn(commandId: string, attemptId: string): string[] {
  return [
    `audit:codex-runtime:${commandId}:${attemptId}:raw-jsonl`,
    `audit:codex-runtime:${commandId}:${attemptId}:stderr`,
    `audit:codex-runtime:${commandId}:${attemptId}:normalized-events`,
  ];
}

function summarizeStderr(stderr: string): string | undefined {
  const compact = stderr.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  const actionable = actionableStderrSummary(compact);
  if (actionable) return scrubRuntimeCodexAuditText(actionable);
  const summary = compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
  return scrubRuntimeCodexAuditText(summary);
}

function actionableStderrSummary(compact: string): string | undefined {
  for (const pattern of [
    /unexpected status\s+401[^.]*|401\s+Unauthorized[^.]*|Invalid token[^.]*/i,
    /unexpected status\s+429[^.]*|429\s+Too Many Requests[^.]*|rate limit[^.]*|quota[^.]*/i,
    /unexpected status\s+502[^.]*|502\s+Bad Gateway[^.]*|Bad Gateway[^.]*/i,
    /ECONNREFUSED[^.]*|connection refused[^.]*|failed to connect[^.]*/i,
    /ENOTFOUND[^.]*|timed out[^.]*/i,
    /unexpected status\s+403[^.]*|403\s+Forbidden[^.]*/i,
  ]) {
    const match = pattern.exec(compact);
    if (match?.[0] && !isRemotePluginAuthWarning(compact, match.index)) {
      return match[0].length > 240 ? `${match[0].slice(0, 237)}...` : match[0];
    }
  }
  return undefined;
}

function isRemotePluginAuthWarning(text: string, matchIndex: number) {
  const context = text.slice(Math.max(0, matchIndex - 180), matchIndex + 240);
  return /codex_core_plugins|remote plugin sync|chatgpt\.com\/backend-api\/plugins|featured plugin ids/i.test(context);
}

function codexExecArgs(input: {
  profile: string;
  workspace: string;
  commandText: string;
  sandbox: string;
  approvalPolicy: AgentCliApprovalPolicy;
  codexSessionId?: string;
  configArgs?: string[];
}): string[] {
  const globalArgs = [
    ...(input.configArgs ?? []),
    ...RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
    ...RUNTIME_CODEX_DISABLE_PLUGIN_ARGS,
    '--profile',
    input.profile,
    '--cd',
    input.workspace,
    '--sandbox',
    input.sandbox,
    '--ask-for-approval',
    input.approvalPolicy,
  ];
  if (input.codexSessionId) {
    return [
      ...globalArgs,
      'exec',
      'resume',
      '--json',
      ...RUNTIME_CODEX_EXEC_ISOLATION_ARGS,
      input.codexSessionId,
      input.commandText,
    ];
  }
  return [
    ...globalArgs,
    'exec',
    '--json',
    ...RUNTIME_CODEX_EXEC_ISOLATION_ARGS,
    input.commandText,
  ];
}
