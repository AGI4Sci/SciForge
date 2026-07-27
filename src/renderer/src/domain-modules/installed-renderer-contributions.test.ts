import type { InstalledDomainProcessEntrySet } from '@sciforge/domain-sdk'
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
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  type WorkbenchRightPanelContribution
} from './workbench-right-panel-slot'

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
        contribution: installed.value as WorkbenchRightPanelContribution
      }))
      .sort((left, right) =>
        left.installed.declaration.priority - right.installed.declaration.priority ||
        left.installed.owner.moduleId.localeCompare(right.installed.owner.moduleId) ||
        left.installed.declaration.id.localeCompare(right.installed.declaration.id)
      )
      .map(({ installed, contribution }) => ({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        mode: contribution.mode,
        label: contribution.label,
        title: contribution.title,
        resourceKind: contribution.resourceKind,
        available: contribution.isAvailable()
      }))

    expect(runtime.rightPanels.list().map(({ id, ownerId, contribution }) => ({
      id,
      ownerId,
      mode: contribution.mode,
      label: contribution.label,
      title: contribution.title,
      resourceKind: contribution.resourceKind,
      available: contribution.isAvailable()
    }))).toEqual(expectedPanels)
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
    expect(runtime.rightPanels.list()).toEqual([])
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
