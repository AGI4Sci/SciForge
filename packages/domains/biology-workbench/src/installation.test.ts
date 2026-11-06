import type { DomainMainHost, DomainRendererHost } from '@sciforge/domain-sdk/host'
import { defineInstalledDomainPackageSet } from '@sciforge/domain-sdk'
import { defineInstalledMainDomainEntrySet } from '@sciforge/domain-sdk/main'
import { defineInstalledRendererDomainEntrySet } from '@sciforge/domain-sdk/renderer'
import {
  defineInstalledWorkspaceServerDomainEntrySet,
  type DomainWorkspaceServerHost
} from '@sciforge/domain-sdk/workspace-server'
import { describe, expect, it, vi } from 'vitest'
import { domainPackageDefinition } from './definition'
import { BIOLOGY_ROOM_CAPABILITY_IDS } from './workbench/contract.js'
import { createDomainMainEntry } from './main'
import { createDomainRendererEntry } from './preview/renderer/index'
import { createDomainWorkspaceServerEntry } from './preview/workspace-server/index'

const mainHost = {
  getUserDataDir: () => '/tmp/sciforge-life-science-preview-test',
  defineCapability: (value: unknown) => value
} satisfies DomainMainHost

const rendererHost = {
  capabilityInvoker: { invoke: vi.fn() },
  openExternal: vi.fn()
} as unknown as DomainRendererHost

const workspaceServerHost = {
  log: () => undefined
} satisfies DomainWorkspaceServerHost

describe('Life Science Preview installation boundary', () => {
  it('adds and removes local/remote providers, renderers, and lifecycle as one package', () => {
    const installed = defineInstalledDomainPackageSet([domainPackageDefinition])
    const main = defineInstalledMainDomainEntrySet(
      installed,
      [createDomainMainEntry(mainHost)]
    )
    const renderer = defineInstalledRendererDomainEntrySet(
      installed,
      [createDomainRendererEntry(rendererHost)]
    )
    const workspaceServer = defineInstalledWorkspaceServerDomainEntrySet(
      installed,
      [createDomainWorkspaceServerEntry(workspaceServerHost)]
    )
    const removed = defineInstalledDomainPackageSet([])

    expect(main.contributions).toHaveLength(8)
    const previewMain = main.contributions.filter((contribution) =>
      contribution.declaration.kind === 'main.workspace-preview-plugin'
    )
    expect(previewMain).toHaveLength(6)
    expect(previewMain.every((contribution) =>
      typeof (contribution.value as { provider?: { observe?: unknown } }).provider?.observe === 'function'
    )).toBe(true)

    const capabilityFactories = main.contributions.filter((contribution) =>
      contribution.declaration.kind === 'main.capability-factory'
    )
    expect(capabilityFactories).toHaveLength(1)
    expect(capabilityFactories[0]!.declaration.id).toBe('biology-room.capabilities')
    const factory = capabilityFactories[0]!.value as {
      createDefinitions: () => ReadonlyArray<{ id: string }>
    }
    expect(factory.createDefinitions().map(({ id }) => id).sort())
      .toEqual(Object.values(BIOLOGY_ROOM_CAPABILITY_IDS).sort())
    expect(main.contributions.filter((contribution) =>
      contribution.declaration.kind === 'main.capability-eval'
    )).toHaveLength(1)
    expect(renderer.contributions.filter((contribution) =>
      contribution.declaration.kind === 'renderer.workspace-preview-plugin'
    )).toHaveLength(6)
    expect(renderer.contributions.filter((contribution) =>
      contribution.declaration.kind === 'renderer.lifecycle'
    )).toHaveLength(1)
    expect(workspaceServer.contributions).toHaveLength(6)
    expect(workspaceServer.contributions.every((contribution) =>
      contribution.declaration.kind === 'workspace-server.workspace-preview-plugin' &&
      typeof (contribution.value as { provider?: { observe?: unknown } }).provider?.observe === 'function'
    )).toBe(true)

    expect(defineInstalledMainDomainEntrySet(removed, []).contributions).toEqual([])
    expect(defineInstalledRendererDomainEntrySet(removed, []).contributions).toEqual([])
    expect(defineInstalledWorkspaceServerDomainEntrySet(removed, []).contributions).toEqual([])
  })
})
