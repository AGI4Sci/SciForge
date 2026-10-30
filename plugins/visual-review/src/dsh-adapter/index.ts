import { PLUGIN_CAPABILITY_DESCRIPTORS } from './descriptors.js'
import { pluginHandlers, setVisualReviewPorts } from './handlers.js'
import { autoWireHostPorts } from './host-ports-autowire.js'

// Connect the host ports bridge when the runner injected it (reference
// implementation); no-op when the bridge is absent, keeping fail-closed.
autoWireHostPorts()

/**
 * Runtime-plugin entry (named-runner contract shape, verified against the real
 * host in the 2026-10-12 workspace-write spike): named lifecycle exports plus
 * getCapabilityDefinitions() returning { descriptor, handler } pairs.
 *
 * The native DSH Cordis entry (dsh-tool projection) cannot carry these
 * capabilities: it forces scope 'global' + effect 'compute'. See README.
 *
 * setVisualReviewPorts is re-exported as the plugin entry surface for the
 * future host bridge (#53 HOST-PORTS line): the host injects the approved
 * VisualReviewPorts connection once the generalized bridge ships.
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

export { setVisualReviewPorts }

export function getCapabilityDefinitions() {
  return PLUGIN_CAPABILITY_DESCRIPTORS.map((descriptor) => ({
    descriptor,
    handler: async (input: unknown) => {
      if (!active) throw new Error('Visual Review plugin is not active.')
      const handler = pluginHandlers[descriptor.id]
      if (!handler) throw new Error(`Visual Review plugin has no handler for ${descriptor.id}.`)
      return handler(input)
    }
  }))
}
