import type { HostServiceClient } from '@sciforge/plugin-sdk'
import type { EvidencePorts, Identity, Json, PortRequest } from './ports.js'

export const EVIDENCE_PORTS_SERVICE_ID = 'evidenceDagPorts' as const

/** Runner-local composition factory; all execution remains in the Host-owned service. */
export function createEvidencePortsService(client: HostServiceClient, config: { identity: Identity; storageRoot: string }): EvidencePorts {
  return createHostBoundEvidencePortsClient(client, config.identity, config.storageRoot)
}

export function createHostBoundEvidencePortsClient(client: HostServiceClient, identity: Identity, storageRoot: string): EvidencePorts {
  const pending = new Map<string, ReturnType<HostServiceClient['request']>>()
  return Object.freeze({
    identity,
    storageRoot,
    request: async (request: PortRequest) => {
      const handle = client.request(EVIDENCE_PORTS_SERVICE_ID, request.operation, request)
      pending.set(request.requestId, handle)
      try { return await handle.result as Json } finally { pending.delete(request.requestId) }
    },
    cancel: async (requestId: string) => {
      const handle = pending.get(requestId)
      return handle ? await handle.cancel() : { cancelled: false, quiescent: true }
    }
  })
}
