import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  defineInstalledDomainPackageSet,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk'
import { defineInstalledRendererDomainEntrySet } from '@sciforge/domain-sdk/renderer'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewPluginManifestSchema
} from './shared/workspace-preview'
import { DomainModuleCatalog } from './main/modules/catalog'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  listMainWorkspacePreviewPluginContributions
} from './main/modules/workspace-preview-contributions'
import { composeWorkspacePreviewPlugins } from './main/services/workspace-preview/composition'
import { WorkspacePreviewHost } from './main/services/workspace-preview/host'
import { WorkspacePreviewWorkerClient } from './main/services/workspace-preview/worker-client'
import {
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from './renderer/src/domain-modules/workspace-preview-contributions'
import {
  createInstalledRendererContributions,
  type RendererTranslationHost
} from './renderer/src/domain-modules/installed-renderer-contributions'

vi.mock('./renderer/src/workspace-preview/PdfWorkspaceViewer', () => ({
  PdfWorkspaceViewer: () => null
}))

const fixtureManifest = workspacePreviewPluginManifestSchema.parse({
  contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
  id: 'fixture.preview-plugin',
  displayName: 'Fixture Preview',
  version: '1.0.0',
  modality: 'fixture.imaging',
  lifecycle: 'hybrid',
  priority: 900,
  extensions: ['.vtk'],
  mimeTypes: ['application/x-fixture'],
  capabilities: {
    preview: true,
    edit: true,
    inspect: true,
    structuredSelection: true,
    export: []
  }
})
const fixtureContributionId = 'fixture.domain-preview.workspace-preview'

const fixtureDefinition: TrustedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'trusted-compile-time',
  packageName: '@fixture/domain-preview',
  module: {
    id: 'fixture.domain-preview',
    displayName: 'Fixture Domain Preview',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    priority: 500
  },
  contributionContracts: {
    [fixtureContributionId]: fixtureManifest
  },
  entrypoints: [{
    process: 'main',
    export: './main',
    contributions: [{
      kind: MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      id: fixtureContributionId,
      priority: 500
    }]
  }, {
    process: 'renderer',
    export: './renderer',
    contributions: [{
      kind: RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      id: fixtureContributionId,
      priority: 500
    }]
  }]
}

const fixtureProvider = Object.freeze({
  pluginId: fixtureManifest.id,
  observe: async () => ({
    ok: false as const,
    message: 'fixture',
    reason: 'unsupported-format' as const
  }),
  applyEdit: async () => ({ ok: false as const, message: 'fixture' })
})

const fixtureRenderer = Object.freeze({
  manifest: fixtureManifest,
  render: () => createElement('div', { 'data-fixture-preview': 'true' })
})

describe('workspace preview domain package acceptance', () => {
  it('adds and removes main manifest/provider and renderer from one domain definition', () => {
    const catalog = new DomainModuleCatalog()
    const mainRegistration = catalog.registerModule({
      definition: fixtureDefinition,
      contributions: [{
        kind: MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: { manifest: fixtureManifest, provider: fixtureProvider }
      }]
    })
    const installed = defineInstalledDomainPackageSet([fixtureDefinition])
    const rendererEntrySet = defineInstalledRendererDomainEntrySet(installed, [{
      definition: fixtureDefinition,
      contributions: [{
        kind: RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: fixtureRenderer
      }]
    }])

    const mainPlugins = listMainWorkspacePreviewPluginContributions(catalog)
    const mainRuntime = composeWorkspacePreviewPlugins(mainPlugins)
    const rendererRuntime = createInstalledRendererContributions({
      entrySet: rendererEntrySet,
      translations: new NoopTranslationHost()
    })

    expect(mainRuntime.manifests.get(fixtureManifest.id)).toBeTruthy()
    expect(mainRuntime.providers.get(fixtureManifest.id)).toMatchObject({
      pluginId: fixtureManifest.id,
      observe: fixtureProvider.observe,
      applyEdit: fixtureProvider.applyEdit
    })
    expect(rendererRuntime.workspacePreviews.get(fixtureManifest.id)?.contribution)
      .toBe(fixtureRenderer)
    expect(mainRuntime.manifests.resolve({ path: 'mesh.vtk', fallbackToText: false }))
      .toMatchObject({ status: 'matched', manifest: { id: fixtureManifest.id } })
    expect(rendererRuntime.workspacePreviews.resolve({ path: 'mesh.vtk' })?.manifest.id)
      .toBe(fixtureManifest.id)

    mainRegistration.dispose()
    rendererRuntime.dispose()
    expect(listMainWorkspacePreviewPluginContributions(catalog)).toEqual([])
    expect(rendererRuntime.workspacePreviews.get(fixtureManifest.id)).toBeNull()
  })

  it('fails closed when either process entry omits a complete plugin value', () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule({
      definition: fixtureDefinition,
      contributions: [{
        kind: MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: { manifest: fixtureManifest }
      }]
    })
    expect(() => listMainWorkspacePreviewPluginContributions(catalog))
      .toThrow('failed runtime validation')

    const installed = defineInstalledDomainPackageSet([fixtureDefinition])
    const rendererEntrySet = defineInstalledRendererDomainEntrySet(installed, [{
      definition: fixtureDefinition,
      contributions: [{
        kind: RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: { manifest: fixtureManifest }
      }]
    }])
    const translations = new NoopTranslationHost()
    expect(() => createInstalledRendererContributions({ entrySet: rendererEntrySet, translations }))
      .toThrow('failed host validation')
    expect(translations.mutations).toBe(0)

    expect(() => new WorkspacePreviewHost({
      runtime: WorkspacePreviewWorkerClient.compose({}),
      domainPlugins: [{
        ownerId: 'fixture.domain-preview',
        manifest: fixtureManifest,
        provider: fixtureProvider
      }]
    })).toThrow('cannot be combined with domain plugins')
  })

  it('rejects main or renderer manifest drift from the package canonical contract', () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule({
      definition: fixtureDefinition,
      contributions: [{
        kind: MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: {
          manifest: { ...fixtureManifest, displayName: 'Drifted Main Preview' },
          provider: fixtureProvider
        }
      }]
    })
    expect(() => listMainWorkspacePreviewPluginContributions(catalog))
      .toThrow('failed runtime validation')

    const installed = defineInstalledDomainPackageSet([fixtureDefinition])
    const rendererEntrySet = defineInstalledRendererDomainEntrySet(installed, [{
      definition: fixtureDefinition,
      contributions: [{
        kind: RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        id: fixtureContributionId,
        contract: fixtureManifest,
        value: {
          ...fixtureRenderer,
          manifest: { ...fixtureManifest, displayName: 'Drifted Preview' }
        }
      }]
    }])

    expect(() => createInstalledRendererContributions({
      entrySet: rendererEntrySet,
      translations: new NoopTranslationHost()
    })).toThrow('failed host validation')
  })
})

class NoopTranslationHost implements RendererTranslationHost {
  mutations = 0
  hasResourceBundle(): boolean { return false }
  getResourceBundle(): unknown { return {} }
  addResourceBundle(): void { this.mutations += 1 }
  removeResourceBundle(): void { this.mutations += 1 }
}
