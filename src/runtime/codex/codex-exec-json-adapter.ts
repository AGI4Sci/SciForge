import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { attemptIdForCommand, codexSessionIdFromRaw, commandIdForText, exitEvent, guiPresentEvent, invalidJsonlAuditEvent, normalizeCodexJsonlEvent, resumeFailureAuditEvent, runStartedEvent, stderrAuditEvent, type CodexRuntimeMetadata, type NormalizedAgentEvent } from './codex-event-normalizer.js';
import { type AgentCliAdapter, type AgentCliStartTurnInput, type AgentCliTurn } from './agent-cli-adapter.js';
import { assertCodexNoForkGate } from '../../../packages/backend/src/codex-compatibility-gate.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex-runtime-config.js';
import { prepareRuntimeGuiExtensionInjection } from './gui-extension-manifest.js';
import { loadGuiExtensionSnapshot } from './gui-extension-state.js';

const RUNTIME_CODEX_EXEC_ISOLATION_ARGS = ['--skip-git-repo-check', '--ignore-rules'];

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => CodexChildProcess;

const RUNTIME_CODEX_SANDBOX = 'workspace-write';
const RUNTIME_CODEX_APPROVAL_POLICY = 'never';

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
      allowOpenAiRuntime: input.allowOpenAiRuntime,
      env: this.options.env,
    });
    const commandText = input.commandText.trim();
    if (!commandText) throw new Error('Runtime Codex command text is required.');
    const commandId = input.commandId?.trim() || commandIdForText(commandText, config.workspace);
    const attemptId = input.attemptId?.trim() || attemptIdForCommand(commandId);
    const resumeRequested = Boolean(input.codexSessionId);
    const evidenceRefs = evidenceRefsForTurn(commandId, attemptId);
    const guiInjection = await prepareRuntimeGuiExtensionInjection(guiExtensionOptions(input.guiExtension, config.workspace));
    const metadata: CodexRuntimeMetadata = {
      provider: config.provider,
      model: config.model,
      profile: config.profile,
      workspace: config.workspace,
      commandId,
      attemptId,
      commandText,
      codexSessionId: input.codexSessionId,
      evidenceRefs,
      resumeRequested,
    };
    const args = codexExecArgs({
      profile: config.profile,
      workspace: config.workspace,
      commandText,
      codexSessionId: input.codexSessionId,
      configArgs: guiInjection?.configArgs ?? [],
    });
    const runtimeEnv = this.options.env ?? process.env;
    const codexGate = assertCodexNoForkGate({ codexCommand: runtimeEnv.SCIFORGE_RUNTIME_CODEX_COMMAND });
    const env = codexRuntimeEnv(runtimeEnv, config.codexHome);
    if (guiInjection) {
      env.PATH = [guiInjection.binDir, env.PATH].filter(Boolean).join(':');
      env.SCIFORGE_GUI_EXTENSION_STATE = guiInjection.statePath;
    }
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
      guiExtensionStatePath: guiInjection?.statePath,
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
    options: { guiExtensionStatePath?: string; cleanup: () => void },
  ): AsyncIterable<NormalizedAgentEvent> {
    const queue: NormalizedAgentEvent[] = [runStartedEvent(metadata)];
    const waiters: Array<() => void> = [];
    let stdoutRemainder = '';
    let closed = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | string | null = null;
    let spawnError: unknown;
    let sawGuiPresent = false;
    const stderrChunks: string[] = [];

    const wake = () => waiters.splice(0).forEach((resolve) => resolve());
    const push = (event: NormalizedAgentEvent) => {
      if (event.type === 'gui_present') sawGuiPresent = true;
      queue.push(event);
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
      push(stderrAuditEvent(metadata, chunk));
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', async (code, signal) => {
      if (stdoutRemainder.trim()) {
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
      } else {
        if (code === 0 && !sawGuiPresent && options.guiExtensionStatePath) {
          const presentation = await latestGuiPresentFromState(options.guiExtensionStatePath).catch(() => undefined);
          if (presentation) push(guiPresentEvent(metadata, presentation));
        }
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
      }
      closed = true;
      options.cleanup();
      wake();
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

async function latestGuiPresentFromState(statePath: string): Promise<Parameters<typeof guiPresentEvent>[1] | undefined> {
  const snapshot = await loadGuiExtensionSnapshot(statePath);
  const present = [...(snapshot.intentLog ?? [])]
    .reverse()
    .find((entry) => entry.tool === 'gui.present' && entry.applied === true);
  if (!present) return undefined;
  const panel = present.placement?.panel ?? snapshot.hotRegion?.panel;
  const viewId = present.placement?.viewId ?? snapshot.hotRegion?.viewId;
  const region = (snapshot.regions ?? []).find((candidate) => {
    if (viewId && candidate.viewId === viewId) return true;
    return panel && candidate.regionId === panel;
  }) ?? (snapshot.regions ?? []).find((candidate) => candidate.regionId !== 'chat') ?? (snapshot.regions ?? [])[0];
  const text = stringField(region?.summary)
    ?? stringField(region?.selectionSummary)
    ?? stringField(region?.title)
    ?? present.summary;
  if (!text.trim()) return undefined;
  return {
    text,
    source: undefined,
    ref: stringField(snapshot.hotRegion?.primaryRef) ?? stringField(region?.visibleRefs?.[0]),
    title: stringField(region?.title) ?? present.summary,
    intentLogId: present.id,
    placement: present.placement,
  };
}

function evidenceRefsForTurn(commandId: string, attemptId: string): string[] {
  return [
    `audit:codex-runtime:${commandId}:${attemptId}:raw-jsonl`,
    `audit:codex-runtime:${commandId}:${attemptId}:stderr`,
    `audit:codex-runtime:${commandId}:${attemptId}:normalized-events`,
  ];
}

function guiExtensionOptions(
  options: AgentCliStartTurnInput['guiExtension'],
  workspace: string,
): AgentCliStartTurnInput['guiExtension'] {
  if (options?.enabled === false) return options;
  return {
    ...options,
    statePath: options?.statePath ?? join(workspace, '.sciforge', 'runtime-gui-extension-state.json'),
  };
}

function summarizeStderr(stderr: string): string | undefined {
  const compact = stderr.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function codexExecArgs(input: {
  profile: string;
  workspace: string;
  commandText: string;
  codexSessionId?: string;
  configArgs?: string[];
}): string[] {
  const globalArgs = [
    ...(input.configArgs ?? []),
    '--profile',
    input.profile,
    '--cd',
    input.workspace,
    '--sandbox',
    RUNTIME_CODEX_SANDBOX,
    '--ask-for-approval',
    RUNTIME_CODEX_APPROVAL_POLICY,
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

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
