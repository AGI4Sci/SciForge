import type { InstalledDomainProcessEntrySet } from '@sciforge/domain-sdk'
import i18n from '../i18n'
import { installedRendererDomainEntrySet } from './installed-domain-renderer'
import {
  RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND,
  WorkbenchRightPanelContributionRegistry,
  type WorkbenchRightPanelContribution
} from './workbench-right-panel-slot'
import {
  RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND,
  WORKBENCH_TOOLBAR_SLOT,
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
    ownerId: string
    order: number
    contribution: WorkbenchRightPanelContribution
  }> = []
  const resources: RendererI18nResourceContribution[] = []
  const toolbarActions: Array<{
    id: string
    ownerId: string
    order: number
    contract: WorkbenchToolbarActionContract
    value: WorkbenchToolbarActionValue
  }> = []
  const workspacePreviewPlugins: RendererWorkspacePreviewPluginRegistrationInput[] = []
  const lifecycles: RendererLifecycleContribution[] = []

  for (const installed of entrySet.contributions) {
    if (installed.declaration.kind === RENDERER_WORKBENCH_RIGHT_PANEL_CONTRIBUTION_KIND) {
      if (
        !isWorkbenchRightPanelContribution(installed.value) ||
        installed.value.id !== installed.declaration.id
      ) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      panels.push({
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contribution: installed.value
      })
      continue
    }
    if (installed.declaration.kind === RENDERER_WORKBENCH_TOOLBAR_ACTION_CONTRIBUTION_KIND) {
      const contract = parseWorkbenchToolbarActionContract(installed.contract)
      if (!contract || !isWorkbenchToolbarActionValue(installed.value)) {
        throw invalidContribution(installed.declaration.id, installed.owner.moduleId)
      }
      toolbarActions.push({
        id: installed.declaration.id,
        ownerId: installed.owner.moduleId,
        order: installed.declaration.priority,
        contract,
        value: installed.value
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
  const workbenchToolbarActions = new WorkbenchToolbarActionContributionRegistry(rightPanels)
  const workspacePreviews = createRendererWorkspacePreviewRegistry({
    registrations: [
      ...createBuiltInWorkspacePreviewPluginRegistrations(),
      ...workspacePreviewPlugins
    ]
  })
  const translationDisposers: Array<() => void> = []
  const lifecycleDisposers: Array<() => void> = []
  try {
    for (const panel of panels) rightPanels.register(panel)
    for (const action of toolbarActions) workbenchToolbarActions.register(action)
    for (const resource of resources) {
      translationDisposers.push(installTranslationResource(translations, resource))
    }
    for (const lifecycle of lifecycles) {
      const dispose = lifecycle.activate()
      if (dispose !== undefined && typeof dispose !== 'function') {
        throw new Error('Renderer lifecycle activate() must return a disposer function or undefined.')
      }
      lifecycleDisposers.push(dispose ?? (() => undefined))
    }
  } catch (error) {
    for (const dispose of lifecycleDisposers.reverse()) dispose()
    workbenchToolbarActions.dispose()
    rightPanels.dispose()
    workspacePreviews.dispose()
    for (const dispose of translationDisposers.reverse()) dispose()
    throw error
  }

  let disposed = false
  return Object.freeze({
    rightPanels,
    toolbarActions: workbenchToolbarActions,
    workspacePreviews,
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of lifecycleDisposers.reverse()) dispose()
      workbenchToolbarActions.dispose()
      rightPanels.dispose()
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
  if (!hasExactKeys(value, ['id', 'mode', 'title', 'resourceKind', 'render'])) return false
  const candidate = value as Partial<WorkbenchRightPanelContribution>
  return typeof candidate.id === 'string' &&
    typeof candidate.mode === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.resourceKind === 'string' &&
    typeof candidate.render === 'function'
}

function parseWorkbenchToolbarActionContract(
  value: unknown
): WorkbenchToolbarActionContract | null {
  if (!hasExactKeys(value, ['location', 'commandId', 'label', 'target'])) return null
  if (
    value.location !== WORKBENCH_TOOLBAR_SLOT ||
    !isNamespacedIdentifier(value.commandId) ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    !hasExactKeys(value.target, ['kind', 'contributionId']) ||
    value.target.kind !== 'workbench.right-panel' ||
    !isNamespacedIdentifier(value.target.contributionId)
  ) {
    return null
  }
  return value as WorkbenchToolbarActionContract
}

function isWorkbenchToolbarActionValue(
  value: unknown
): value is WorkbenchToolbarActionValue {
  if (!hasExactKeys(value, ['icon', 'isAvailable'])) return false
  return (typeof value.icon === 'object' || typeof value.icon === 'function') &&
    value.icon !== null &&
    typeof value.isAvailable === 'function'
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

function invalidContribution(id: string, ownerId: string): Error {
  return new Error(`Renderer contribution ${id} from ${ownerId} failed host validation.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys<Value extends string>(
  value: unknown,
  keys: readonly Value[]
): value is Record<Value, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isNamespacedIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(value)
}
