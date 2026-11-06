import { AuthenticatedCloudTransportError } from '../authenticated-cloud-transport.js'

/** Retry only a failure to establish a connection, before any command was sent.
 * Socket/body failures have an unknown outcome and must not be replayed here.
 * Both attempts share the caller's deadline and authority-cancellation signal.
 */
export async function fetchCloudCommand(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { signal: AbortSignal }
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    init.signal.throwIfAborted()
    try {
      return await fetchImpl(url, init)
    } catch (error) {
      init.signal.throwIfAborted()
      const cause = error instanceof Error ? error.cause : undefined
      if (!cause || typeof cause !== 'object' || !('code' in cause) ||
          cause.code !== 'UND_ERR_CONNECT_TIMEOUT') throw error
      if (attempt === 1) {
        throw new AuthenticatedCloudTransportError(
          'cloud_timeout', 'The connection to SciForge Cloud timed out after one retry.', { cause: error }
        )
      }
    }
  }
}
