import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

export interface AgentCliStartTurnInput {
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  profile?: string;
  codexSessionId?: string;
  abortSignal?: AbortSignal;
  allowOpenAiRuntime?: boolean;
  guiExtension?: {
    enabled?: boolean;
    statePath?: string;
  };
}

export interface AgentCliTurn {
  turnId: string;
  attemptId: string;
  codexSessionId?: string;
  events: AsyncIterable<NormalizedAgentEvent>;
}

export interface AgentCliAdapter {
  startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn>;
  cancel(turnId: string): Promise<void>;
}
