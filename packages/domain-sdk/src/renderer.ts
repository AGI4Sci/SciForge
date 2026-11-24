import type { DomainRendererWorkbenchSession, DomainRendererWorkbenchSurfaceActivation, DomainRendererWorkbenchSessionDockRequest } from './renderer-contributions.js'
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

export type { TrustedDomainProcessEntryInput } from './process-entry.js'
export * from './controlled-process.js'
export * from './renderer-contributions.js'
export * from './code-selection.js'
export * from './version-control.js'
export * from './native-viewport-geometry.js'

export type DomainRendererWorkbenchMainAreaRenderContext<View = unknown> = Readonly<{
  /** Current Host conversation, including an opaque stable identity for an unsent draft. */
  session?: DomainRendererWorkbenchSession
  /** The page is in the foreground; hidden pages stay mounted to keep their state. */
  active: boolean
  /** Actual presentation document; changes when the existing page moves to an auxiliary window. */
  ownerDocument?: Document
  /** Opaque, package-owned navigation state, for example returning from its Session. */
  activation?: DomainRendererWorkbenchSurfaceActivation
  /**
   * Put on the page root so it fills the main area edge to edge. The main area
   * also sets `--ds-main-area-leading-inset`: the width at the top-left corner
   * that window controls still cover, which the page keeps free of controls.
   */
  className: string
  renderSessionDock: (request: DomainRendererWorkbenchSessionDockRequest<View>) => View
}>

export type DomainRendererWorkbenchMainAreaValue<View = unknown> = Readonly<{
  render: (context: DomainRendererWorkbenchMainAreaRenderContext<View>) => View
}>

export type InstalledRendererDomainContribution = InstalledDomainContribution<'renderer'>

export function installedRendererDomainContributions(
  installed: InstalledDomainPackageSet
): readonly InstalledRendererDomainContribution[] {
  return installed.contributionsFor('renderer')
}

export type TrustedRendererDomainPackageEntry<Value> = TrustedDomainProcessEntry<'renderer', Value>

export function defineTrustedRendererDomainPackageEntry<Value>(
  input: TrustedDomainProcessEntryInput<Value>
): TrustedRendererDomainPackageEntry<Value> {
  return defineTrustedDomainProcessEntry('renderer', input)
}

export function defineInstalledRendererDomainEntrySet<Value>(
  installed: InstalledDomainPackageSet,
  entries: readonly TrustedDomainProcessEntryInput<Value>[],
  hostApiVersion?: string
): InstalledDomainProcessEntrySet<'renderer', Value> {
  return defineInstalledDomainProcessEntrySet(installed, 'renderer', entries, hostApiVersion)
}
