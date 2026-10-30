import { PLUGIN_CAPABILITY_DESCRIPTORS } from './descriptors.js'
import { pluginHandlers } from './handlers.js'

/**
 * Runtime-plugin entry (named-runner contract shape, verified against the real
 * host in the 2026-10-12 workspace-write spike): named lifecycle exports plus
 * getCapabilityDefinitions() returning { descriptor, handler } pairs.
 *
 * The native DSH Cordis entry (dsh-tool projection) cannot carry these
 * capabilities: it forces scope 'global' + effect 'compute'. See README.
 */

let active = false

export async function activate(): Promise<void> {
  active = true
}

export async function deactivate(): Promise<void> {
  active = false
}

export async function unregister(): Promise<void> {
  active = false
}

export async function dispose(): Promise<void> {
  active = false
}

export function getCapabilityDefinitions() {
  return PLUGIN_CAPABILITY_DESCRIPTORS.map((descriptor) => ({
    descriptor,
    handler: async (input: unknown) => {
      if (!active) throw new Error('Biology Room plugin is not active.')
      const handler = pluginHandlers[descriptor.id]
      if (!handler) throw new Error(`Biology Room plugin has no handler for ${descriptor.id}.`)
      return handler(input)
    }
  }))
}
