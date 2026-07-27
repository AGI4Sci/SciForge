import type { InstalledDomainProcessEntrySet } from '@sciforge/domain-sdk'
import i18n from '../i18n'
import { installedRendererDomainEntrySet } from './installed-domain-renderer'
import {
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  WorkbenchRightPanelContributionRegistry,
  type WorkbenchRightPanelContribution
} from './workbench-right-panel-slot'
import {
  createBuiltInWorkspacePreviewPluginRegistrations
} from '../workspace-preview/built-in-plugin-contributions'
import {
  createRendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewPluginRegistrationInput,
  type RendererWorkspacePreviewRegistry
} from '../workspace-preview/registry'
import {
  RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  isRendererWorkspacePreviewPluginContribution,
  rendererWorkspacePreviewPluginRegistration
} from './workspace-preview-contributions'
import {
  RENDERER_LIFECYCLE_CONTRIBUTION_KIND,
  isRendererLifecycleContribution,
  type RendererLifecycleContribution
} from './renderer-lifecycle'
import {
  ChatResultPanelContributionRegistry,
  RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND,
  type ChatResultPanelContribution
} from './chat-result-panel-slot'

export const RENDERER_I18N_RESOURCE_CONTRIBUTION_KIND = 'renderer.i18n-resource' as const

export type RendererI18nResourceContribution = Readonly<{
  namespace: string
  resources: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

export type RendererTranslationHost = Readonly<{
  hasResourceBundle(language: string, namespace: string): boolean
  getResourceBundle(language: string, namespace: string): unknown
  addResourceBundle(
    language: string,
    namespace: string,
    resources: Readonly<Record<string, string>>,
    deep: boolean,
    overwrite: boolean
  ): unknown
  removeResourceBundle(language: string, namespace: string): unknown
}>

export type InstalledRendererContributions = Readonly<{
  rightPanels: WorkbenchRightPanelContributionRegistry
  chatResultPanels: ChatResultPanelContributionRegistry
  workspacePreviews: RendererWorkspacePreviewRegistry
  readonly disposed: boolean
  dispose(): void
}>

export type InstalledRendererContributionOptions = Readonly<{
  entrySet?: InstalledDomainProcessEntrySet<'renderer', unknown>
  translations?: RendererTranslationHost
}>

/** Validates every value before applying any renderer-side registration. */
export function createInstalledRendererContributions(
  options: InstalledRendererContributionOptions = {}
): InstalledRendererContributions {
  const entrySet = options.entrySet ?? installedRendererDomainEntrySet
  const translations = options.translations ?? i18n
  const panels: Array<{
    ownerId: string
    order: number
    contribution: WorkbenchRightPanelContribution
  }> = []
  const chatResultPanels: Array<{
    ownerId: string
    order: number
    contribution: ChatResultPanelContribution
  }> = []
  const resources: RendererI18nResourceContribution[] = []
  const workspacePreviewPlugins: RendererWorkspacePreviewPluginRegistrationInput[] = []
  const lifecycles: RendererLifecycleContribution[] = []

  for (const installed of entrySet.contributions) {
    if (installed.declaration.kind === RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND) {
      if (!isWorkbenchRightPanelContribution(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      panels.push({
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contribution: installed.value
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_I18N_RESOURCE_CONTRIBUTION_KIND) {
      if (!isRendererI18nResourceContribution(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      resources.push(installed.value)
      continue
    }
    if (installed.declaration.kind === RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND) {
      if (!isChatResultPanelContribution(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      chatResultPanels.push({
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contribution: installed.value
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND) {
      if (!isRendererWorkspacePreviewPluginContribution(installed.value, installed)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      workspacePreviewPlugins.push(rendererWorkspacePreviewPluginRegistration(
        installed.owner.moduleId,
        installed.value
      ))
      continue
    }
    if (installed.declaration.kind === RENDERER_LIFECYCLE_CONTRIBUTION_KIND) {
      if (!isRendererLifecycleContribution(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      lifecycles.push(installed.value)
      continue
    }
    throw new Error(
      `Renderer contribution kind ${installed.declaration.kind} from ${installed.owner.moduleId} has no host consumer.`
    )
  }

  const rightPanels = new WorkbenchRightPanelContributionRegistry()
  const chatResultPanelRegistry = new ChatResultPanelContributionRegistry()
  const workspacePreviews = createRendererWorkspacePreviewRegistry({
    registrations: [
      ...createBuiltInWorkspacePreviewPluginRegistrations(),
      ...workspacePreviewPlugins
    ]
  })
  const translationDisposers: Array<() => void> = []
  const lifecycleDisposers: Array<() => void> = []
  try {
    for (const resource of resources) {
      translationDisposers.push(installTranslationResource(translations, resource))
    }
    for (const panel of panels) rightPanels.register(panel)
    for (const panel of chatResultPanels) chatResultPanelRegistry.register(panel)
    for (const lifecycle of lifecycles) {
      const dispose = lifecycle.activate()
      if (dispose !== undefined && typeof dispose !== 'function') {
        throw new Error('Renderer lifecycle activate() must return a disposer function or undefined.')
      }
      lifecycleDisposers.push(dispose ?? (() => undefined))
    }
  } catch (error) {
    for (const dispose of lifecycleDisposers.reverse()) dispose()
    rightPanels.dispose()
    chatResultPanelRegistry.dispose()
    workspacePreviews.dispose()
    for (const dispose of translationDisposers.reverse()) dispose()
    throw error
  }

  let disposed = false
  return Object.freeze({
    rightPanels,
    chatResultPanels: chatResultPanelRegistry,
    workspacePreviews,
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of lifecycleDisposers.reverse()) dispose()
      rightPanels.dispose()
      chatResultPanelRegistry.dispose()
      workspacePreviews.dispose()
      for (const dispose of translationDisposers.reverse()) dispose()
    }
  })
}

export const installedRendererContributions = createInstalledRendererContributions()

function installTranslationResource(
  host: RendererTranslationHost,
  contribution: RendererI18nResourceContribution
): () => void {
  const restorations: Array<() => void> = []
  try {
    for (const [language, messages] of Object.entries(contribution.resources)) {
      const hadNamespace = host.hasResourceBundle(language, contribution.namespace)
      const previous = hadNamespace
        ? structuredClone(host.getResourceBundle(language, contribution.namespace))
        : undefined
      host.addResourceBundle(language, contribution.namespace, messages, true, true)
      restorations.push(() => {
        host.removeResourceBundle(language, contribution.namespace)
        if (hadNamespace) {
          host.addResourceBundle(
            language,
            contribution.namespace,
            previous as Readonly<Record<string, string>>,
            true,
            true
          )
        }
      })
    }
  } catch (error) {
    for (const restore of restorations.reverse()) restore()
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const restore of restorations.reverse()) restore()
  }
}

function isWorkbenchRightPanelContribution(
  value: unknown
): value is WorkbenchRightPanelContribution {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkbenchRightPanelContribution>
  return typeof candidate.id === 'string' &&
    typeof candidate.mode === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.icon === 'object' &&
    typeof candidate.title === 'string' &&
    typeof candidate.resourceKind === 'string' &&
    typeof candidate.isAvailable === 'function' &&
    typeof candidate.render === 'function'
}

function isRendererI18nResourceContribution(
  value: unknown
): value is RendererI18nResourceContribution {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RendererI18nResourceContribution>
  if (typeof candidate.namespace !== 'string' || !isRecord(candidate.resources)) return false
  return Object.values(candidate.resources).every((messages) =>
    isRecord(messages) && Object.values(messages).every((message) => typeof message === 'string')
  )
}

function isChatResultPanelContribution(
  value: unknown
): value is ChatResultPanelContribution {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatResultPanelContribution>
  return typeof candidate.id === 'string' && typeof candidate.render === 'function'
}

function invalidContribution(id: string, ownerId: string): Error {
  return new Error(`Renderer contribution ${id} from ${ownerId} failed host validation.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
