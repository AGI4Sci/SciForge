import type {
  InstalledDomainContribution,
  InstalledDomainPackageSet
} from './installed-set.js'
import {
  defineInstalledDomainProcessEntrySet,
  defineTrustedDomainProcessEntry,
  type InstalledDomainProcessEntrySet,
  type TrustedDomainProcessEntry,
  type TrustedDomainProcessEntryInput
} from './process-entry.js'
import type {
  MainWorkspacePreviewPluginSlotContribution,
  WorkspacePreviewProvider
} from './workspace-preview.js'

export const WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND =
  'workspace-server.workspace-preview-plugin' as const

export type { TrustedDomainProcessEntryInput } from './process-entry.js'
export * from './workspace-host.js'
export * from './workspace-preview.js'

export type InstalledWorkspaceServerDomainContribution =
  InstalledDomainContribution<'workspace-server'>

export function installedWorkspaceServerDomainContributions(
  installed: InstalledDomainPackageSet
): readonly InstalledWorkspaceServerDomainContribution[] {
  return installed.contributionsFor('workspace-server')
}

export type TrustedWorkspaceServerDomainPackageEntry<Value> =
  TrustedDomainProcessEntry<'workspace-server', Value>

export function defineTrustedWorkspaceServerDomainPackageEntry<Value>(
  input: TrustedDomainProcessEntryInput<Value>
): TrustedWorkspaceServerDomainPackageEntry<Value> {
  return defineTrustedDomainProcessEntry('workspace-server', input)
}

export function defineInstalledWorkspaceServerDomainEntrySet<Value>(
  installed: InstalledDomainPackageSet,
  entries: readonly TrustedDomainProcessEntryInput<Value>[],
  hostApiVersion?: string
): InstalledDomainProcessEntrySet<'workspace-server', Value> {
  return defineInstalledDomainProcessEntrySet(
    installed,
    'workspace-server',
    entries,
    hostApiVersion
  )
}

export type DomainWorkspaceServerLogEntry = Readonly<{
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: unknown
}>

/**
 * Process-safe services available to trusted workspace-server contributions.
 *
 * Domain implementations receive no Electron APIs or host-private service
 * objects. Their runtime values are installed through generated composition.
 */
export type DomainWorkspaceServerHost = Readonly<{
  log(entry: DomainWorkspaceServerLogEntry): void
}>

export type DomainWorkspaceServerEntryFactory<Value = unknown> = (
  host: DomainWorkspaceServerHost
) => TrustedDomainProcessEntryInput<Value>

export type WorkspaceServerWorkspacePreviewPluginSlotContribution<
  Provider extends WorkspacePreviewProvider = WorkspacePreviewProvider
> = MainWorkspacePreviewPluginSlotContribution<Provider>
