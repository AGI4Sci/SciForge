/**
 * Renderer-safe projections of installed domain extensions.
 *
 * These contracts intentionally contain only bounded, serializable metadata.
 * Package manifests and executable contribution implementations stay in the
 * main process.
 */
export const DOMAIN_EXTENSION_SOURCES = ['bundled', 'user'] as const
export type DomainExtensionSource = typeof DOMAIN_EXTENSION_SOURCES[number]

export const DOMAIN_EXTENSION_VERIFICATIONS = ['bundled', 'official-signed'] as const
export type DomainExtensionVerification = typeof DOMAIN_EXTENSION_VERIFICATIONS[number]

export const DOMAIN_EXTENSION_EXECUTIONS = ['trusted-compile-time', 'sandboxed-runtime'] as const
export type DomainExtensionExecution = typeof DOMAIN_EXTENSION_EXECUTIONS[number]

export const DOMAIN_EXTENSION_STATUSES = [
  'active',
  'installed',
  'disabled',
  'restart-required',
  'invalid'
] as const
export type DomainExtensionStatus = typeof DOMAIN_EXTENSION_STATUSES[number]

export type DomainExtensionPublisher = {
  id: string
  displayName: string
}

export type DomainExtensionSummary = {
  packageName: string
  moduleId: string
  moduleDisplayName: string
  version: string
  publisher: DomainExtensionPublisher
  source: DomainExtensionSource
  verification: DomainExtensionVerification
  execution: DomainExtensionExecution
  status: DomainExtensionStatus
  permissions: string[]
  contributionKinds: string[]
  contributionCount: number
  canRollback: boolean
  installedAt?: string
  diagnostic?: string
}

export type DomainExtensionInstallInput = {
  path: string
}

export type DomainExtensionPackageInput = {
  packageName: string
}

export type DomainExtensionSetEnabledInput = DomainExtensionPackageInput & {
  enabled: boolean
}

export type DomainExtensionsApi = {
  list: () => Promise<DomainExtensionSummary[]>
  install: (input: DomainExtensionInstallInput) => Promise<DomainExtensionSummary>
  uninstall: (input: DomainExtensionPackageInput) => Promise<void>
  rollback: (input: DomainExtensionPackageInput) => Promise<DomainExtensionSummary>
  setEnabled: (input: DomainExtensionSetEnabledInput) => Promise<DomainExtensionSummary>
}
