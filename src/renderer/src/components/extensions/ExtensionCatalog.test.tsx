import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { installedDomainPackages } from '@shared/installed-domain-packages'
import {
  ExtensionCatalog,
  extensionCatalogItemsFromDefinitions,
  extensionCatalogItemsFromSummaries
} from './ExtensionCatalog'

describe('extensionCatalogItemsFromDefinitions', () => {
  it('projects every generated installed domain package without inventing marketplace state', () => {
    const items = extensionCatalogItemsFromDefinitions(installedDomainPackages.definitions)

    expect(items).toHaveLength(installedDomainPackages.definitions.length)
    expect(items.map((item) => item.packageName)).toEqual(
      installedDomainPackages.definitions.map((definition) => definition.packageName)
    )
    expect(items.every((item) => item.source === 'bundled')).toBe(true)
    expect(items.every((item) => item.official)).toBe(true)
    expect(items.every((item) => item.publisher === 'SciForge')).toBe(true)
  })

  it('derives version and contribution summaries from the canonical definitions', () => {
    const definition = installedDomainPackages.definitions.find(
      (candidate) => candidate.module.id === 'sciforge.browser-preview'
    )
    expect(definition).toBeDefined()

    const [item] = extensionCatalogItemsFromDefinitions([definition!])

    expect(item).toEqual(expect.objectContaining({
      id: 'sciforge.browser-preview',
      displayName: 'Browser Preview',
      packageName: '@sciforge/domain-browser-preview',
      version: definition!.module.version,
      contributionCount: definition!.entrypoints.reduce(
        (count, entrypoint) => count + entrypoint.contributions.length,
        0
      )
    }))
    expect(item.contributionKinds).toContain('main.capability-factory')
    expect(item.contributionKinds).toContain('renderer.workbench-right-panel')
  })

  it('projects host-verified installed state without trusting renderer-invented metadata', () => {
    const [item] = extensionCatalogItemsFromSummaries([{
      packageName: '@sciforge/domain-runtime',
      moduleId: 'sciforge.runtime',
      moduleDisplayName: 'Runtime',
      version: '1.2.0',
      publisher: { id: 'sciforge', displayName: 'SciForge' },
      source: 'user',
      verification: 'official-signed',
      execution: 'sandboxed-runtime',
      status: 'installed',
      permissions: ['host.workspace.read'],
      contributionKinds: ['main.capability-factory'],
      contributionCount: 3,
      canRollback: true,
      installedAt: '2026-07-27T00:00:00.000Z'
    }])

    expect(item).toEqual(expect.objectContaining({
      packageName: '@sciforge/domain-runtime',
      source: 'user',
      official: true,
      status: 'installed',
      contributionCount: 3,
      canRollback: true
    }))
  })

  it('accepts a runtime status provider without presenting fake extension actions', async () => {
    const [extension] = extensionCatalogItemsFromDefinitions(
      installedDomainPackages.definitions.slice(0, 1)
    )
    const i18n = i18next.createInstance()
    await i18n.init({
      lng: 'en',
      resources: {
        en: {
          common: {
            extensionOfficial: 'Official',
            extensionBundled: 'Bundled',
            extensionPublisher: 'Publisher',
            extensionVersion: 'Version',
            extensionSource: 'Source',
            extensionBundledSource: 'SciForge application bundle',
            extensionStatusActive: 'Active',
            extensionContributes: '{{count}} contributions',
            extensionTrustTitle: 'Official extensions',
            extensionTrustBody: 'Bundled with SciForge.',
            extensionSearch: 'Search extensions',
            extensionInstalledTitle: 'Known extensions',
            extensionCount: '{{count}} extensions',
            extensionNoResults: 'No matching extensions.'
          }
        }
      }
    })

    const html = renderToStaticMarkup(createElement(
      I18nextProvider,
      { i18n },
      createElement(ExtensionCatalog, {
        extensions: [extension],
        statusProvider: () => ({ label: 'Runtime ready', tone: 'success' as const })
      })
    ))

    expect(html).toContain('Runtime ready')
    expect(html).toContain('Official')
    expect(html).toContain('Bundled')
    expect(html).not.toContain('<button')
  })
})
