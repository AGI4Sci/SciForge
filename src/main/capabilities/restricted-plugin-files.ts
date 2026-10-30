import { isAbsolute, normalize, parse, sep } from 'node:path'

const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength'
)!.get!
const typedArrayElementType = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag
)!.get!

export interface PluginFileInvocationFacts {
  callerId: string
  sessionId: string
  invocationId: string
  packageName: string
  packageVersion: string
  generation: string
  signal?: AbortSignal
}
export interface PluginFileAuthorityOptions {
  profileRoot: string
  packageName: string
  packageVersion: string
  generation: string
  maxFileBytes: number
  maxInvocationBytes: number
  authenticate(snapshot: object): PluginFileInvocationFacts | undefined
}
export class PluginFileServiceError extends Error {
  constructor(public readonly code: string, public readonly reason?: string) { super(code) }
}

/** Host-only factory; do not expose an authority to plugin code or IPC.
 * No path-based Node fs implementation is enabled: ancestor substitution,
 * hardlink-after-fstat and atomic publication require a separate proof.
 * This API is not an OS sandbox.
 */
export function createRestrictedPluginFileAuthority(options: PluginFileAuthorityOptions) {
  const { maxFileBytes, maxInvocationBytes } = options
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0
    || !Number.isSafeInteger(maxInvocationBytes) || maxInvocationBytes <= 0
    || maxFileBytes > maxInvocationBytes) throw new PluginFileServiceError('file_contract_invalid')
  // Lexical authority binding only: no directory/inode/descriptor is opened.
  // A canonical path does not prove a filesystem binding; I/O remains blocked.
  const profileRoot = options.profileRoot
  function validateRoot() {
    const rootLength = typeof profileRoot === 'string' ? parse(profileRoot).root.length : 0
    if (typeof profileRoot !== 'string' || !isAbsolute(profileRoot)
      || profileRoot.includes('\u0000') || normalize(profileRoot) !== profileRoot
      || (profileRoot.length > rootLength && profileRoot.endsWith(sep)) || options.profileRoot !== profileRoot) {
      throw new PluginFileServiceError('file_contract_invalid')
    }
  }
  const identityKeys = ['callerId', 'sessionId', 'invocationId', 'packageName', 'packageVersion', 'generation'] as const
  const attemptedBytes = new Map<string, number>()
  const grants = new WeakMap<object, { snapshot: object; facts: PluginFileInvocationFacts }>()
  function authenticate(snapshot: object) {
    let current: PluginFileInvocationFacts | undefined
    try {
      current = options.authenticate(snapshot)
    } catch {
      throw new PluginFileServiceError('file_access_denied')
    }
    if (!current || identityKeys.some(key => typeof current[key] !== 'string' || !current[key])
      || current.packageName !== options.packageName || current.packageVersion !== options.packageVersion
      || current.generation !== options.generation) throw new PluginFileServiceError('file_access_denied')
    return Object.freeze({ ...current })
  }
  const blocked = async (grant: object, snapshot: object, path: string, bytes: number): Promise<never> => {
    validateRoot()
    const record = grants.get(grant)
    if (!record || record.snapshot !== snapshot) throw new PluginFileServiceError('file_access_denied')
    const current = authenticate(snapshot)
    if (identityKeys.some(key => current[key] !== record.facts[key])) throw new PluginFileServiceError('file_access_denied')
    // Cancellation wins over signal replacement, so a replaced live signal
    // cannot revive an aborted grant. Otherwise replacement/removal is denied.
    if (record.facts.signal?.aborted || current.signal?.aborted) throw new PluginFileServiceError('file_cancelled')
    if (current.signal !== record.facts.signal) throw new PluginFileServiceError('file_access_denied')
    if (typeof path !== 'string' || !path || /[\\:]/.test(path) || path.includes('\u0000')
      || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      throw new PluginFileServiceError('file_path_invalid')
    }
    const identity = JSON.stringify(identityKeys.map(key => record.facts[key]))
    const used = attemptedBytes.get(identity) ?? 0
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxFileBytes
      || bytes > maxInvocationBytes - used) throw new PluginFileServiceError('file_size_limit')
    attemptedBytes.set(identity, used + bytes)
    throw new PluginFileServiceError('file_service_blocked', 'descriptor_relative_executor_unavailable')
  }
  return {
    issueGrant: (snapshot: object): object => {
      validateRoot()
      const authenticated = authenticate(snapshot)
      const grant = Object.freeze({})
      grants.set(grant, { snapshot, facts: authenticated })
      return grant
    },
    files: Object.freeze({
      read: (grant: object, snapshot: object, path: string, maxBytes: number) => blocked(grant, snapshot, path, maxBytes),
      write: async (grant: object, snapshot: object, path: string, bytes: Uint8Array): Promise<never> => {
        let byteLength: number
        try {
          // Intrinsic internal element type survives realm/prototype changes and ignores own tags.
          if (typedArrayElementType.call(bytes) !== 'Uint8Array') throw new PluginFileServiceError('file_input_invalid')
          // The intrinsic getter checks the typed-array brand and ignores own properties.
          byteLength = typedArrayByteLength.call(bytes)
        } catch {
          throw new PluginFileServiceError('file_input_invalid')
        }
        return blocked(grant, snapshot, path, byteLength)
      },
      delete: (grant: object, snapshot: object, path: string) => blocked(grant, snapshot, path, 0)
    })
  }
}
