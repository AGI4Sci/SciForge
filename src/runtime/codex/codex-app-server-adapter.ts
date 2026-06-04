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
  allowOpenAiRuntime?: boolean;
  runtimeIntent?: CodexRuntimeHostIntent;
  guiExtension?: {
    enabled?: boolean;
    statePath?: string;
  };
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
  declaredIntents?: AgentCliStartTurnInput['declaredIntents'];
  abortSignal?: AbortSignal;
}

export interface CodexRuntimeHostIntent {
  schemaVersion: 'sciforge.runtime-codex.host-intent.v1';
  kind: 'computer-use-native-route';
  source: 'host-owned';
}

export interface CodexAppServerTurnStream {
  threadId?: string;
  turnId?: string;
  provider?: string;
  model?: string;
  profile?: string;
  workspacePath?: string;
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
      allowOpenAiRuntime: input.allowOpenAiRuntime,
      runtimeIntent: input.runtimeIntent,
      guiExtension: input.guiExtension,
      humanApproval: input.humanApproval,
      uiState: input.uiState,
      declaredIntents: input.declaredIntents,
      abortSignal: input.abortSignal,
    });
    const publicRuntimeMode = isHostOwnedComputerUseRuntimeIntent(input.runtimeIntent);
    const turnId = stream.turnId ?? commandId;
    this.activeTurns.set(commandId, { threadId: stream.threadId ?? input.codexSessionId, turnId });
    const metadata: CodexRuntimeMetadata = {
      provider: publicRuntimeMode ? 'host-owned-runtime' : stream.provider ?? this.options.provider ?? 'codex-app-server',
      model: publicRuntimeMode ? 'computer-use-native-route' : stream.model ?? this.options.model ?? 'app-server-native',
      profile: publicRuntimeMode ? 'host-owned' : stream.profile ?? input.profile ?? this.options.profile ?? 'codex-app-server',
      workspace: publicRuntimeMode ? 'workspace:current' : stream.workspacePath ?? workspace,
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
        publicRuntimeMode,
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
    options: BackendEventNormalizationOptions & { cleanup: () => void; publicRuntimeMode?: boolean },
  ): AsyncIterable<NormalizedAgentEvent> {
    try {
      const started = runStartedEvent(metadata);
      yield options.publicRuntimeMode ? publicHostOwnedRuntimeEvent(started, metadata) : started;
      for await (const raw of rawEvents) {
        if (isNormalizedAgentEventEnvelope(raw)) {
          const event = {
            ...raw,
            provider: typeof raw.provider === 'string' ? raw.provider : metadata.provider,
            model: typeof raw.model === 'string' ? raw.model : metadata.model,
            profile: typeof raw.profile === 'string' ? raw.profile : metadata.profile,
            workspace: typeof raw.workspace === 'string' ? raw.workspace : metadata.workspace,
            commandId: typeof raw.commandId === 'string' ? raw.commandId : metadata.commandId,
            attemptId: typeof raw.attemptId === 'string' ? raw.attemptId : metadata.attemptId,
            evidenceRefs: Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs : metadata.evidenceRefs,
          } as NormalizedAgentEvent;
          yield options.publicRuntimeMode ? publicHostOwnedRuntimeEvent(event, metadata) : event;
          continue;
        }
        const normalized = normalizeBackendEvent(raw, {
          backend: 'codex-app-server',
          traceParent: options.traceParent,
        });
        for (const event of normalized.events) {
          if (event.threadId) metadata.codexSessionId = event.threadId;
          const traceSteps = normalized.traceSteps.filter((step) => step.id === event.traceStepId);
          const normalizedEvent = backendEventToNormalizedAgentEvent(event, metadata, traceSteps);
          yield options.publicRuntimeMode ? publicHostOwnedRuntimeEvent(normalizedEvent, metadata) : normalizedEvent;
        }
      }
    } finally {
      options.cleanup();
    }
  }
}

function isHostOwnedComputerUseRuntimeIntent(value: unknown): value is CodexRuntimeHostIntent {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 'sciforge.runtime-codex.host-intent.v1'
    && (value as Record<string, unknown>).kind === 'computer-use-native-route'
    && (value as Record<string, unknown>).source === 'host-owned';
}

function publicHostOwnedRuntimeEvent(event: NormalizedAgentEvent, metadata: CodexRuntimeMetadata): NormalizedAgentEvent {
  const { raw: _raw, ...rest } = event;
  const projected = publicHostOwnedRuntimeValue(rest) as Record<string, unknown>;
  return {
    ...projected,
    provider: metadata.provider,
    model: metadata.model,
    profile: metadata.profile,
    workspace: metadata.workspace,
    commandId: typeof event.commandId === 'string' ? event.commandId : metadata.commandId,
    attemptId: typeof event.attemptId === 'string' ? event.attemptId : metadata.attemptId,
    evidenceRefs: Array.isArray(event.evidenceRefs) ? event.evidenceRefs : metadata.evidenceRefs,
  } as NormalizedAgentEvent;
}

function publicHostOwnedRuntimeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeHostOwnedRuntimeText(value);
  if (Array.isArray(value)) return value.map(publicHostOwnedRuntimeValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['provider', 'model', 'profile', 'workspace', 'workspacePath', 'raw'].includes(key))
      .map(([key, entry]) => [key, publicHostOwnedRuntimeValue(entry)]),
  );
}

function sanitizeHostOwnedRuntimeText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-secret]')
    .replace(/\b(?:sk|rk|pk|ghp|github_pat)[-_][A-Za-z0-9._-]{8,}\b/gi, '[redacted-secret]')
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization|credential|client[_-]?secret)\b\s*[:=]?\s*["']?([^"'\s,;)}\]]{4,})?/gi, '$1=[redacted-secret]')
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/(^|[\s([{:=])((?:~\/|\/(?:Applications|Users|workspace|tmp|var|private|Volumes|home|opt|etc|mnt|srv|Library)\b)[^\s"',;)}\]]*)/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(^|[\s([{:=])((?:[A-Za-z]:[\\/]|\\\\)[^\s"',;)}\]]*)/g, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/\b(?:stdout|stderr|raw[_ -]?jsonl?|jsonl|raw[_ -]?transcript|raw[_ -]?provider[_ -]?(?:body|payload|output)|provider[_ -]?raw[_ -]?(?:body|payload|output))\b/gi, 'runtime audit');
}

function isNormalizedAgentEventEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 'sciforge.codex.normalized-event.v1'
    && typeof (value as Record<string, unknown>).type === 'string';
}

function unavailableCodexAppServerClient(): CodexAppServerClient {
  return {
    async startTurn() {
      throw new Error('Codex app-server client is not configured.');
    },
  };
}
