import type { DomainMainHost, DomainRendererHost } from '@sciforge/domain-sdk/host'
import { defineInstalledDomainPackageSet } from '@sciforge/domain-sdk'
import { defineInstalledMainDomainEntrySet } from '@sciforge/domain-sdk/main'
import { defineInstalledRendererDomainEntrySet } from '@sciforge/domain-sdk/renderer'
import { describe, expect, it, vi } from 'vitest'
import { domainPackageDefinition } from './definition'
import { createDomainMainEntry } from './main'
import { createDomainRendererEntry } from './renderer'

const mainHost = {
  getUserDataDir: () => '/tmp/sciforge-life-science-preview-test',
  defineCapability: (value: unknown) => value
} satisfies DomainMainHost

const rendererHost = {
  capabilityInvoker: { invoke: vi.fn() },
  openExternal: vi.fn()
} as unknown as DomainRendererHost

describe('Life Science Preview installation boundary', () => {
  it('adds and removes manifests, providers, renderers, and lifecycle as one package', () => {
    const installed = defineInstalledDomainPackageSet([domainPackageDefinition])
    const main = defineInstalledMainDomainEntrySet(
      installed,
      [createDomainMainEntry(mainHost)]
    )
    const renderer = defineInstalledRendererDomainEntrySet(
      installed,
      [createDomainRendererEntry(rendererHost)]
    )
    const removed = defineInstalledDomainPackageSet([])

    expect(main.contributions).toHaveLength(6)
    expect(main.contributions.every((contribution) =>
      contribution.declaration.kind === 'main.workspace-preview-plugin' &&
      typeof (contribution.value as { provider?: { observe?: unknown } }).provider?.observe === 'function'
    )).toBe(true)
    expect(renderer.contributions.filter((contribution) =>
      contribution.declaration.kind === 'renderer.workspace-preview-plugin'
    )).toHaveLength(6)
    expect(renderer.contributions.filter((contribution) =>
      contribution.declaration.kind === 'renderer.lifecycle'
    )).toHaveLength(1)

    expect(defineInstalledMainDomainEntrySet(removed, []).contributions).toEqual([])
    expect(defineInstalledRendererDomainEntrySet(removed, []).contributions).toEqual([])
  })
})
