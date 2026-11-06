/**
 * The network seam for product-feedback submission.
 *
 * The static package talks HTTPS through `globalThis.fetch`; the plugin never
 * reaches for the global. The adapter hands `FeedbackGatewayClient` a `fetch`
 * implementation obtained from this port:
 *
 * - `createNodeNetworkPort()` — the host/agent binding (real `globalThis.fetch`);
 * - `createFixtureNetworkPort()` — the DSH test binding. It records every
 *   request and replays scripted responses, so no socket is ever opened.
 *
 * HTTPS-only validation stays in `feedback-gateway-client.ts`; the port cannot
 * weaken it.
 */
export type FeedbackNetworkRequest = Readonly<{
  url: string
  init: RequestInit
}>

export type FeedbackNetworkPort = Readonly<{
  fetch: typeof fetch
}>

export function createNodeNetworkPort(): FeedbackNetworkPort {
  return Object.freeze({
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init)) as typeof fetch
  })
}

export type FixtureNetworkRoute = (
  request: FeedbackNetworkRequest
) => Response | Promise<Response>

export type FixtureNetworkPort = FeedbackNetworkPort &
  Readonly<{ requests: readonly FeedbackNetworkRequest[] }>

/** Scripted binding used by the DSH tests; it never touches the network. */
export function createFixtureNetworkPort(
  route: FixtureNetworkRoute
): FixtureNetworkPort {
  const requests: FeedbackNetworkRequest[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = Object.freeze({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      init: init ?? {}
    })
    requests.push(request)
    return route(request)
  }) as typeof fetch
  return Object.freeze({ fetch: fetchImpl, requests })
}