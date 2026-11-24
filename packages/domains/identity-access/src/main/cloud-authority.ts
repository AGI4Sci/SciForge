import { AuthenticatedCloudTransportError } from '../authenticated-cloud-transport.js'

/** Private transport implementation; credentials and configured origin stay inside Identity. */
export type CloudTransportLease = Readonly<{
  fetch(path: string, init: RequestInit): Promise<Response>
  userId: string
  assertCurrent(): void
}>
export type WithCloudTransportLease = <T>(operation: (lease: CloudTransportLease) => Promise<T>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<T>

export async function readBoundedCloudBody(response: Response, maximumBytes: number, assertCurrent: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      assertCurrent()
      const chunk = await reader.read()
      assertCurrent()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > maximumBytes) throw new AuthenticatedCloudTransportError('cloud_response_invalid', 'Cloud response exceeded its bounded size.')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
}
