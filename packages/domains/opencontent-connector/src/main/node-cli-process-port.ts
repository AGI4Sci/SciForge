import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR
} from './bundled-assets.js'
import {
  createNodeOpenContentCliProcessPortInternal
} from './node-cli-process-port.internal.js'
import type {
  OpenContentCliProcessPort as OpenContentCliProcessPortContract
} from './cli-runner.js'

export { OpenContentCliProcessError } from './node-cli-process-port.internal.js'

export type NodeOpenContentCliProcessPortOptions = Readonly<{
  /** Fixed, trusted snapshot entrypoint resolved by the Connector. */
  trustedEntrypoint: string
  /** Fixed Host-provided Node-capable executable. Never taken from an invocation. */
  executablePath?: string
  /** Electron production hosts set this so their executable behaves as Node. */
  electronRunAsNode?: boolean
  /** Trusted Host root under which per-invocation private directories are created. */
  temporaryRoot?: string
  /** Host cleanup implementation; production defaults to bounded recursive removal. */
  removeInvocationRoot?: (path: string) => Promise<void>
  /** Values may only tighten the fixed production ceilings. */
  managedTokenLimits?: Readonly<{
    maxEntries: number
    maxBytes: number
  }>
  now?: () => number
}>

export interface NodeOpenContentCliProcessPort extends OpenContentCliProcessPortContract {
  /** Removes in-memory, unexpired probe/plan material. */
  dispose(): void
}

/** The only public factory always binds the package-owned immutable runtime descriptor. */
export function createNodeOpenContentCliProcessPort(
  options: NodeOpenContentCliProcessPortOptions
): NodeOpenContentCliProcessPort {
  return createNodeOpenContentCliProcessPortInternal({
    trustedEntrypoint: options.trustedEntrypoint,
    ...(options.executablePath === undefined
      ? {}
      : { executablePath: options.executablePath }),
    ...(options.electronRunAsNode === undefined
      ? {}
      : { electronRunAsNode: options.electronRunAsNode }),
    ...(options.temporaryRoot === undefined
      ? {}
      : { temporaryRoot: options.temporaryRoot }),
    ...(options.removeInvocationRoot === undefined
      ? {}
      : { removeInvocationRoot: options.removeInvocationRoot }),
    ...(options.managedTokenLimits === undefined
      ? {}
      : { managedTokenLimits: options.managedTokenLimits }),
    ...(options.now === undefined ? {} : { now: options.now }),
    trustedSnapshotIntegrity:
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.trustedRuntimeFiles
  })
}
