import { describe, expect, it } from 'vitest'
import { effectiveTurnOptions } from './runtime-effective-turn-options'

describe('effective runtime turn options', () => {
  const options = { model: 'inherited', reasoningEffort: 'medium', serviceTier: 'fast', mode: 'agent',
    text: 'correction', displayText: 'visible', attachmentIds: ['image'], fileReferences: ['ref'],
    permissionLevel: 'restricted', allowedTools: [], governanceProfile: 'governed', workspaceLocator: { id: 'workspace' } }

  it('removes only inherited DSH hints without mutating the input', () => {
    const snapshot = structuredClone(options)
    const { model: _model, reasoningEffort: _reasoning, serviceTier: _tier, mode: _mode, ...rest } = options
    expect(effectiveTurnOptions('dsh', options)).toEqual(rest)
    expect(options).toEqual(snapshot)
    expect(effectiveTurnOptions('dsh', { ...options, mode: 'plan' }).mode).toBe('plan')
  })

  it('preserves Codex/Pi options and removes only Claude model', () => {
    expect(effectiveTurnOptions('codex', options)).toEqual(options)
    expect(effectiveTurnOptions('pi', options)).toEqual(options)
    const { model: _model, ...rest } = options
    expect(effectiveTurnOptions('claude', options)).toEqual(rest)
  })
})
