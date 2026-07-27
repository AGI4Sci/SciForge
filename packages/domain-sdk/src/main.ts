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

export type InstalledMainDomainContribution = InstalledDomainContribution<'main'>

export function installedMainDomainContributions(
  installed: InstalledDomainPackageSet
): readonly InstalledMainDomainContribution[] {
  return installed.contributionsFor('main')
}

export type TrustedMainDomainPackageEntry<Value> = TrustedDomainProcessEntry<'main', Value>

export function defineTrustedMainDomainPackageEntry<Value>(
  input: TrustedDomainProcessEntryInput<Value>
): TrustedMainDomainPackageEntry<Value> {
  return defineTrustedDomainProcessEntry('main', input)
}

export function defineInstalledMainDomainEntrySet<Value>(
  installed: InstalledDomainPackageSet,
  entries: readonly TrustedDomainProcessEntryInput<Value>[],
  hostApiVersion?: string
): InstalledDomainProcessEntrySet<'main', Value> {
  return defineInstalledDomainProcessEntrySet(installed, 'main', entries, hostApiVersion)
}
