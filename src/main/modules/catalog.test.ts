import { DOMAIN_PACKAGE_CONTRACT_VERSION, type TrustedDomainPackageDefinitionInput } from '@sciforge/domain-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  DomainModuleCatalog,
  DomainModuleCatalogError,
  type DomainContributionRuntimeGuard,
  type MainDomainModuleDefinition
} from './catalog'

const isString: DomainContributionRuntimeGuard<string> = (value): value is string => typeof value === 'string'
const acceptsUnknown: DomainContributionRuntimeGuard<unknown> = (_value): _value is unknown => true

type TestContribution = Readonly<{
  id: string
  kind: string
  value: unknown
  priority?: number
  onDispose?: () => void
}>

function moduleDefinition(
  id: string,
  contributions: readonly TestContribution[] = [],
  moduleOverrides: Partial<TrustedDomainPackageDefinitionInput['module']> = {},
  onDispose?: () => void
): MainDomainModuleDefinition {
  const segment = id.split('.').at(-1)!
  const registeredContributions: readonly TestContribution[] = onDispose
    ? [{ id: `${id}.lifecycle`, kind: 'main.lifecycle', value: null, onDispose }, ...contributions]
    : contributions
  return {
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time',
      packageName: `@fixture/${segment}`,
      module: {
        id,
        displayName: id,
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 100,
        ...moduleOverrides
      },
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: registeredContributions.map(({ id: contributionId, kind, priority }) => ({
          id: contributionId,
          kind,
          priority
        }))
      }]
    },
    contributions: registeredContributions.map(({ id: contributionId, kind, value, onDispose: dispose }) => ({
      id: contributionId,
      kind,
      value,
      ...(dispose ? { onDispose: dispose } : {})
    }))
  }
}

function errorCode(callback: () => unknown): string | undefined {
  try {
    callback()
    return undefined
  } catch (error) {
    return error instanceof DomainModuleCatalogError ? error.code : undefined
  }
}

describe('DomainModuleCatalog', () => {
  it('accepts an inclusive minimum and exclusive maximum host API range', () => {
    const minimumHost = new DomainModuleCatalog({ hostApiVersion: '1.0.0' })
    minimumHost.registerModule(moduleDefinition('sciforge.minimum'))
    expect(minimumHost.hasModule('sciforge.minimum')).toBe(true)

    const belowMinimum = new DomainModuleCatalog({ hostApiVersion: '0.9.9' })
    expect(errorCode(() => belowMinimum.registerModule(moduleDefinition('sciforge.too-new'))))
      .toBe('incompatible_host_api')

    const maximumHost = new DomainModuleCatalog({ hostApiVersion: '2.0.0' })
    expect(errorCode(() => maximumHost.registerModule(moduleDefinition('sciforge.too-old'))))
      .toBe('incompatible_host_api')
  })

  it('rejects duplicate package, module, and contribution identities', () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(moduleDefinition('sciforge.one', [
      { id: 'panel.shared', kind: 'renderer.view', value: 'one' }
    ]))

    expect(errorCode(() => catalog.registerModule(moduleDefinition('sciforge.one'))))
      .toBe('duplicate_package')
    const duplicateModule = moduleDefinition('sciforge.one')
    duplicateModule.definition.packageName = '@fixture/other'
    expect(errorCode(() => catalog.registerModule(duplicateModule))).toBe('duplicate_module')
    expect(errorCode(() => catalog.registerModule(moduleDefinition('sciforge.two', [
      { id: 'panel.shared', kind: 'renderer.view', value: 'two' }
    ]))))
      .toBe('duplicate_contribution')

    catalog.registerModule(moduleDefinition('sciforge.three', [
      { id: 'panel.shared', kind: 'main.provider', value: 'three' }
    ]))
    expect(catalog.listContributions('main.provider', isString)[0]?.value).toBe('three')
  })

  it('validates an entire batch before committing any module or contribution', () => {
    const catalog = new DomainModuleCatalog()
    const stagedDisposer = vi.fn()
    catalog.registerModule(moduleDefinition('sciforge.existing', [
      { id: 'provider.existing', kind: 'main.provider', value: 'existing' }
    ]))

    expect(errorCode(() => catalog.registerBatch([
      moduleDefinition('sciforge.valid', [
        { id: 'provider.valid', kind: 'main.provider', value: 'valid', onDispose: stagedDisposer }
      ]),
      moduleDefinition('sciforge.invalid', [
        { id: 'provider.existing', kind: 'main.provider', value: 'duplicate' }
      ])
    ]))).toBe('duplicate_contribution')

    expect(catalog.hasModule('sciforge.valid')).toBe(false)
    expect(catalog.hasModule('sciforge.invalid')).toBe(false)
    expect(catalog.listContributions('main.provider', isString).map(({ declaration }) => declaration.id))
      .not.toContain('provider.valid')
    expect(stagedDisposer).not.toHaveBeenCalled()
    expect(catalog.listModules().map((entry) => entry.id)).toEqual(['sciforge.existing'])
  })

  it('requires runtime values to exactly match package declarations', () => {
    const catalog = new DomainModuleCatalog()
    const definition = moduleDefinition('sciforge.mismatch', [
      { id: 'provider.expected', kind: 'main.provider', value: 'value' }
    ])
    const mismatched = { ...definition, contributions: [] }

    expect(errorCode(() => catalog.registerModule(mismatched))).toBe('invalid_contribution')
    expect(catalog.hasModule('sciforge.mismatch')).toBe(false)
  })

  it('orders modules and contributions deterministically without using registration order', () => {
    const definitions = [
      moduleDefinition('sciforge.zulu', [
        { id: 'view.low', kind: 'renderer.view', priority: 10, value: 'low' },
        { id: 'view.zulu', kind: 'renderer.view', priority: 20, value: 'zulu' }
      ], { priority: 100 }),
      moduleDefinition('sciforge.alpha', [
        { id: 'view.alpha', kind: 'renderer.view', priority: 20, value: 'alpha' }
      ], { priority: 200 })
    ]
    const first = new DomainModuleCatalog()
    first.registerBatch(definitions)
    const second = new DomainModuleCatalog()
    second.registerBatch([...definitions].reverse())

    const snapshot = (catalog: DomainModuleCatalog) => ({
      modules: catalog.listModules().map((entry) => entry.id),
      contributions: catalog.listContributions('renderer.view', isString).map((entry) =>
        `${entry.owner.moduleId}:${entry.declaration.id}`
      )
    })
    expect(snapshot(first)).toEqual(snapshot(second))
    expect(snapshot(first)).toEqual({
      modules: ['sciforge.alpha', 'sciforge.zulu'],
      contributions: [
        'sciforge.alpha:view.alpha',
        'sciforge.zulu:view.zulu',
        'sciforge.zulu:view.low'
      ]
    })
  })

  it('adds immutable SDK owner metadata and disposes contributions in reverse declaration order', () => {
    const disposalOrder: string[] = []
    const catalog = new DomainModuleCatalog()
    const registration = catalog.registerModule(moduleDefinition(
      'sciforge.disposable',
      [
        { id: 'view.first', kind: 'renderer.view', value: 'first', onDispose: () => disposalOrder.push('first') },
        { id: 'view.second', kind: 'renderer.view', value: 'second', onDispose: () => disposalOrder.push('second') }
      ],
      { version: '1.4.0' },
      () => disposalOrder.push('module')
    ))

    const contribution = catalog.listContributions('renderer.view', isString)
      .find(({ declaration }) => declaration.id === 'view.first')
    expect(contribution?.owner).toEqual({
      moduleId: 'sciforge.disposable',
      moduleVersion: '1.4.0'
    })
    expect(Object.isFrozen(contribution?.owner)).toBe(true)

    registration.dispose()
    registration.dispose()
    expect(registration.disposed).toBe(true)
    expect(disposalOrder).toEqual(['second', 'first', 'module'])
    expect(catalog.hasModule('sciforge.disposable')).toBe(false)
    expect(catalog.listContributions('renderer.view', acceptsUnknown)).toEqual([])
  })

  it('removes committed state even when a disposer fails and continues remaining disposal', () => {
    const finalDisposer = vi.fn()
    const catalog = new DomainModuleCatalog()
    const registration = catalog.registerModule(moduleDefinition('sciforge.failure', [
      { id: 'view.final', kind: 'renderer.view', value: null, onDispose: finalDisposer },
      { id: 'view.failure', kind: 'renderer.view', value: null, onDispose: () => { throw new Error('dispose failed') } }
    ]))

    expect(() => registration.dispose()).toThrow('dispose failed')
    expect(finalDisposer).toHaveBeenCalledOnce()
    expect(catalog.hasModule('sciforge.failure')).toBe(false)
    expect(catalog.listContributions('renderer.view', acceptsUnknown)).toEqual([])
  })

  it('disposes batches in reverse module order', () => {
    const disposalOrder: string[] = []
    const catalog = new DomainModuleCatalog()
    const batch = catalog.registerBatch([
      moduleDefinition('sciforge.first', [], {}, () => disposalOrder.push('first')),
      moduleDefinition('sciforge.second', [], {}, () => disposalOrder.push('second'))
    ])

    batch.dispose()
    batch.dispose()
    expect(batch.disposed).toBe(true)
    expect(disposalOrder).toEqual(['second', 'first'])
    expect(catalog.listModules()).toEqual([])
  })

  it('does not let a stale registration handle remove a replacement module', () => {
    const catalog = new DomainModuleCatalog()
    const staleRegistration = catalog.registerModule(moduleDefinition('sciforge.replaceable', [
      { id: 'view.original', kind: 'renderer.view', value: 'original' }
    ]))
    expect(catalog.unregisterModule('sciforge.replaceable')).toBe(true)

    catalog.registerModule(moduleDefinition('sciforge.replaceable', [
      { id: 'view.replacement', kind: 'renderer.view', value: 'replacement' }
    ]))
    staleRegistration.dispose()

    expect(catalog.hasModule('sciforge.replaceable')).toBe(true)
    expect(catalog.listContributions('renderer.view', isString)[0]?.value).toBe('replacement')
  })

  it('fails closed when a contribution value does not satisfy its runtime guard', () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(moduleDefinition('sciforge.invalid-value', [
      { id: 'provider.invalid-value', kind: 'main.provider', value: 42 }
    ]))

    expect(errorCode(() => catalog.listContributions('main.provider', isString)))
      .toBe('invalid_contribution_value')
  })
})
