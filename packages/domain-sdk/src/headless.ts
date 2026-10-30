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

/** Generic manifest kind for a package-owned long-lived process launcher. */
export const HEADLESS_SERVICE_CONTRIBUTION_KIND = 'headless.service' as const

export type InstalledHeadlessDomainContribution = InstalledDomainContribution<'headless'>

export function installedHeadlessDomainContributions(
  installed: InstalledDomainPackageSet
): readonly InstalledHeadlessDomainContribution[] {
  return installed.contributionsFor('headless')
}

export type TrustedHeadlessDomainPackageEntry<Value> =
  TrustedDomainProcessEntry<'headless', Value>

export function defineTrustedHeadlessDomainPackageEntry<Value>(
  input: TrustedDomainProcessEntryInput<Value>
): TrustedHeadlessDomainPackageEntry<Value> {
  return defineTrustedDomainProcessEntry('headless', input)
}

export function defineInstalledHeadlessDomainEntrySet<Value>(
  installed: InstalledDomainPackageSet,
  entries: readonly TrustedDomainProcessEntryInput<Value>[],
  hostApiVersion?: string
): InstalledDomainProcessEntrySet<'headless', Value> {
  return defineInstalledDomainProcessEntrySet(
    installed,
    'headless',
    entries,
    hostApiVersion
  )
}

/** Host-independent logging boundary available to a headless package. */
export type DomainHeadlessHost = Readonly<{
  log(entry: Readonly<{
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    detail?: unknown
  }>): void
}>

export type DomainHeadlessEntryFactory<Value = unknown> = (
  host: DomainHeadlessHost
) => TrustedDomainProcessEntryInput<Value>
