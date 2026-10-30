import { describe, expect, it } from 'vitest'
import type { ModelReasoningOutcome } from '@shared/model-reasoning'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import {
  composerModelEntryFor,
  composerReasoningDiscoveryKey,
  composerReasoningEffortRepresentable,
  composerReasoningEntry,
  composerReasoningLevelLabelKey,
  composerReasoningOptionsFromOutcome
} from './composer-reasoning-discovery'

const ENTRY = {
  id: 'sciforge-router',
  upstreamModel: 'deepseek-v4.1-flash',
  displayName: 'deepseek-v4.1-flash',
  protocol: 'chat-completions',
  endpoint: 'https://api.deepseek.com/v1',
  reasoning: { levels: ['high'], defaultLevel: null }
}
const GROUPS: ModelProviderModelGroup[] = [
  { providerId: 'model-router', label: 'Model Router', modelIds: ['sciforge-router'], models: [ENTRY] }
]

function outcome(overrides: Partial<ModelReasoningOutcome>): ModelReasoningOutcome {
  return {
    state: 'known',
    levels: [],
    completeness: null,
    defaultLevel: null,
    source: 'upstream',
    verifiedAt: null,
    checkedAt: '2026-10-26T12:00:00.000Z',
    attachEffort: true,
    ...overrides
  }
}

describe('composer reasoning discovery helpers', () => {
  it('locates the real-model entry behind a routing id', () => {
    expect(composerModelEntryFor(GROUPS, ' sciforge-router ')).toEqual(ENTRY)
    expect(composerModelEntryFor(GROUPS, 'missing')).toBeNull()
    expect(composerModelEntryFor(undefined, 'sciforge-router')).toBeNull()
  })

  it('resolves the default selection to the first declared entry', () => {
    expect(composerReasoningEntry(GROUPS, '')?.id).toBe('sciforge-router')
    expect(composerReasoningEntry(GROUPS, 'auto')?.id).toBe('sciforge-router')
    // Routing ids match case-sensitively; a concrete catalog value that has no
    // declaration stays unresolved.
    expect(composerReasoningEntry(GROUPS, 'Sciforge-Router')).toBeNull()
    expect(composerReasoningEntry(GROUPS, 'gpt-6.1-sol')).toBeNull()
    expect(composerReasoningEntry(undefined, 'auto')).toBeNull()
    expect(composerReasoningEntry([{ providerId: 'p', label: 'P', modelIds: [], models: [] }], 'auto')).toBeNull()
  })

  it('offers only evidence-backed levels plus an honest upstream default', () => {
    expect(composerReasoningOptionsFromOutcome(null)).toEqual([{ id: '', isDefault: true }])
    expect(composerReasoningOptionsFromOutcome(outcome({ state: 'unknown' })))
      .toEqual([{ id: '', isDefault: true }])
    expect(composerReasoningOptionsFromOutcome(outcome({ state: 'unsupported', attachEffort: false })))
      .toEqual([{ id: '', isDefault: true }])
    expect(composerReasoningOptionsFromOutcome(outcome({ levels: ['off', 'low', 'high'], defaultLevel: 'low' })))
      .toEqual([
        { id: '', isDefault: true },
        { id: 'off', isDefault: false },
        { id: 'low', isDefault: true },
        { id: 'high', isDefault: false }
      ])
  })

  it('maps known tokens to their labels and keeps provider-specific tokens raw', () => {
    expect(composerReasoningLevelLabelKey('off')).toBe('composerReasoningOff')
    expect(composerReasoningLevelLabelKey('XHIGH')).toBe('composerReasoningXhigh')
    expect(composerReasoningLevelLabelKey('turbo')).toBeUndefined()
  })

  it('keys discovery responses by the whole binding', () => {
    expect(composerReasoningDiscoveryKey(ENTRY)).toBe(
      ['model-router', 'deepseek-v4.1-flash', 'chat-completions', 'https://api.deepseek.com/v1'].join('\u0000')
    )
  })

  it('never folds an explicit choice away without evidence', () => {
    expect(composerReasoningEffortRepresentable(outcome({ levels: ['high'] }), '')).toBe(true)
    expect(composerReasoningEffortRepresentable(outcome({ levels: ['high'] }), 'high')).toBe(true)
    expect(composerReasoningEffortRepresentable(outcome({ levels: ['high'] }), 'low')).toBe(false)
    // Unknown and unsupported outcomes keep the explicit selection as a passthrough.
    expect(composerReasoningEffortRepresentable(outcome({ state: 'unknown', levels: [] }), 'turbo')).toBe(true)
    expect(composerReasoningEffortRepresentable(null, 'high')).toBe(true)
  })
})