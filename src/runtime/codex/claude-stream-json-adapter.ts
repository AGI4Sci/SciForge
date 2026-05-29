import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  normalizeBackendEvent,
  type BackendEventNormalizationOptions,
} from './backend-event-normalization.js';
import { backendEventToNormalizedAgentEvent } from './backend-agent-event-adapter.js';
import {
  attemptIdForCommand,
  commandIdForText,
  runStartedEvent,
  stderrAuditEvent,
  type CodexRuntimeMetadata,
  type NormalizedAgentEvent,
} from './codex-event-normalizer.js';
import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from './agent-cli-adapter.js';

export type SpawnClaudeProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
) => ClaudeChildProcess;

interface ClaudeChildProcess {
  stdin?: { end(text?: string): void };
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export class ClaudeStreamJsonAdapter implements AgentCliAdapter {
  private readonly activeTurns = new Map<string, ClaudeChildProcess>();

  constructor(private readonly options: {
    spawnProcess?: SpawnClaudeProcess;
    env?: NodeJS.ProcessEnv;
    command?: string;
    provider?: string;
    model?: string;
    profile?: string;
  } = {}) {}

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    const commandText = input.commandText.trim();
    if (!commandText) throw new Error('Claude stream-json command text is required.');
    const workspace = input.workspacePath;
    const commandId = input.commandId?.trim() || commandIdForText(commandText, workspace);
    const attemptId = input.attemptId?.trim() || attemptIdForCommand(commandId);
    const env = this.options.env ?? process.env;
    const command = this.options.command ?? env.SCIFORGE_CLAUDE_COMMAND ?? 'claude';
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    const child = (this.options.spawnProcess ?? spawn)(command, args, {
      cwd: workspace,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin?.end(`${JSON.stringify({ type: 'user', message: commandText })}\n`);
    this.activeTurns.set(commandId, child);
    const metadata: CodexRuntimeMetadata = {
      provider: this.options.provider ?? 'claude-stream-json',
      model: this.options.model ?? 'claude-code',
      profile: input.profile ?? this.options.profile ?? 'claude-code-like',
      workspace,
      commandId,
      attemptId,
      commandText,
      codexSessionId: input.codexSessionId,
      evidenceRefs: [`audit:claude-stream-json:${commandId}:${attemptId}:normalized-events`],
      resumeRequested: Boolean(input.codexSessionId),
    };
    return {
      turnId: commandId,
      attemptId,
      codexSessionId: metadata.codexSessionId,
      events: this.eventsForChild(child, metadata, {
        cleanup: () => this.activeTurns.delete(commandId),
      }),
    };
  }

  async cancel(turnId: string): Promise<void> {
    const child = this.activeTurns.get(turnId);
    if (!child || child.killed) return;
    child.kill('SIGTERM');
    this.activeTurns.delete(turnId);
  }

  private async *eventsForChild(
    child: ClaudeChildProcess,
    metadata: CodexRuntimeMetadata,
    options: BackendEventNormalizationOptions & { cleanup: () => void },
  ): AsyncIterable<NormalizedAgentEvent> {
    const queue: NormalizedAgentEvent[] = [runStartedEvent(metadata)];
    const waiters: Array<() => void> = [];
    let stdoutRemainder = '';
    let closed = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | string | null = null;
    let spawnError: unknown;
    let sawTerminalEvent = false;

    const wake = () => waiters.splice(0).forEach((resolve) => resolve());
    const push = (event: NormalizedAgentEvent) => {
      if (event.type === 'done' || event.type === 'failed' || event.type === 'cancelled') sawTerminalEvent = true;
      queue.push(event);
      wake();
    };
    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const raw = JSON.parse(line) as unknown;
        const normalized = normalizeBackendEvent(raw, { backend: 'claude-stream-json' });
        for (const event of normalized.events) {
          const traceSteps = normalized.traceSteps.filter((step) => step.id === event.traceStepId);
          push(backendEventToNormalizedAgentEvent(event, metadata, traceSteps));
        }
      } catch (error) {
        push(stderrAuditEvent(metadata, error instanceof Error ? error.message : String(error)));
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      push(stderrAuditEvent(metadata, chunk));
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code, signal) => {
      if (stdoutRemainder.trim()) consumeLine(stdoutRemainder);
      exitCode = code;
      exitSignal = signal;
      if (spawnError) {
        push({
          ...stderrAuditEvent(metadata, spawnError instanceof Error ? spawnError.message : String(spawnError)),
          type: 'failed',
          status: 'failed',
          exitCode: 1,
          signal: null,
        });
      } else if (!sawTerminalEvent) {
        push({
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: signal ? 'cancelled' : code === 0 ? 'done' : 'failed',
          timestamp: new Date().toISOString(),
          provider: metadata.provider,
          model: metadata.model,
          profile: metadata.profile,
          workspace: metadata.workspace,
          commandId: metadata.commandId,
          attemptId: metadata.attemptId,
          codexSessionId: metadata.codexSessionId,
          evidenceRefs: metadata.evidenceRefs,
          status: signal ? 'cancelled' : code === 0 ? 'done' : 'failed',
          message: signal ? `Claude stream-json cancelled by ${signal}` : code === 0 ? 'Claude stream-json completed.' : `Claude stream-json exited with code ${code ?? 1}.`,
          exitCode,
          signal: exitSignal,
        });
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
