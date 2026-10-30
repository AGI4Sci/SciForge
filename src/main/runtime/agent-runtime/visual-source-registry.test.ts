import { describe, expect, it } from 'vitest'

import {
  VISUAL_SOURCE_CONTRACT_VERSION,
  type VisualFrame,
  type VisualSourceProviderInput
} from '@sciforge/domain-sdk/visual-source'
import {
  VisualSourceRegistry,
  VisualSourceRegistryError
} from './visual-source-registry'

function provider(
  id: string,
  resourceKinds: readonly string[]
): VisualSourceProviderInput {
  return {
    contract: {
      contractVersion: VISUAL_SOURCE_CONTRACT_VERSION,
      id,
      resourceKinds: [...resourceKinds]
    },
    render: async (request): Promise<VisualFrame> => ({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sourceRevision: request.resource.semanticRevision,
      anchor: { kind: 'resource' }
    })
  }
}

describe('VisualSourceRegistry', () => {
  it('resolves providers by exact resource kind and lists ownership deterministically', () => {
    const workspace = provider('fixture.workspace-visual', [
      'workspace-preview',
      'workspace-image'
    ])
    const browser = provider('fixture.browser-visual', ['browser-page'])
    const registry = new VisualSourceRegistry([
      { ownerId: 'module-z', provider: workspace },
      { ownerId: 'module-a', provider: browser }
    ])

    expect(registry.resolve('workspace-preview')?.contract.id)
      .toBe('fixture.workspace-visual')
    expect(registry.resolve(' workspace-image ')?.contract.id)
      .toBe('fixture.workspace-visual')
    expect(registry.resolve('workspace')).toBeUndefined()
    expect(registry.resolve('')).toBeUndefined()
    expect(registry.list().map(({ ownerId, provider: entry }) =>
      `${ownerId}:${entry.contract.id}`
    )).toEqual([
      'module-a:fixture.browser-visual',
      'module-z:fixture.workspace-visual'
    ])
    expect(Object.isFrozen(registry.list())).toBe(true)
    expect(Object.isFrozen(registry.list()[0])).toBe(true)
  })

  it('rejects duplicate resource kinds atomically without priority fallback', () => {
    const original = provider('fixture.original-visual', ['workspace-preview'])
    const registry = new VisualSourceRegistry([
      { ownerId: 'module-original', provider: original }
    ])

    expect(() => registry.registerMany([
      {
        ownerId: 'module-new',
        provider: provider('fixture.new-visual', ['new-resource'])
      },
      {
        ownerId: 'module-conflict',
        provider: provider('fixture.conflicting-visual', ['workspace-preview'])
      }
    ])).toThrowError(expect.objectContaining<Partial<VisualSourceRegistryError>>({
      code: 'duplicate_resource_kind'
    }))
    expect(registry.resolve('workspace-preview')?.contract.id)
      .toBe('fixture.original-visual')
    expect(registry.resolve('new-resource')).toBeUndefined()
    expect(registry.list().map(({ provider: entry }) => entry.contract.id))
      .toEqual(['fixture.original-visual'])
  })

  it('rejects duplicate kinds inside one batch before making either provider visible', () => {
    const registry = new VisualSourceRegistry()

    expect(() => registry.registerMany([
      {
        ownerId: 'module-first',
        provider: provider('fixture.first-visual', ['shared-resource'])
      },
      {
        ownerId: 'module-second',
        provider: provider('fixture.second-visual', ['shared-resource'])
      }
    ])).toThrow('Visual source resource kind shared-resource is already owned by fixture.first-visual.')
    expect(registry.resolve('shared-resource')).toBeUndefined()
    expect(registry.list()).toEqual([])
  })

  it('rejects duplicate provider identities even when their resource kinds differ', () => {
    const registry = new VisualSourceRegistry([
      {
        ownerId: 'module-first',
        provider: provider('fixture.same-visual', ['resource-a'])
      }
    ])

    expect(() => registry.register(
      'module-second',
      provider('fixture.same-visual', ['resource-b'])
    )).toThrowError(expect.objectContaining<Partial<VisualSourceRegistryError>>({
      code: 'duplicate_provider'
    }))
    expect(registry.resolve('resource-a')?.contract.id).toBe('fixture.same-visual')
    expect(registry.resolve('resource-b')).toBeUndefined()
  })

  it('disposes registration batches idempotently and permits exact re-registration', () => {
    const registry = new VisualSourceRegistry()
    const registration = registry.register(
      'module-domain',
      provider('fixture.domain-visual', ['domain-resource'])
    )

    registration.dispose()
    registration.dispose()
    expect(registry.resolve('domain-resource')).toBeUndefined()
    expect(registry.list()).toEqual([])

    const replacement = registry.register(
      'module-replacement',
      provider('fixture.domain-visual', ['domain-resource'])
    )
    registration.dispose()
    expect(registry.resolve('domain-resource')?.contract.id)
      .toBe('fixture.domain-visual')

    replacement.dispose()
    expect(registry.resolve('domain-resource')).toBeUndefined()
  })

  it('fails closed on invalid owner and provider contracts', () => {
    const registry = new VisualSourceRegistry()

    expect(() => registry.register(
      '   ',
      provider('fixture.invalid-owner', ['resource-a'])
    )).toThrowError(expect.objectContaining<Partial<VisualSourceRegistryError>>({
      code: 'invalid_owner'
    }))
    expect(() => registry.register(
      'module-invalid',
      provider('fixture.invalid-provider', ['resource-a', 'resource-a'])
    )).toThrow(/resource kind resource-a is duplicated/)
    expect(registry.list()).toEqual([])
  })
})
