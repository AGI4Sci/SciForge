import type { InstalledDomainProcessEntrySet } from '@sciforge/domain-sdk'
import {
  RENDERER_COMMAND_CONTRIBUTION_KIND,
  RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND,
  RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND,
  RENDERER_SETTINGS_SECTION_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND,
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  domainRendererComposerContextProviderContractSchema,
  domainRendererWorkbenchBottomPanelContractSchema,
  domainRendererWorkbenchGlobalOverlayContractSchema,
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchToolbarActionContractSchema,
  isDomainRendererCommandHandler,
  isDomainRendererChatResultPanelValue,
  isDomainRendererSettingsSectionValue,
  isDomainRendererComposerContextProvider,
  isDomainRendererWorkbenchSurfaceValue,
  isDomainRendererWorkbenchToolbarActionValue,
  type DomainRendererCommandHandler,
  type DomainRendererComposerContextProvider,
  type DomainRendererSettingsSectionValue,
  type DomainRendererComposerContextProviderContract,
  type DomainRendererWorkbenchBottomPanelContract,
  type DomainRendererWorkbenchBottomPanelValue,
  type DomainRendererWorkbenchGlobalOverlayContract,
  type DomainRendererWorkbenchGlobalOverlayValue,
  type DomainRendererWorkbenchRightPanelContract,
  type DomainRendererWorkbenchRightPanelValue
} from '@sciforge/domain-sdk/renderer'
import type { ReactElement } from 'react'
import i18n from '../i18n'
import { installedRendererDomainEntrySet } from './installed-domain-renderer'
import {
  WorkbenchRightPanelContributionRegistry
} from './workbench-right-panel-slot'
import {
  WorkbenchBottomPanelContributionRegistry
} from './workbench-bottom-panel-slot'
import {
  WorkbenchGlobalOverlayContributionRegistry
} from './workbench-global-overlay-slot'
import {
  ComposerContextProviderRegistry
} from './composer-context-provider-registry'
import {
  WorkbenchCommandRegistry
} from './workbench-command-registry'
import {
  RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
  WorkbenchToolbarActionContributionRegistry,
  type WorkbenchToolbarActionContract,
  type WorkbenchToolbarActionValue
} from './workbench-toolbar-slot'
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
  commands: WorkbenchCommandRegistry
  rightPanels: WorkbenchRightPanelContributionRegistry
  chatResultPanels: ChatResultPanelContributionRegistry
  settingsSections: readonly Readonly<{
    id: string
    ownerId: string
    order: number
    value: DomainRendererSettingsSectionValue<ReactElement>
  }>[]
  bottomPanels: WorkbenchBottomPanelContributionRegistry
  globalOverlays: WorkbenchGlobalOverlayContributionRegistry
  composerContexts: ComposerContextProviderRegistry
  toolbarActions: WorkbenchToolbarActionContributionRegistry
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
    id: string
    ownerId: string
    order: number
    contract: DomainRendererWorkbenchRightPanelContract
    value: DomainRendererWorkbenchRightPanelValue<ReactElement>
    onDispose?: () => void
  }> = []
  const bottomPanels: Array<{
    id: string
    ownerId: string
    order: number
    contract: DomainRendererWorkbenchBottomPanelContract
    value: DomainRendererWorkbenchBottomPanelValue<ReactElement>
    onDispose?: () => void
  }> = []
  const globalOverlays: Array<{
    id: string
    ownerId: string
    order: number
    contract: DomainRendererWorkbenchGlobalOverlayContract
    value: DomainRendererWorkbenchGlobalOverlayValue<ReactElement>
    onDispose?: () => void
  }> = []
  const composerContexts: Array<{
    id: string
    ownerId: string
    order: number
    contract: DomainRendererComposerContextProviderContract
    value: DomainRendererComposerContextProvider
    onDispose?: () => void
  }> = []
  const commands: Array<{
    id: string
    ownerId: string
    order: number
    contribution: DomainRendererCommandHandler
    onDispose?: () => void
  }> = []
  const resources: Array<{
    contribution: RendererI18nResourceContribution
    onDispose?: () => void
  }> = []
  const toolbarActions: Array<{
    id: string
    ownerId: string
    order: number
    contract: WorkbenchToolbarActionContract
    value: WorkbenchToolbarActionValue
    onDispose?: () => void
  }> = []
  const chatResultPanels: Array<{
    ownerId: string
    order: number
    contribution: ChatResultPanelContribution
    onDispose?: () => void
  }> = []
  const settingsSections: Array<{
    id: string
    ownerId: string
    order: number
    value: DomainRendererSettingsSectionValue<ReactElement>
    onDispose?: () => void
  }> = []
  const workspacePreviewPlugins: RendererWorkspacePreviewPluginRegistrationInput[] = []
  const lifecycles: Array<{
    contribution: RendererLifecycleContribution
    onDispose?: () => void
  }> = []

  for (const installed of entrySet.contributions) {
    if (installed.declaration.kind === RENDERER_COMMAND_CONTRIBUTION_KIND) {
      if (!isDomainRendererCommandHandler(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      commands.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contribution: installed.value,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND) {
      const contract = domainRendererWorkbenchRightPanelContractSchema.safeParse(
        installed.contract
      )
      if (
        !contract.success ||
        !isDomainRendererWorkbenchSurfaceValue(installed.value)
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      panels.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract: contract.data,
        value: installed.value as DomainRendererWorkbenchRightPanelValue<ReactElement>,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKBENCH_BOTTOM_PANEL_CONTRIBUTION_KIND) {
      const contract = domainRendererWorkbenchBottomPanelContractSchema.safeParse(
        installed.contract
      )
      if (
        !contract.success ||
        !isDomainRendererWorkbenchSurfaceValue(installed.value)
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      bottomPanels.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract: contract.data,
        value: installed.value as DomainRendererWorkbenchBottomPanelValue<ReactElement>,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKBENCH_GLOBAL_OVERLAY_CONTRIBUTION_KIND) {
      const contract = domainRendererWorkbenchGlobalOverlayContractSchema.safeParse(
        installed.contract
      )
      if (
        !contract.success ||
        !isDomainRendererWorkbenchSurfaceValue(installed.value)
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      globalOverlays.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract: contract.data,
        value: installed.value as DomainRendererWorkbenchGlobalOverlayValue<ReactElement>,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_COMPOSER_CONTEXT_PROVIDER_CONTRIBUTION_KIND) {
      const contract = domainRendererComposerContextProviderContractSchema.safeParse(
        installed.contract
      )
      if (
        !contract.success ||
        !isDomainRendererComposerContextProvider(installed.value)
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      composerContexts.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract: contract.data,
        value: installed.value,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND) {
      const contract = domainRendererWorkbenchToolbarActionContractSchema.safeParse(
        installed.contract
      )
      if (
        !contract.success ||
        !isDomainRendererWorkbenchToolbarActionValue(installed.value) ||
        !isWorkbenchToolbarIcon(installed.value.icon)
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      toolbarActions.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract: contract.data,
        value: installed.value as WorkbenchToolbarActionValue,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_I18N_RESOURCE_CONTRIBUTION_KIND) {
      if (!isRendererI18nResourceContribution(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      resources.push({
        contribution: installed.value,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_CHAT_RESULT_PANEL_CONTRIBUTION_KIND) {
      if (
        !isChatResultPanelContribution(installed.value) ||
        installed.value.id !== installed.declaration.id
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      chatResultPanels.push({
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contribution: installed.value,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_SETTINGS_SECTION_CONTRIBUTION_KIND) {
      if (!isDomainRendererSettingsSectionValue(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      settingsSections.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.value.order ?? installed.declaration.priority,
        value: installed.value as DomainRendererSettingsSectionValue<ReactElement>,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
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
      lifecycles.push({
        contribution: installed.value,
        ...(installed.onDispose ? { onDispose: installed.onDispose } : {})
      })
      continue
    }
    throw new Error(
      `Renderer contribution kind ${installed.declaration.kind} from ${installed.owner.moduleId} has no host consumer.`
    )
  }

  const workbenchCommands = new WorkbenchCommandRegistry()
  const rightPanels = new WorkbenchRightPanelContributionRegistry()
  const chatResultPanelRegistry = new ChatResultPanelContributionRegistry()
  const workbenchBottomPanels = new WorkbenchBottomPanelContributionRegistry()
  const workbenchGlobalOverlays = new WorkbenchGlobalOverlayContributionRegistry()
  const workbenchComposerContexts = new ComposerContextProviderRegistry()
  const workbenchToolbarActions = new WorkbenchToolbarActionContributionRegistry(
    workbenchCommands
  )
  const workspacePreviews = createRendererWorkspacePreviewRegistry({
    registrations: [
      ...createBuiltInWorkspacePreviewPluginRegistrations(),
      ...workspacePreviewPlugins
    ]
  })
  const registrationDisposers: Array<() => void> = [
    () => workbenchCommands.dispose(),
    () => rightPanels.dispose(),
    () => chatResultPanelRegistry.dispose(),
    () => workbenchBottomPanels.dispose(),
    () => workbenchGlobalOverlays.dispose(),
    () => workbenchComposerContexts.dispose(),
    () => workbenchToolbarActions.dispose(),
    () => workspacePreviews.dispose()
  ]
  try {
    for (const command of commands) {
      pushOwnedRegistration(
        registrationDisposers,
        command.onDispose,
        workbenchCommands.register(command).dispose
      )
    }
    for (const panel of panels) {
      pushOwnedRegistration(
        registrationDisposers,
        panel.onDispose,
        rightPanels.register(panel).dispose
      )
    }
    for (const panel of bottomPanels) {
      pushOwnedRegistration(
        registrationDisposers,
        panel.onDispose,
        workbenchBottomPanels.register(panel).dispose
      )
    }
    for (const overlay of globalOverlays) {
      pushOwnedRegistration(
        registrationDisposers,
        overlay.onDispose,
        workbenchGlobalOverlays.register(overlay).dispose
      )
    }
    for (const context of composerContexts) {
      pushOwnedRegistration(
        registrationDisposers,
        context.onDispose,
        workbenchComposerContexts.register(context).dispose
      )
    }
    for (const action of toolbarActions) {
      pushOwnedRegistration(
        registrationDisposers,
        action.onDispose,
        workbenchToolbarActions.register(action).dispose
      )
    }
    for (const resource of resources) {
      pushOwnedRegistration(
        registrationDisposers,
        resource.onDispose,
        installTranslationResource(translations, resource.contribution)
      )
    }
    for (const panel of chatResultPanels) {
      pushOwnedRegistration(
        registrationDisposers,
        panel.onDispose,
        chatResultPanelRegistry.register(panel).dispose
      )
    }
    for (const section of settingsSections) {
      if (section.onDispose) registrationDisposers.push(section.onDispose)
    }
    for (const lifecycle of lifecycles) {
      const dispose = lifecycle.contribution.activate()
      if (dispose !== undefined && typeof dispose !== 'function') {
        throw new Error('Renderer lifecycle activate() must return a disposer function or undefined.')
      }
      if (lifecycle.onDispose) registrationDisposers.push(lifecycle.onDispose)
      if (dispose) registrationDisposers.push(dispose)
    }
  } catch (error) {
    try {
      disposeRegistrationsInReverse(registrationDisposers)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Renderer contribution activation and rollback both failed.'
      )
    }
    throw error
  }

  let disposed = false
  return Object.freeze({
    commands: workbenchCommands,
    rightPanels,
    chatResultPanels: chatResultPanelRegistry,
    settingsSections: Object.freeze(settingsSections
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map(({ onDispose: _onDispose, ...section }) => Object.freeze(section))),
    bottomPanels: workbenchBottomPanels,
    globalOverlays: workbenchGlobalOverlays,
    composerContexts: workbenchComposerContexts,
    toolbarActions: workbenchToolbarActions,
    workspacePreviews,
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeRegistrationsInReverse(registrationDisposers)
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

function pushOwnedRegistration(
  disposers: Array<() => void>,
  onDispose: (() => void) | undefined,
  unregister: () => void
): void {
  if (onDispose) disposers.push(onDispose)
  disposers.push(unregister)
}

function disposeRegistrationsInReverse(disposers: Array<() => void>): void {
  let firstError: unknown
  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

function isWorkbenchToolbarIcon(value: unknown): boolean {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
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
  return isDomainRendererChatResultPanelValue(value)
}

function invalidContribution(id: string, ownerId: string): Error {
  return new Error(`Renderer contribution ${id} from ${ownerId} failed host validation.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
