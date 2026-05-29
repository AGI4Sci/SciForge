import {
  normalizeBackendEvent,
  type BackendEventNormalizationOptions,
} from './backend-event-normalization.js';
import { backendEventToNormalizedAgentEvent } from './backend-agent-event-adapter.js';
import {
  attemptIdForCommand,
  commandIdForText,
  runStartedEvent,
  type CodexRuntimeMetadata,
  type NormalizedAgentEvent,
} from './codex-event-normalizer.js';
import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from './agent-cli-adapter.js';

export interface CodexAppServerStartTurnRequest {
  threadId?: string;
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
  profile?: string;
  abortSignal?: AbortSignal;
}

export interface CodexAppServerTurnStream {
  threadId?: string;
  turnId?: string;
  events: AsyncIterable<unknown>;
}

export interface CodexAppServerClient {
  startTurn(request: CodexAppServerStartTurnRequest): Promise<CodexAppServerTurnStream>;
  steerTurn?(request: {
    threadId?: string;
    turnId: string;
    text: string;
    abortSignal?: AbortSignal;
  }): Promise<void>;
  cancelTurn?(request: { threadId?: string; turnId: string }): Promise<void>;
}

export class CodexAppServerAdapter implements AgentCliAdapter {
  private readonly activeTurns = new Map<string, { threadId?: string; turnId: string }>();

  constructor(private readonly options: {
    client?: CodexAppServerClient;
    provider?: string;
    model?: string;
    profile?: string;
  } = {}) {}

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    const commandText = input.commandText.trim();
    if (!commandText) throw new Error('Codex app-server command text is required.');
    const workspace = input.workspacePath;
    const commandId = input.commandId?.trim() || commandIdForText(commandText, workspace);
    const attemptId = input.attemptId?.trim() || attemptIdForCommand(commandId);
    const client = this.options.client ?? unavailableCodexAppServerClient();
    const stream = await client.startTurn({
      threadId: input.codexSessionId,
      commandText,
      workspacePath: workspace,
      commandId,
      attemptId,
      profile: input.profile ?? this.options.profile,
      abortSignal: input.abortSignal,
    });
    const turnId = stream.turnId ?? commandId;
    this.activeTurns.set(commandId, { threadId: stream.threadId ?? input.codexSessionId, turnId });
    const metadata: CodexRuntimeMetadata = {
      provider: this.options.provider ?? 'codex-app-server',
      model: this.options.model ?? 'app-server-native',
      profile: input.profile ?? this.options.profile ?? 'codex-app-server',
      workspace,
      commandId,
      attemptId,
      commandText,
      codexSessionId: stream.threadId ?? input.codexSessionId,
      evidenceRefs: [`audit:codex-app-server:${commandId}:${attemptId}:normalized-events`],
      resumeRequested: Boolean(input.codexSessionId),
    };
    return {
      turnId: commandId,
      attemptId,
      codexSessionId: metadata.codexSessionId,
      events: this.eventsForStream(stream.events, metadata, {
        traceParent: input.commandId,
        cleanup: () => this.activeTurns.delete(commandId),
      }),
    };
  }

  async cancel(turnId: string): Promise<void> {
    const active = this.activeTurns.get(turnId);
    if (!active) return;
    await this.options.client?.cancelTurn?.(active);
    this.activeTurns.delete(turnId);
  }

  async steer(turnId: string, text: string): Promise<void> {
    const active = this.activeTurns.get(turnId);
    if (!active) throw new Error(`Codex app-server turn is not active: ${turnId}`);
    await this.options.client?.steerTurn?.({ ...active, text });
  }

  private async *eventsForStream(
    rawEvents: AsyncIterable<unknown>,
    metadata: CodexRuntimeMetadata,
    options: BackendEventNormalizationOptions & { cleanup: () => void },
  ): AsyncIterable<NormalizedAgentEvent> {
    try {
      yield runStartedEvent(metadata);
      for await (const raw of rawEvents) {
        const normalized = normalizeBackendEvent(raw, {
          backend: 'codex-app-server',
          traceParent: options.traceParent,
        });
        for (const event of normalized.events) {
          if (event.threadId) metadata.codexSessionId = event.threadId;
          const traceSteps = normalized.traceSteps.filter((step) => step.id === event.traceStepId);
          yield backendEventToNormalizedAgentEvent(event, metadata, traceSteps);
        }
      }
    } finally {
      options.cleanup();
    }
  }
}

function unavailableCodexAppServerClient(): CodexAppServerClient {
  return {
    async startTurn() {
      throw new Error('Codex app-server client is not configured.');
    },
  };
}
