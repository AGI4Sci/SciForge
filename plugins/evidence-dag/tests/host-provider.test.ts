import { expect, it } from 'vitest'
import { EVIDENCE_PORTS_SERVICE_ID, createEvidencePortsService } from '@sciforge/domain-evidence-dag/host/host-provider'
import type { HostServiceClient } from '@sciforge/plugin-sdk'

it('runner-local EvidencePorts factory forwards requests and exact cancellation handles to the generic client', async () => {
  let release!: (value: unknown) => void
  const result = new Promise(resolve => { release = resolve })
  let cancellations = 0
  const seen: unknown[] = []
  const client: HostServiceClient = { request(...args) {
    seen.push(args)
    return { requestId: 'service-request', result, async cancel() { cancellations++; return { cancelled: true, quiescent: true } } }
  } }
  const ports = createEvidencePortsService(client, { identity: { pluginId: 'evidence', version: '1', profileId: 'host' }, storageRoot: '/private/evidence' })
  const request = { protocol: 'sciforge-evidence-ports.v1' as const, requestId: 'request', identity: ports.identity, operation: 'threads.read' as const, input: {} }
  const work = ports.request(request)
  expect(seen).toEqual([[EVIDENCE_PORTS_SERVICE_ID, 'threads.read', request]])
  expect(await ports.cancel(request.requestId)).toEqual({ cancelled: true, quiescent: true })
  expect(cancellations).toBe(1)
  release({ watermark: '1' })
  expect(await work).toEqual({ watermark: '1' })
  expect(await ports.cancel(request.requestId)).toEqual({ cancelled: false, quiescent: true })
  expect(ports.storageRoot).toBe('/private/evidence')
})
