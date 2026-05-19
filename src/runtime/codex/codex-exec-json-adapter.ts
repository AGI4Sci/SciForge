import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { codexSessionIdFromRaw, commandIdForText, exitEvent, invalidJsonlAuditEvent, normalizeCodexJsonlEvent, runStartedEvent, stderrAuditEvent, type CodexRuntimeMetadata, type NormalizedAgentEvent } from './codex-event-normalizer.js';
import { type AgentCliAdapter, type AgentCliStartTurnInput, type AgentCliTurn } from './agent-cli-adapter.js';
import { assertCodexRuntimeConfig, codexRuntimeEnv } from './codex-runtime-config.js';
import { prepareRuntimeGuiExtensionInjection } from './gui-extension-manifest.js';

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => CodexChildProcess;

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
    const commandId = commandIdForText(commandText, config.workspace);
    const guiInjection = await prepareRuntimeGuiExtensionInjection(input.guiExtension);
    const metadata: CodexRuntimeMetadata = {
      provider: config.provider,
      model: config.model,
      profile: config.profile,
      workspace: config.workspace,
      commandId,
      commandText,
      codexSessionId: input.codexSessionId,
    };
    const args = codexExecArgs({
      profile: config.profile,
      workspace: config.workspace,
      commandText,
      codexSessionId: input.codexSessionId,
      configArgs: guiInjection?.configArgs ?? [],
    });
    const child = (this.options.spawnProcess ?? spawn)('codex', args, {
      cwd: config.workspace,
      env: codexRuntimeEnv(this.options.env ?? process.env, config.codexHome),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeTurns.set(commandId, child);

    const abort = () => {
      void this.cancel(commandId);
    };
    input.abortSignal?.addEventListener('abort', abort, { once: true });

    const events = this.eventsForChild(child, metadata, () => {
      input.abortSignal?.removeEventListener('abort', abort);
      this.activeTurns.delete(commandId);
    });
    return { turnId: commandId, codexSessionId: input.codexSessionId, events };
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
    cleanup: () => void,
  ): AsyncIterable<NormalizedAgentEvent> {
    const queue: NormalizedAgentEvent[] = [runStartedEvent(metadata)];
    const waiters: Array<() => void> = [];
    let stdoutRemainder = '';
    let closed = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | string | null = null;
    let spawnError: unknown;

    const wake = () => waiters.splice(0).forEach((resolve) => resolve());
    const push = (event: NormalizedAgentEvent) => {
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
    child.stderr.on('data', (chunk: string) => push(stderrAuditEvent(metadata, chunk)));
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code, signal) => {
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
        push(exitEvent(metadata, { exitCode, signal: exitSignal }));
      }
      closed = true;
      cleanup();
      wake();
    });

    try {
      while (!closed || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (!closed) await new Promise<void>((resolve) => waiters.push(resolve));
      }
    } finally {
      cleanup();
    }
  }
}

function codexExecArgs(input: {
  profile: string;
  workspace: string;
  commandText: string;
  codexSessionId?: string;
  configArgs?: string[];
}): string[] {
  if (input.codexSessionId) {
    return [
      ...(input.configArgs ?? []),
      '--profile',
      input.profile,
      '--cd',
      input.workspace,
      'exec',
      'resume',
      '--json',
      input.codexSessionId,
      input.commandText,
    ];
  }
  return [
    'exec',
    '--json',
    ...(input.configArgs ?? []),
    '--profile',
    input.profile,
    '--cd',
    input.workspace,
    input.commandText,
  ];
}
