export type CodexAppServerReasoningConfigInput = {
  reasoningEffort?: string | null
  reasoningSummary?: string | null
  showRawAgentReasoning?: boolean
}

export type CodexAppServerThreadReasoningConfig = {
  model_reasoning_effort: string
  show_raw_agent_reasoning: boolean
  model_reasoning_summary: string
}

export type CodexAppServerTurnReasoningParams = {
  effort: string
  summary: string
}

// Unset stays unset: a blank effort means "upstream default", never an invented level.
const DEFAULT_REASONING_EFFORT = ''
const DEFAULT_REASONING_SUMMARY = 'detailed'

export function codexAppServerThreadReasoningConfig(
  input: CodexAppServerReasoningConfigInput = {}
): CodexAppServerThreadReasoningConfig {
  return {
    model_reasoning_effort: normalizedReasoningEffort(input.reasoningEffort),
    show_raw_agent_reasoning: input.showRawAgentReasoning ?? true,
    model_reasoning_summary: normalizedReasoningValue(input.reasoningSummary, DEFAULT_REASONING_SUMMARY)
  }
}

export function codexAppServerTurnReasoningParams(
  input: CodexAppServerReasoningConfigInput = {}
): CodexAppServerTurnReasoningParams {
  return {
    effort: normalizedReasoningEffort(input.reasoningEffort),
    summary: normalizedReasoningValue(input.reasoningSummary, DEFAULT_REASONING_SUMMARY)
  }
}

function normalizedReasoningEffort(value: string | null | undefined): string {
  return normalizedReasoningValue(value, DEFAULT_REASONING_EFFORT)
}

function normalizedReasoningValue(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
