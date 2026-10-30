/**
 * Renderer-safe projections of installed domain extensions.
 *
 * These contracts intentionally contain only bounded, serializable metadata.
 * Package manifests and executable contribution implementations stay in the
 * main process.
 */
export const DOMAIN_EXTENSION_SOURCES = ['bundled', 'user', 'development'] as const
export type DomainExtensionSource = typeof DOMAIN_EXTENSION_SOURCES[number]

export const DOMAIN_EXTENSION_VERIFICATIONS = ['bundled', 'official-signed', 'development-local'] as const
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
export const DOMAIN_EXTENSION_ACTIVATION_STATES = [
  'not-loaded', 'discovered', 'verified', 'enabled', 'activating', 'active',
  'deactivating', 'disabled', 'failed', 'disposed'
] as const
export type DomainExtensionActivationState = typeof DOMAIN_EXTENSION_ACTIVATION_STATES[number]

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
  permissions: readonly string[]
  contributionKinds: readonly string[]
  contributionCount: number
  canRollback: boolean
  enabled?: boolean
  generation?: number
  candidateVersion?: string
  restartRequired?: boolean
  permissionAllowed?: boolean
  permissionStatus?: 'approved' | 'denied' | 'unknown' | 'needs-approval'
  approvedPermissions?: readonly string[]
  deniedPermissions?: readonly string[]
  hostApiStatus?: 'compatible' | 'incompatible' | 'unknown' | 'adapter-required'
  installedAt?: string
  diagnostic?: string
  activationState?: DomainExtensionActivationState
  hostApi?: { minimum: string; maximumExclusive: string }
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

export type DomainExtensionCandidateInput = DomainExtensionPackageInput & {
  path: string
}

/** Renderer-safe descriptor for a currently active development UI contribution. */
export type DomainExtensionRendererContribution = {
  pluginId: string
  contributionId: string
  kind: 'panel' | 'tab'
  title: string
  generation: number
  version: string
  entryUrl: string
  stateVersion: number
}

/**
 * Value equality for the renderer-visible development contribution projection.
 *
 * The development contribution listing is polled; every poll deserializes a
 * fresh array, so reference comparison can never dedupe it. Renderers that hold
 * this list in state must compare by value, otherwise an unchanged listing
 * re-renders every subscribed tree on each poll.
 */
export function domainExtensionRendererContributionsEqual(
  left: readonly DomainExtensionRendererContribution[],
  right: readonly DomainExtensionRendererContribution[]
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((contribution, index) => {
    const other = right[index]
    return other !== undefined &&
      contribution.pluginId === other.pluginId &&
      contribution.contributionId === other.contributionId &&
      contribution.kind === other.kind &&
      contribution.title === other.title &&
      contribution.generation === other.generation &&
      contribution.version === other.version &&
      contribution.entryUrl === other.entryUrl &&
      contribution.stateVersion === other.stateVersion
  })
}

export type DomainExtensionInventoryRequest = Readonly<{
  pluginId: string
  contributionId: string
  generation: number
  version: string
}>

export type DomainExtensionsApi = {
  list: (input?: DomainExtensionInventoryRequest) => Promise<DomainExtensionSummary[]>
  install: (input: DomainExtensionInstallInput) => Promise<DomainExtensionSummary>
  uninstall: (input: DomainExtensionPackageInput) => Promise<void>
  rollback: (input: DomainExtensionPackageInput) => Promise<DomainExtensionSummary>
  setEnabled: (input: DomainExtensionSetEnabledInput) => Promise<DomainExtensionSummary>
  checkCandidate: (input: DomainExtensionCandidateInput) => Promise<DomainExtensionSummary>
  applyCandidate: (input: DomainExtensionPackageInput) => Promise<DomainExtensionSummary>
  cancelCandidate: (input: DomainExtensionPackageInput) => Promise<DomainExtensionSummary>
  updateStatus: (input: DomainExtensionPackageInput) => Promise<DomainExtensionSummary>
  rendererContributions?: () => Promise<DomainExtensionRendererContribution[]>
}
