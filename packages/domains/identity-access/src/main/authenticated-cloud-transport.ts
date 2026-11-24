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
    lookupDocumentShare: (input, executionOptions) => getRuntime().lookupDocumentShare(input, executionOptions),
    createDocumentShare: (input, executionOptions) => getRuntime().createDocumentShare(input, executionOptions),
    revokeDocumentShare: (input, executionOptions) => getRuntime().revokeDocumentShare(input, executionOptions),
    readDocumentComments: (input, executionOptions) => getRuntime().readDocumentComments(input, executionOptions),
    mutateDocumentComments: (input, executionOptions) => getRuntime().mutateDocumentComments(input, executionOptions),

    listCloudSpaces: executionOptions => getRuntime().listAuthenticatedCloudSpaces(executionOptions),
    ensureCloudSpace: (input, executionOptions) => getRuntime().ensureAuthenticatedCloudSpace(input, executionOptions),
    createCloudSpaceSession: (input, executionOptions) => getRuntime().createAuthenticatedCloudSpaceSession(input, executionOptions),
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
