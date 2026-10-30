/**
 * Contract tests for the composer → runtime turn-settings path.
 *
 * The load-bearing cases:
 *  - codex catalog known model with an explicit empty list → nothing sent (上游默认);
 *  - provider-routed model (e.g. the Model Router alias) outside the runtime
 *    catalog → explicit choice passes through (unknown ≠ drop; the provider
 *    side enforces exact-or-refuse);
 *  - catalog unavailable → nothing is invented AND nothing explicit is dropped.
 */
import { describe, expect, it } from 'vitest'
import type { AgentRuntimeModelCatalog } from '@shared/agent-runtime-contract'
import {
  composerModelControlOptions,
  composerRuntimeModelIds,
  filterReasoningOptionsForRuntime,
  runtimeTransfersServiceTier,
  supportedComposerTurnSettings
} from './composer-runtime-options'
import { AGENT_RUNTIME_TURN_CONTROLS } from '@shared/agent-runtime-turn-controls'

function catalogOf(
  models: Array<Record<string, unknown>>,
  defaultModelId?: string
): AgentRuntimeModelCatalog {
  return {
    available: true,
    ...(defaultModelId ? { defaultModelId } : {}),
    models
  } as unknown as AgentRuntimeModelCatalog
}

const builtIns = catalogOf(
  [
    {
      id: 'runtime-default',
      displayName: 'Runtime Default',
      isDefault: true,
      inputModalities: ['text'],
      reasoningEfforts: [
        { id: 'medium', isDefault: true },
        { id: 'high', isDefault: false }
      ],
      serviceTiers: [{ id: 'flex', displayName: 'Flex', isDefault: false }]
    },
    {
      id: 'plain-model',
      displayName: 'Plain',
      isDefault: false,
      inputModalities: ['text'],
      reasoningEfforts: [],
      serviceTiers: []
    }
  ],
  'runtime-default'
)

const unavailable = { available: false, complete: false, models: [] } as unknown as AgentRuntimeModelCatalog

describe('composer runtime options contract', () => {
  it('unavailable or missing catalog yields no options, and explicit choices pass through', () => {
    expect(composerModelControlOptions('runtime-default', undefined)).toEqual({
      reasoningEfforts: [],
      serviceTiers: []
    })
    expect(composerModelControlOptions('runtime-default', unavailable)).toEqual({
      reasoningEfforts: [],
      serviceTiers: []
    })
    expect(
      supportedComposerTurnSettings(
        { model: 'runtime-default', reasoningEffort: 'high', serviceTier: 'flex' },
        undefined
      )
    ).toEqual({ model: 'runtime-default', reasoningEffort: 'high', serviceTier: 'flex' })
  })

  it('a catalog-known model is limited to its declared lists; an explicit empty list sends nothing', () => {
    expect(
      supportedComposerTurnSettings(
        { model: 'plain-model', reasoningEffort: 'high', serviceTier: 'flex' },
        builtIns
      )
    ).toEqual({ model: 'plain-model' })
    expect(
      supportedComposerTurnSettings(
        { model: 'runtime-default', reasoningEffort: 'high', serviceTier: 'flex' },
        builtIns
      )
    ).toEqual({ model: 'runtime-default', reasoningEffort: 'high', serviceTier: 'flex' })
    expect(
      supportedComposerTurnSettings(
        { model: 'runtime-default', reasoningEffort: 'ultra', serviceTier: 'unknown-tier' },
        builtIns
      )
    ).toEqual({ model: 'runtime-default' })
  })

  it('a provider-routed model outside the catalog keeps its explicit choice (unknown ≠ drop)', () => {
    expect(
      supportedComposerTurnSettings(
        { model: 'sciforge-router', reasoningEffort: 'xhigh', serviceTier: 'priority' },
        builtIns
      )
    ).toEqual({ model: 'sciforge-router', reasoningEffort: 'xhigh', serviceTier: 'priority' })
  })

  it('keeps provider-owned explicit levels when the runtime catalog contains the managed alias', () => {
    const catalog = catalogOf([{
      id: 'sciforge-router', displayName: 'Router', isDefault: true,
      inputModalities: ['text'], reasoningEfforts: [], serviceTiers: []
    }], 'sciforge-router')
    for (const model of ['', 'sciforge-router']) {
      expect(supportedComposerTurnSettings({
        model, reasoningEffort: 'high', serviceTier: 'priority'
      }, catalog, { providerManaged: true })).toEqual({
        ...(model ? { model } : {}), reasoningEffort: 'high', serviceTier: 'priority'
      })
    }
  })

  it('model ids come from the catalog only when it is actually available', () => {
    expect(composerRuntimeModelIds(builtIns, ['fallback'])).toEqual(['runtime-default', 'plain-model'])
    expect(composerRuntimeModelIds(undefined, ['fallback', 'fallback', ''])).toEqual(['fallback'])
  })

  it('applies the runtime half of the turn-control intersection', () => {
    const levels = [{ id: '' }, { id: 'high' }, { id: 'off' }, { id: 'disabled' }]
    // codex/claude both transmit an explicit off; dsh has no reasoning channel.
    expect(
      filterReasoningOptionsForRuntime(levels, AGENT_RUNTIME_TURN_CONTROLS.codex).map(({ id }) => id)
    ).toEqual(['', 'high', 'off', 'disabled'])
    expect(
      filterReasoningOptionsForRuntime(levels, AGENT_RUNTIME_TURN_CONTROLS.claude).map(({ id }) => id)
    ).toEqual(['', 'high', 'off', 'disabled'])
    expect(filterReasoningOptionsForRuntime(levels, AGENT_RUNTIME_TURN_CONTROLS.dsh)).toEqual([])
    // A reasoning-capable runtime that cannot express off keeps only real levels.
    expect(
      filterReasoningOptionsForRuntime(levels, {
        ...AGENT_RUNTIME_TURN_CONTROLS.dsh,
        reasoningLevel: 'turn'
      }).map(({ id }) => id)
    ).toEqual(['', 'high'])
    expect(runtimeTransfersServiceTier(AGENT_RUNTIME_TURN_CONTROLS.codex)).toBe(true)
    expect(runtimeTransfersServiceTier(AGENT_RUNTIME_TURN_CONTROLS.claude)).toBe(false)
    expect(runtimeTransfersServiceTier(AGENT_RUNTIME_TURN_CONTROLS.dsh)).toBe(false)
  })
})
