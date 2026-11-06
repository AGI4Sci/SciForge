/**
 * Trusted Host-service client factory (service-agnostic).
 *
 * The runner imports this module from a Host-chosen absolute path and exposes
 * the returned object as the Cordis service named by `config.serviceId`. It is
 * deliberately thin: the Host provider still owns authority (package, caller
 * workspace, tool effect) and every request is correlated with the live
 * invocation by the runner.
 *
 * The module lives in the repository for the source/dev host and is copied to
 * `<resources>/extensions/host-service-client.mjs` for packaged builds, because
 * a plain Node child cannot import from inside app.asar.
 */
export function createHostServiceClient(hostServices, config) {
  const serviceId = config?.serviceId
  if (typeof serviceId !== 'string' || !serviceId.trim()) {
    throw new Error('Host service client requires a serviceId.')
  }
  if (!hostServices || typeof hostServices.request !== 'function') {
    throw new Error('Host service channel is unavailable.')
  }
  return Object.freeze({
    serviceId,
    /** Returns the runner handle so callers can await `result` or cancel. */
    request(operation, input) {
      if (typeof operation !== 'string' || !operation.trim()) {
        throw new Error('Host service client requires an operation.')
      }
      return hostServices.request(serviceId, operation, input)
    },
    async invoke(operation, input) {
      return await this.request(operation, input).result
    }
  })
}