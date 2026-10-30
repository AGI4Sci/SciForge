import { describe, expect, it } from 'vitest'
import type { AgentRuntimeModelCatalog } from '@shared/agent-runtime-contract'
import {
  composerModelControlOptions,
  composerRuntimeModelIds,
  composerRuntimeSectionState,
  supportedComposerTurnSettings
} from './FloatingComposerModelPicker'
import { storedReasoningEffortReset } from '../../lib/composer-runtime-options'

const catalog: AgentRuntimeModelCatalog = {
  available: true,
  complete: true,
  defaultModelId: 'runtime-alpha',
  models: [{
    id: 'runtime-alpha',
    displayName: 'Runtime Alpha',
    isDefault: true,
    inputModalities: ['text'],
    reasoningEfforts: [
      { id: 'balanced', description: 'Balanced', isDefault: true },
      { id: 'ultra', description: 'Deep', isDefault: false }
    ],
    serviceTiers: [
      { id: 'priority', displayName: 'Fast', description: 'Fast queue', isDefault: false }
    ],
    defaultServiceTierId: 'default'
  }, {
    id: 'runtime-beta',
    displayName: 'Runtime Beta',
    isDefault: false,
    inputModalities: ['text'],
    reasoningEfforts: [{ id: 'brief', isDefault: true }],
    serviceTiers: []
  }]
}

describe('FloatingComposerModelPicker runtime capabilities', () => {
  it('uses runtime-discovered model ids instead of the global router list', () => {
    expect(composerRuntimeModelIds(catalog, ['global-router-model'])).toEqual([
      'runtime-alpha', 'runtime-beta'
    ])
  })

  it('derives reasoning and service-tier choices from the selected runtime model', () => {
    expect(composerModelControlOptions('runtime-alpha', catalog)).toEqual({
      reasoningEfforts: catalog.models[0]?.reasoningEfforts,
      serviceTiers: [
        ...(catalog.models[0]?.serviceTiers ?? []),
        { id: 'default', displayName: 'default', isDefault: true }
      ]
    })
    expect(composerModelControlOptions('runtime-beta', catalog)).toEqual({
      reasoningEfforts: catalog.models[1]?.reasoningEfforts,
      serviceTiers: []
    })
  })

  it('uses the discovered default model for an empty Codex/Profile fallback', () => {
    expect(composerModelControlOptions('', catalog).reasoningEfforts.map(({ id }) => id)).toEqual([
      'balanced', 'ultra'
    ])
  })

  it('uses the runtime-owned model declared reasoning and service tiers', () => {
    expect(supportedComposerTurnSettings({
      model: 'runtime-beta',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    }, catalog)).toEqual({ model: 'runtime-beta' })
    expect(supportedComposerTurnSettings({
      model: 'runtime-beta', reasoningEffort: '', serviceTier: 'priority'
    }, catalog)).toEqual({ model: 'runtime-beta' })
    expect(supportedComposerTurnSettings({
      model: '',
      reasoningEffort: 'ultra',
      serviceTier: 'default'
    }, catalog)).toEqual({ reasoningEffort: 'ultra', serviceTier: 'default' })
  })

  it('resets a stored effort the model does not declare to its default or the upstream default', () => {
    expect(storedReasoningEffortReset({ model: 'runtime-beta', reasoningEffort: 'ultra' }, catalog))
      .toEqual({ from: 'ultra', to: 'brief' })
    const undeclared: AgentRuntimeModelCatalog = {
      ...catalog,
      models: [{ ...catalog.models[1]!, reasoningEfforts: [] }]
    }
    expect(storedReasoningEffortReset({ model: 'runtime-beta', reasoningEffort: 'medium' }, undeclared))
      .toEqual({ from: 'medium', to: '' })
  })

  it('keeps a declared stored effort and leaves unknown catalogs untouched', () => {
    expect(storedReasoningEffortReset({ model: '', reasoningEffort: 'ultra' }, catalog)).toBeNull()
    expect(storedReasoningEffortReset({ model: 'runtime-beta', reasoningEffort: '' }, catalog)).toBeNull()
    expect(storedReasoningEffortReset({ model: 'runtime-beta', reasoningEffort: 'medium' }, null)).toBeNull()
  })

  it('preserves legacy model and reasoning overrides when discovery is unavailable', () => {
    // With no catalog at all there is nothing to validate against — an explicit
    // choice (level AND tier) passes through instead of being silently dropped.
    expect(supportedComposerTurnSettings({
      model: 'stale-model',
      reasoningEffort: 'stale-effort',
      serviceTier: 'stale-tier'
    }, null)).toEqual({
      model: 'stale-model',
      reasoningEffort: 'stale-effort',
      serviceTier: 'stale-tier'
    })
  })
})

describe('FloatingComposerModelPicker execution-environment section', () => {
  it('offers every runtime while the session is unbound', () => {
    expect(
      composerRuntimeSectionState({ currentRuntime: 'codex', runtimeLocked: false, runtimeSessionLocked: false })
    ).toEqual({ interactive: true, visibleRuntimeIds: ['codex', 'claude', 'dsh'], noteKey: null })
  })

  it('collapses to a read-only bound runtime once the session is locked', () => {
    expect(
      composerRuntimeSectionState({ currentRuntime: 'claude', runtimeLocked: false, runtimeSessionLocked: true })
    ).toEqual({ interactive: false, visibleRuntimeIds: ['claude'], noteKey: 'composerRuntimeSessionLocked' })
  })

  it('keeps the Codex-plan lock as a note instead of an interactive switch', () => {
    expect(
      composerRuntimeSectionState({ currentRuntime: 'codex', runtimeLocked: true, runtimeSessionLocked: false })
    ).toEqual({ interactive: false, visibleRuntimeIds: ['codex', 'claude', 'dsh'], noteKey: 'composerRuntimeCodexPlanLocked' })
  })
})
