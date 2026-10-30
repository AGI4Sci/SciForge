import { describe, expect, it } from 'vitest'
import {
  codexAppServerThreadReasoningConfig,
  codexAppServerTurnReasoningParams
} from './reasoning-config'

describe('Codex app-server reasoning config', () => {
  it('builds thread/start config with explicit effort, summary, and raw reasoning visibility', () => {
    expect(codexAppServerThreadReasoningConfig({ reasoningEffort: 'high' })).toEqual({
      model_reasoning_effort: 'high',
      show_raw_agent_reasoning: true,
      model_reasoning_summary: 'detailed'
    })
  })

  it('builds turn/start params with explicit effort and summary without inventing reasoning text', () => {
    const params = codexAppServerTurnReasoningParams({ reasoningEffort: 'low' })

    expect(params).toEqual({
      effort: 'low',
      summary: 'detailed'
    })
    expect(params).not.toHaveProperty('text')
    expect(params).not.toHaveProperty('reasoning_text')
    expect(params).not.toHaveProperty('show_raw_agent_reasoning')
  })

  it('leaves reasoning effort unset for blank input instead of inventing a level', () => {
    expect(codexAppServerThreadReasoningConfig({
      reasoningEffort: ' ',
      reasoningSummary: '',
      showRawAgentReasoning: false
    })).toEqual({
      model_reasoning_effort: '',
      show_raw_agent_reasoning: false,
      model_reasoning_summary: 'detailed'
    })
    expect(codexAppServerTurnReasoningParams({
      reasoningEffort: null,
      reasoningSummary: ' '
    })).toEqual({
      effort: '',
      summary: 'detailed'
    })
  })

  it('preserves runtime-discovered reasoning identifiers without aliasing newer values', () => {
    expect(codexAppServerThreadReasoningConfig({ reasoningEffort: 'max' })).toMatchObject({
      model_reasoning_effort: 'max'
    })
    expect(codexAppServerTurnReasoningParams({ reasoningEffort: ' ultra ' })).toMatchObject({
      effort: 'ultra'
    })
  })
})
