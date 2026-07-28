import { describe, expect, it } from 'vitest'
import {
  ComposerContextProviderRegistry
} from './composer-context-provider-registry'

describe('ComposerContextProviderRegistry', () => {
  it('registers owner-aware providers and validates bounded results', async () => {
    const registry = new ComposerContextProviderRegistry()
    registry.register({
      id: 'fixture.composer-context',
      ownerId: 'fixture.module',
      contract: {
        location: 'composer.context',
        label: 'Fixture context'
      },
      value: {
        provide: () => ({
          items: [{
            id: 'fixture.selected-item',
            title: 'Selected item',
            content: 'Review this item.'
          }]
        })
      }
    })

    const provider = registry.resolve('fixture.composer-context')
    expect(provider).toMatchObject({
      id: 'fixture.composer-context',
      ownerId: 'fixture.module',
      contribution: {
        location: 'composer.context',
        label: 'Fixture context'
      }
    })
    await expect(provider?.contribution.provide({
      sessionId: 'session-1',
      draftText: 'Draft',
      signal: new AbortController().signal
    })).resolves.toEqual({
      items: [{
        id: 'fixture.selected-item',
        title: 'Selected item',
        content: 'Review this item.'
      }]
    })
  })

  it('fails closed when a provider returns an invalid or oversized result', async () => {
    const registry = new ComposerContextProviderRegistry()
    registry.register({
      id: 'fixture.composer-context',
      ownerId: 'fixture.module',
      contract: {
        location: 'composer.context',
        label: 'Fixture context'
      },
      value: {
        provide: () => ({
          items: [{
            id: 'fixture.selected-item',
            title: 'Selected item',
            content: 'x'.repeat(200_001)
          }]
        })
      }
    })

    await expect(registry.resolve('fixture.composer-context')?.contribution.provide({
      draftText: '',
      signal: new AbortController().signal
    })).rejects.toThrow()
  })

  it('rejects duplicate IDs and disposes idempotently', () => {
    const registry = new ComposerContextProviderRegistry()
    const contribution = {
      id: 'fixture.composer-context',
      ownerId: 'fixture.module',
      contract: {
        location: 'composer.context' as const,
        label: 'Fixture context'
      },
      value: { provide: () => ({ items: [] }) }
    }
    registry.register(contribution)
    expect(() => registry.register({
      ...contribution,
      ownerId: 'other.module'
    })).toThrow('Duplicate renderer contribution "fixture.composer-context"')

    registry.dispose()
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
