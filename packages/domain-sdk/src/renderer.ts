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
