import { z } from 'zod'
import { AuthenticatedCloudTransportError } from '../authenticated-cloud-transport.js'
import { readBoundedCloudBody, type WithCloudTransportLease } from './cloud-authority.js'

export function requestCloudJson<T>(withLease: WithCloudTransportLease, request: {
  path: string
  body?: unknown
  schema: z.ZodType<T>
  validate: (result: T, userId: string) => boolean
  maximumBytes: number
  rejections?: readonly Readonly<{ status: number; code: string; message: string }>[]
}, options?: Readonly<{ signal?: AbortSignal }>): Promise<T> {
  const deadline = AbortSignal.timeout(30_000)
  const signal = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  return withLease(async lease => {
    lease.assertCurrent()
    const response = await lease.fetch(request.path, {
      method: request.body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
    })
    lease.assertCurrent()
    const bytes = await readBoundedCloudBody(response, request.maximumBytes, lease.assertCurrent)
    let body: unknown
    try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { /* Never reflect a server response. */ }
    if (response.status < 200 || response.status >= 300) {
      const error = z.object({ error: z.object({ code: z.literal('space_not_ready') }) }).safeParse(body)
      if (response.status === 409 && error.success) throw new AuthenticatedCloudTransportError('space_not_ready', 'The cloud space is not ready. Check its provisioning status and retry when ready.')
      const rejection = z.object({ error: z.object({ code: z.string().max(80) }) }).safeParse(body)
      const known = rejection.success ? request.rejections?.find(item => item.status === response.status && item.code === rejection.data.error.code) : undefined
      if (known) throw new AuthenticatedCloudTransportError(response.status < 500 ? 'cloud_rejected' : 'cloud_unavailable', known.message)
      throw new AuthenticatedCloudTransportError(
        response.status >= 400 && response.status < 500 ? 'cloud_rejected' : 'cloud_unavailable',
        `Cloud access returned HTTP ${response.status}.`)
    }
    const parsed = request.schema.safeParse(body)
    if (!parsed.success || !request.validate(parsed.data, lease.userId)) {
      throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud returned invalid or mismatched metadata.')
    }
    lease.assertCurrent()
    return parsed.data
  }, { signal })
}
