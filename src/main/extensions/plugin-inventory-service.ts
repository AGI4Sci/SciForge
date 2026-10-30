import type { DomainExtensionSummary, DomainExtensionsApi } from '../../shared/domain-extensions'

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T

function freezeSnapshot<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child)
    Object.freeze(value)
  }
  return value as Immutable<T>
}

type PublicInventorySummary = Omit<DomainExtensionSummary, 'diagnostic'>

/** Explicit public fields: never forward arbitrary Host diagnostics or future fields. */
function projectSummary(row: DomainExtensionSummary): PublicInventorySummary {
  return {
    packageName: row.packageName, moduleId: row.moduleId, moduleDisplayName: row.moduleDisplayName,
    version: row.version, publisher: { id: row.publisher.id, displayName: row.publisher.displayName },
    source: row.source, verification: row.verification, execution: row.execution, status: row.status,
    permissions: [...row.permissions], contributionKinds: [...row.contributionKinds],
    contributionCount: row.contributionCount, canRollback: row.canRollback,
    ...(row.enabled !== undefined ? { enabled: row.enabled } : {}),
    ...(row.generation !== undefined ? { generation: row.generation } : {}),
    ...(row.candidateVersion !== undefined ? { candidateVersion: row.candidateVersion } : {}),
    ...(row.restartRequired !== undefined ? { restartRequired: row.restartRequired } : {}),
    ...(row.permissionAllowed !== undefined ? { permissionAllowed: row.permissionAllowed } : {}),
    ...(row.permissionStatus !== undefined ? { permissionStatus: row.permissionStatus } : {}),
    ...(row.approvedPermissions !== undefined ? { approvedPermissions: [...row.approvedPermissions] } : {}),
    ...(row.deniedPermissions !== undefined ? { deniedPermissions: [...row.deniedPermissions] } : {}),
    ...(row.hostApiStatus !== undefined ? { hostApiStatus: row.hostApiStatus } : {}),
    ...(row.installedAt !== undefined ? { installedAt: row.installedAt } : {}),
    ...(row.activationState !== undefined ? { activationState: row.activationState } : {}),
    ...(row.hostApi !== undefined ? { hostApi: { minimum: row.hostApi.minimum, maximumExclusive: row.hostApi.maximumExclusive } } : {})
  }
}

type InventoryAdmission = Readonly<{
  caller: string
  packageName: string
  version: string
  generation: number
  lease: object
  signal: AbortSignal
}>

export class PluginInventoryAccessError extends Error {
  readonly code = 'PLUGIN_INVENTORY_ACCESS_REVOKED'

  constructor() {
    super('Plugin inventory access is no longer valid.')
    this.name = 'PluginInventoryAccessError'
  }
}

class PluginInventoryUnavailableError extends Error {
  readonly code = 'PLUGIN_INVENTORY_UNAVAILABLE'

  constructor() {
    super('Plugin inventory is unavailable.')
    this.name = 'PluginInventoryUnavailableError'
  }
}

/** Host-owned read-only projection over the one canonical extension inventory. */
export function createPluginInventoryService(
  api: Pick<DomainExtensionsApi, 'list'>,
  captureAdmission: () => InventoryAdmission | undefined,
  isAdmissionCurrent: (admission: InventoryAdmission) => boolean
): Readonly<{ list(): Promise<Immutable<PublicInventorySummary[]>> }> {
  const authorized = (admission: InventoryAdmission): boolean => {
    let result: unknown
    try { result = isAdmissionCurrent(admission) }
    catch { throw new PluginInventoryAccessError() }
    if (result !== true) {
      // Observe rejected promises without accepting asynchronous authorization.
      void Promise.resolve(result).catch(() => {})
      return false
    }
    return true
  }
  return Object.freeze({
    async list(): Promise<Immutable<PublicInventorySummary[]>> {
      let admission: InventoryAdmission | undefined
      try {
        const fact = captureAdmission()
        admission = fact && Object.freeze({
          caller: fact.caller, packageName: fact.packageName, version: fact.version,
          generation: fact.generation, lease: fact.lease, signal: fact.signal
        })
      } catch { throw new PluginInventoryAccessError() }
      if (!admission || !(admission.signal instanceof AbortSignal) || admission.signal.aborted || !authorized(admission) || admission.signal.aborted) throw new PluginInventoryAccessError()
      // Cancellation settles this read; list() does not promise provider interruption.
      const signal = admission.signal
      const inventory = await new Promise<DomainExtensionSummary[]>((resolve, reject) => {
        const cleanup = (): void => signal.removeEventListener('abort', abort)
        const abort = (): void => { cleanup(); reject(new PluginInventoryAccessError()) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) { abort(); return }
        try {
          Promise.resolve(api.list()).then(
            rows => { cleanup(); resolve(rows) },
            () => { cleanup(); reject(new PluginInventoryUnavailableError()) }
          )
        } catch {
          cleanup()
          reject(new PluginInventoryUnavailableError())
        }
      })
      if (admission.signal.aborted || !authorized(admission) || admission.signal.aborted) throw new PluginInventoryAccessError()
      try { return freezeSnapshot(structuredClone(inventory.map(projectSummary))) }
      catch { throw new PluginInventoryUnavailableError() }
    }
  })
}
