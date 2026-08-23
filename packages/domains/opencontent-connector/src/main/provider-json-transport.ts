import { OpenContentConnectorError } from '../contract.js'

export const OPENCONTENT_PROVIDER_REQUEST_TIMEOUT_MS = 15_000

const MAX_PROVIDER_JSON_RESPONSE_BYTES = 1_000_000

type ConnectorErrorCode = ConstructorParameters<typeof OpenContentConnectorError>[0]
type ConnectorErrorFactory = (code: ConnectorErrorCode) => OpenContentConnectorError

type ProviderRequestInput = Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  path: string
  method?: 'GET' | 'POST'
  query?: Readonly<Record<string, string>>
  headers?: Readonly<Record<string, string>>
  body?: BodyInit
  signal?: AbortSignal
  timeoutMs?: number
  assertPrincipalCurrent?: () => void | Promise<void>
  http409IsConflict?: boolean
  errorFactory: ConnectorErrorFactory
}>

export async function requestOpenContentProviderJson(
  input: ProviderRequestInput
): Promise<unknown> {
  const response = await requestOpenContentProviderResponse(input)
  const text = await readBoundedResponseText(
    response,
    input.signal,
    input.errorFactory
  )
  try {
    return JSON.parse(text)
  } catch {
    throw input.errorFactory('provider_contract_violation')
  }
}

export async function requestOpenContentProviderResponse(
  input: ProviderRequestInput
): Promise<Response> {
  const url = new URL(input.path, input.baseUrl)
  for (const [name, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(name, value)
  }
  const timeout = AbortSignal.timeout(
    input.timeoutMs ?? OPENCONTENT_PROVIDER_REQUEST_TIMEOUT_MS
  )
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  if (input.assertPrincipalCurrent) {
    try {
      await input.assertPrincipalCurrent()
    } catch {
      throw input.errorFactory('unauthorized')
    }
  }
  let response: Response
  try {
    response = await input.fetchImplementation(url, {
      method: input.method ?? 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.body === undefined ? {} : { body: input.body })
    })
  } catch {
    if (input.signal?.aborted) throw input.errorFactory('cancelled')
    throw input.errorFactory('provider_unavailable')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw input.errorFactory('unauthorized')
    }
    if (response.status === 429) throw input.errorFactory('rate_limited')
    if (response.status === 409 && input.http409IsConflict) {
      throw input.errorFactory('conflict')
    }
    throw input.errorFactory('provider_unavailable')
  }
  return response
}

async function readBoundedResponseText(
  response: Response,
  callerSignal: AbortSignal | undefined,
  errorFactory: ConnectorErrorFactory
): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const validLength = /^\d+$/u.test(declaredLength)
      ? Number(declaredLength)
      : Number.NaN
    if (!Number.isSafeInteger(validLength) ||
      validLength > MAX_PROVIDER_JSON_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw errorFactory('provider_contract_violation')
    }
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_PROVIDER_JSON_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw errorFactory('provider_contract_violation')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof OpenContentConnectorError) throw error
    if (callerSignal?.aborted) throw errorFactory('cancelled')
    throw errorFactory('provider_unavailable')
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw errorFactory('provider_contract_violation')
  }
}
