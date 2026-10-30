import {
  AuthenticatedCloudTransportError,
  defineAuthenticatedCloudTransport,
  type AuthenticatedCloudTransport
} from '../authenticated-cloud-transport.js'
import type { CloudIdentityRuntime } from './cloud-runtime.js'

export function createIdentityAuthenticatedCloudTransport(options: Readonly<{
  getRuntime: () => CloudIdentityRuntime | null
}>): AuthenticatedCloudTransport {
  const getRuntime = (): CloudIdentityRuntime => {
    const runtime = options.getRuntime()
    if (!runtime) throw new AuthenticatedCloudTransportError('transport_unavailable', 'Cloud identity runtime is not active.')
    return runtime
  }
  return defineAuthenticatedCloudTransport({
    stageObject: (input, executionOptions) => getRuntime().stageAuthenticatedCloudObject(input, executionOptions),
    readObject: (input, executionOptions) => getRuntime().readAuthenticatedCloudObject(input, executionOptions),
    status: () => options.getRuntime()?.authenticatedCloudTransportStatus() ?? {
      state: 'unavailable',
      reason: 'Cloud identity runtime is not active.'
    },
    execute: async (request, executionOptions) => {
      const runtime = options.getRuntime()
      if (!runtime) {
        throw new AuthenticatedCloudTransportError(
          'transport_unavailable',
          'Cloud identity runtime is not active.'
        )
      }
      return runtime.executeAuthenticatedCloud(request, executionOptions)
    }
  })
}
