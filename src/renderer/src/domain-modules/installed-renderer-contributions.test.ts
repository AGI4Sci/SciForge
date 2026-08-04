import type { InstalledDomainProcessEntrySet } from '@sciforge/domain-sdk'
import {
  RENDERER_COMMAND_CONTRIBUTION_KIND,
  RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  type DomainRendererWorkbenchRightPanelContract
} from '@sciforge/domain-sdk/renderer'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../workspace-preview/PdfWorkspaceViewer', () => ({ PdfWorkspaceViewer: () => null }))
import { installedRendererDomainEntrySet } from './installed-domain-renderer'
import {
  createInstalledRendererContributions,
  RENDERER_I18N_RESOURCE_CONTRIBUTION_KIND,
  type RendererI18nResourceContribution,
  type RendererTranslationHost
} from './installed-renderer-contributions'
import { RENDERER_LIFECYCLE_CONTRIBUTION_KIND } from './renderer-lifecycle'
import {
  RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND,
  type ChatResultPanelContribution
} from './chat-result-panel-slot'
import {
  RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
  type WorkbenchToolbarActionContract
} from './workbench-toolbar-slot'

describe('installed renderer contributions', () => {
  it('registers package-owned UI and translations and disposes both idempotently', () => {
    const translations = new MemoryTranslationHost({
      en: { common: { coreTitle: 'Core' } },
      zh: { common: { coreTitle: '核心' } }
    })
    const runtime = createInstalledRendererContributions({ translations })
    const expectedPanels = installedRendererDomainEntrySet.contributions
      .filter(({ declaration }) =>
        declaration.kind === RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND
      )
      .map((installed) => ({
        installed,
        contract: installed.contract as DomainRendererWorkbenchRightPanelContract
      }))
      .sort((left, right) =>
        left.installed.declaration.priority - right.installed.declaration.priority ||
        left.installed.owner.moduleId.localeCompare(right.installed.owner.moduleId) ||
        left.installed.declaration.id.localeCompare(right.installed.declaration.id)
      )
      .map(({ installed, contract }) => ({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        location: contract.location,
        title: contract.title,
        resourceKind: contract.resourceKind
      }))

    expect(runtime.rightPanels.list().map(({ id, ownerId, contribution }) => ({
      id,
      ownerId,
      location: contribution.location,
      title: contribution.title,
      resourceKind: contribution.resourceKind
    }))).toEqual(expectedPanels)
    const expectedChatPanels = installedRendererDomainEntrySet.contributions
      .filter(({ declaration }) =>
        declaration.kind === RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND
      )
      .map(({ declaration, owner, value }) => ({
        id: declaration.id,
        ownerId: owner.moduleId,
        contributionId: (value as ChatResultPanelContribution).id
      }))
    expect(runtime.chatResultPanels.list().map(({ id, ownerId, contribution }) => ({
      id,
      ownerId,
      contributionId: contribution.id
    }))).toEqual(expectedChatPanels)
    expect(runtime.chatResultPanels.list().map(({ id, ownerId, contribution }) => ({
      id,
      ownerId,
      contributionId: contribution.id
    }))).toContainEqual({
      id: 'dataset-api.timeline-results',
      ownerId: 'sciforge.dataset-api',
      contributionId: 'dataset-api.timeline-results'
    })
    const expectedCommands = installedRendererDomainEntrySet.contributions
      .filter(({ declaration }) =>
        declaration.kind === RENDERER_COMMAND_CONTRIBUTION_KIND
      )
      .map(({ declaration, owner }) => ({
        id: declaration.id,
        ownerId: owner.moduleId,
        order: declaration.priority
      }))
      .sort((left, right) =>
        left.order - right.order ||
        left.ownerId.localeCompare(right.ownerId) ||
        left.id.localeCompare(right.id)
      )
      .map(({ id, ownerId }) => ({ id, ownerId }))
    expect(runtime.commands.list().map(({ id, ownerId }) => ({ id, ownerId })))
      .toEqual(expectedCommands)
    const expectedToolbarActions = installedRendererDomainEntrySet.contributions
      .filter(({ declaration }) =>
        declaration.kind === RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND
      )
      .map((installed) => ({
        installed,
        contract: installed.contract as WorkbenchToolbarActionContract
      }))
      .sort((left, right) =>
        left.installed.declaration.priority - right.installed.declaration.priority ||
        left.installed.owner.moduleId.localeCompare(right.installed.owner.moduleId) ||
        left.installed.declaration.id.localeCompare(right.installed.declaration.id)
      )
      .map(({ installed, contract }) => ({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        commandId: contract.commandId,
        label: contract.label
      }))
    expect(runtime.toolbarActions.list().map(({ id, ownerId, contribution }) => ({
      id,
      ownerId,
      commandId: contribution.commandId,
      label: contribution.label
    }))).toEqual(expectedToolbarActions)
    const expectedEnglish = installedMessages('en')
    const expectedChinese = installedMessages('zh')
    expect(translations.bundle('en', 'common')).toMatchObject({
      coreTitle: 'Core',
      ...expectedEnglish
    })
    expect(translations.bundle('zh', 'common')).toMatchObject({
      coreTitle: '核心',
      ...expectedChinese
    })

    runtime.dispose()
    runtime.dispose()
    expect(runtime.disposed).toBe(true)
    expect(runtime.commands.list()).toEqual([])
    expect(runtime.rightPanels.list()).toEqual([])
    expect(runtime.chatResultPanels.list()).toEqual([])
    expect(runtime.bottomPanels.list()).toEqual([])
    expect(runtime.globalOverlays.list()).toEqual([])
    expect(runtime.composerContexts.list()).toEqual([])
    expect(runtime.toolbarActions.list()).toEqual([])
    expect(translations.bundle('en', 'common')).toEqual({ coreTitle: 'Core' })
    expect(translations.bundle('zh', 'common')).toEqual({ coreTitle: '核心' })
  })

  it('performs no host registration when any validated contribution value is invalid', () => {
    const translations = new MemoryTranslationHost()
    const invalidEntrySet = {
      ...installedRendererDomainEntrySet,
      contributions: installedRendererDomainEntrySet.contributions.map((contribution) =>
        contribution.declaration.kind === 'renderer.i18n-resource'
          ? { ...contribution, value: { namespace: 'common', resources: { en: { broken: 42 } } } }
          : contribution
      )
    } as unknown as InstalledDomainProcessEntrySet<'renderer', unknown>

    expect(() => createInstalledRendererContributions({
      entrySet: invalidEntrySet,
      translations
    })).toThrow('failed host validation')
    expect(translations.mutations).toEqual([])
  })

  it('binds generic surface and composer contributions and disposes owners in reverse order', async () => {
    const disposalOrder: string[] = []
    const template = installedRendererDomainEntrySet.contributions[0]!
    const entrySet = {
      ...installedRendererDomainEntrySet,
      contributions: [
        ...installedRendererDomainEntrySet.contributions,
        {
          ...template,
          owner: { moduleId: 'fixture.bottom', moduleVersion: '1.0.0' },
          declaration: {
            id: 'fixture.bottom.panel',
            kind: RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
            priority: 10
          },
          contract: {
            location: 'workbench.bottom-panel',
            title: 'Fixture bottom'
          },
          value: { render: () => null },
          onDispose: () => disposalOrder.push('bottom')
        },
        {
          ...template,
          owner: { moduleId: 'fixture.overlay', moduleVersion: '1.0.0' },
          declaration: {
            id: 'fixture.overlay.dialog',
            kind: RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
            priority: 20
          },
          contract: {
            location: 'workbench.global-overlay',
            title: 'Fixture overlay'
          },
          value: { render: () => null },
          onDispose: () => disposalOrder.push('overlay')
        },
        {
          ...template,
          owner: { moduleId: 'fixture.composer', moduleVersion: '1.0.0' },
          declaration: {
            id: 'fixture.composer.context',
            kind: RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
            priority: 30
          },
          contract: {
            location: 'composer.context',
            label: 'Fixture context'
          },
          value: {
            provide: () => ({
              items: [{
                id: 'fixture.context.item',
                title: 'Fixture',
                content: 'Bound through the generic composer registry.'
              }]
            })
          },
          onDispose: () => disposalOrder.push('composer')
        }
      ]
    } as unknown as InstalledDomainProcessEntrySet<'renderer', unknown>

    const runtime = createInstalledRendererContributions({
      entrySet,
      translations: new MemoryTranslationHost()
    })

    expect(runtime.bottomPanels.resolve('fixture.bottom.panel')).toMatchObject({
      ownerId: 'fixture.bottom'
    })
    expect(runtime.globalOverlays.resolve('fixture.overlay.dialog')).toMatchObject({
      ownerId: 'fixture.overlay'
    })
    const composer = runtime.composerContexts.resolve('fixture.composer.context')
    expect(composer).toMatchObject({ ownerId: 'fixture.composer' })
    await expect(composer!.contribution.provide({
      draftText: 'draft',
      signal: new AbortController().signal
    })).resolves.toEqual({
      items: [{
        id: 'fixture.context.item',
        title: 'Fixture',
        content: 'Bound through the generic composer registry.'
      }]
    })

    runtime.dispose()
    expect(disposalOrder).toEqual(['composer', 'overlay', 'bottom'])
    expect(runtime.bottomPanels.list()).toEqual([])
    expect(runtime.globalOverlays.list()).toEqual([])
    expect(runtime.composerContexts.list()).toEqual([])
  })

  it('rejects an invalid composer provider before any renderer registration occurs', () => {
    const translations = new MemoryTranslationHost()
    const template = installedRendererDomainEntrySet.contributions[0]!
    const entrySet = {
      ...installedRendererDomainEntrySet,
      contributions: [
        ...installedRendererDomainEntrySet.contributions,
        {
          ...template,
          owner: { moduleId: 'fixture.invalid-composer', moduleVersion: '1.0.0' },
          declaration: {
            id: 'fixture.invalid-composer.context',
            kind: RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
            priority: 10
          },
          contract: {
            location: 'composer.context',
            label: 'Invalid context'
          },
          value: {
            provide: () => ({ items: [] }),
            parallelImplementation: true
          }
        }
      ]
    } as unknown as InstalledDomainProcessEntrySet<'renderer', unknown>

    expect(() => createInstalledRendererContributions({ entrySet, translations }))
      .toThrow('failed host validation')
    expect(translations.mutations).toEqual([])
  })

  it('rejects an unknown toolbar command atomically before translations are installed', () => {
    const translations = new MemoryTranslationHost()
    const template = installedRendererDomainEntrySet.contributions.find(
      ({ declaration }) =>
        declaration.kind === RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND
    )!
    const entrySet = {
      ...installedRendererDomainEntrySet,
      contributions: installedRendererDomainEntrySet.contributions.map((contribution) =>
        contribution === template
          ? {
              ...contribution,
              contract: {
                ...(contribution.contract as WorkbenchToolbarActionContract),
                commandId: 'missing.open'
              }
            }
          : contribution
      )
    } as unknown as InstalledDomainProcessEntrySet<'renderer', unknown>

    expect(() => createInstalledRendererContributions({ entrySet, translations }))
      .toThrow('references unknown command "missing.open"')
    expect(translations.mutations).toEqual([])
  })

  it('rolls back earlier renderer registrations when host activation fails', () => {
    const translations = new MemoryTranslationHost({}, 'zh')

    expect(() => createInstalledRendererContributions({ translations }))
      .toThrow('translation activation failed')
    expect(translations.bundle('en', 'common')).toEqual({})
    expect(translations.bundle('zh', 'common')).toEqual({})
    expect(translations.mutations).toEqual([
      'add:en:common',
      'remove:en:common'
    ])
  })

  it('activates and disposes generic package renderer lifecycles', () => {
    const dispose = vi.fn()
    const activate = vi.fn(() => dispose)
    const template = installedRendererDomainEntrySet.contributions[0]!
    const entrySet = {
      ...installedRendererDomainEntrySet,
      contributions: [
        ...installedRendererDomainEntrySet.contributions,
        {
          ...template,
          owner: { moduleId: 'fixture.renderer-lifecycle', moduleVersion: '1.0.0' },
          declaration: {
            id: 'fixture.renderer-lifecycle.prewarm',
            kind: RENDERER_LIFECYCLE_CONTRIBUTION_KIND,
            priority: 100
          },
          value: { activate }
        }
      ]
    } as unknown as InstalledDomainProcessEntrySet<'renderer', unknown>

    const runtime = createInstalledRendererContributions({
      entrySet,
      translations: new MemoryTranslationHost()
    })

    expect(activate).toHaveBeenCalledOnce()
    runtime.dispose()
    runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function installedMessages(language: string): Record<string, string> {
  return Object.assign(
    {},
    ...installedRendererDomainEntrySet.contributions
      .filter(({ declaration }) =>
        declaration.kind === RENDERER_I18N_RESOURCE_CONTRIBUTION_KIND
      )
      .map(({ value }) => {
        const contribution = value as RendererI18nResourceContribution
        return contribution.resources[language] ?? {}
      })
  )
}

class MemoryTranslationHost implements RendererTranslationHost {
  readonly mutations: string[] = []
  readonly #resources = new Map<string, Record<string, string>>()

  constructor(
    seed: Record<string, Record<string, Record<string, string>>> = {},
    private readonly failOnLanguage?: string
  ) {
    for (const [language, namespaces] of Object.entries(seed)) {
      for (const [namespace, resources] of Object.entries(namespaces)) {
        this.#resources.set(this.key(language, namespace), structuredClone(resources))
      }
    }
  }

  hasResourceBundle(language: string, namespace: string): boolean {
    return this.#resources.has(this.key(language, namespace))
  }

  getResourceBundle(language: string, namespace: string): unknown {
    return structuredClone(this.bundle(language, namespace))
  }

  addResourceBundle(
    language: string,
    namespace: string,
    resources: Readonly<Record<string, string>>
  ): void {
    if (language === this.failOnLanguage) throw new Error('translation activation failed')
    this.mutations.push(`add:${language}:${namespace}`)
    this.#resources.set(this.key(language, namespace), {
      ...this.bundle(language, namespace),
      ...resources
    })
  }

  removeResourceBundle(language: string, namespace: string): void {
    this.mutations.push(`remove:${language}:${namespace}`)
    this.#resources.delete(this.key(language, namespace))
  }

  bundle(language: string, namespace: string): Record<string, string> {
    return structuredClone(this.#resources.get(this.key(language, namespace)) ?? {})
  }

  private key(language: string, namespace: string): string {
    return `${language}\u0000${namespace}`
  }
}
