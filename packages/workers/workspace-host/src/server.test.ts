import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  WorkspaceHostOperationError,
  type WorkspaceHostEvent
} from '@sciforge/domain-sdk/workspace-host'

import {
  WorkspaceHostClientError,
  WorkspaceHostJsonlClient
} from './client.js'
import { WorkspaceHostJsonlServer } from './server.js'
import { WorkspaceHostService } from './service.js'

describe('Workspace Host JSONL transport', () => {
  it('handshakes, validates acknowledgements, and replays after reconnect', async () => {
    const fixture = await createTransportFixture(8)
    try {
      const client = await fixture.connect()
      const first = waitForEvent(client)
      const emitted = fixture.service.publishEvent(
        WORKSPACE_HOST_EVENT_KINDS.fileChanged,
        { path: 'data.txt', change: 'change' }
      )
      assert.equal((await first).sequence, emitted.seq)
      await client.acknowledge(emitted.seq)

      const replayed = waitForEvent(client)
      await client.reconnect({ lastAcknowledgedSequence: 0 })
      assert.equal((await replayed).sequence, emitted.seq)
      await client.close()

      const invalidAckFixture = await createTransportFixture(8)
      try {
        const invalidClient = await invalidAckFixture.connect()
        await invalidClient.acknowledge(999)
        const run = await invalidAckFixture.runs[0]
        assert.equal(run.ok, false)
        await invalidClient.close()
      } finally {
        await invalidAckFixture.cleanup()
      }
    } finally {
      await fixture.cleanup()
    }
  })

  it('returns a typed replay gap when the bounded journal evicts events', async () => {
    const fixture = await createTransportFixture(2)
    try {
      const client = await fixture.connect()
      fixture.service.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, { path: 'a' })
      fixture.service.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, { path: 'b' })
      fixture.service.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, { path: 'c' })
      await assert.rejects(
        client.reconnect({ lastAcknowledgedSequence: 0 }),
        (error: unknown) =>
          error instanceof WorkspaceHostClientError
          && error.code === 'replay-gap'
      )
      await client.close()
    } finally {
      await fixture.cleanup()
    }
  })

  it('injects an unexpired scoped proxy only into process environment and clears it on close', async () => {
    const fixture = await createTransportFixture(2)
    const token = 'a'.repeat(48)
    try {
      const client = await fixture.connect({
        egressMode: 'local',
        egressAccess: {
          mode: 'local',
          proxyEndpoint: 'http://127.0.0.1:43123/',
          authorization: { scheme: 'bearer', token },
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      })
      const environment = fixture.service.processes.currentEnvironment()
      assert.match(environment.HTTPS_PROXY ?? '', /^http:\/\/sciforge-lease:/)
      assert.match(environment.HTTPS_PROXY ?? '', /@127\.0\.0\.1:43123$/)
      assert.equal(JSON.stringify(client.getSession()).includes(token), false)
      await client.close()
      await fixture.runs[0]
      assert.equal(fixture.service.processes.currentEnvironment().HTTPS_PROXY, undefined)

      await assert.rejects(
        fixture.connect({
          egressMode: 'local',
          egressAccess: {
            mode: 'local',
            proxyEndpoint: 'http://127.0.0.1:43123/',
            authorization: { scheme: 'bearer', token },
            expiresAt: new Date(Date.now() - 1_000).toISOString()
          }
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostClientError
          && error.code === 'egress-unavailable'
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('renews and revokes scoped egress and model access without journaling secrets', async () => {
    const fixture = await createTransportFixture(2)
    const egressToken = 'e'.repeat(48)
    const modelToken = 'm'.repeat(48)
    const firstExpiry = new Date(Date.now() + 60_000).toISOString()
    const renewedExpiry = new Date(Date.now() + 120_000).toISOString()
    try {
      const client = await fixture.connect({
        egressMode: 'local',
        egressAccess: {
          mode: 'local',
          proxyEndpoint: 'http://127.0.0.1:43123/',
          authorization: { scheme: 'bearer', token: egressToken },
          expiresAt: firstExpiry
        },
        modelAccess: {
          baseUrl: 'http://127.0.0.1:44219/v1',
          authorization: { scheme: 'bearer', token: modelToken },
          expiresAt: firstExpiry
        }
      })
      assert.equal(fixture.service.processes.isNetworkEgressReady(), true)
      assert.equal(fixture.service.isModelAccessReady(), true)
      assert.equal(fixture.service.currentModelAccess()?.authorization.token, modelToken)
      assert.equal(
        JSON.stringify(fixture.service.processes.currentEnvironment()).includes(modelToken),
        false
      )
      assert.equal(JSON.stringify(client.getSession()).includes(egressToken), false)
      assert.equal(JSON.stringify(client.getSession()).includes(modelToken), false)
      const sequence = fixture.service.journal.latestSeq

      await client.renewEgress(renewedExpiry)
      await client.renewModelAccess(renewedExpiry)
      await waitUntil(() =>
        fixture.service.currentModelAccess()?.expiresAt === renewedExpiry
      )
      assert.equal(fixture.service.processes.isNetworkEgressReady(), true)
      assert.equal(fixture.service.journal.latestSeq, sequence)

      await client.revokeEgress()
      await client.revokeModelAccess()
      await waitUntil(() =>
        !fixture.service.processes.isNetworkEgressReady()
        && !fixture.service.isModelAccessReady()
      )
      assert.equal(fixture.service.journal.latestSeq, sequence)
      await client.close()
      await fixture.runs[0]
    } finally {
      await fixture.cleanup()
    }
  })

  it('preserves canonical package-owned failure codes on the wire', async () => {
    const fixture = await createTransportFixture(2)
    try {
      fixture.service.registerOperation({
        operation: WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
        handler() {
          throw new WorkspaceHostOperationError({
            code: 'model-access-unavailable',
            message: 'Scoped model access is unavailable.',
            retryable: true
          })
        }
      })
      const client = await fixture.connect()
      await assert.rejects(
        client.request(WORKSPACE_HOST_OPERATIONS.runtimeInvoke, {
          contractVersion: 1,
          runtimeId: 'codex',
          method: 'usage'
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostClientError
          && error.code === 'model-access-unavailable'
          && error.retryable
      )
      await client.close()
    } finally {
      await fixture.cleanup()
    }
  })
})

async function createTransportFixture(journalCapacity: number) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-transport-'))
  const service = await WorkspaceHostService.create({
    workspaceRoot,
    lifecycleMode: 'persistent-daemon',
    journalCapacity
  })
  const runs: Array<Promise<{ ok: true } | { ok: false; error: Error }>> = []
  const connect = (
    overrides: Partial<{
      egressMode: 'none' | 'local' | 'remote-target'
      egressAccess: {
        mode: 'local' | 'remote-target'
        proxyEndpoint: string
        authorization: { scheme: 'bearer'; token: string }
        expiresAt: string
      }
      modelAccess: {
        baseUrl: string
        authorization: { scheme: 'bearer'; token: string }
        expiresAt: string
      }
    }> = {}
  ) => WorkspaceHostJsonlClient.connect({
    handshake: {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      clientVersion: '0.1.0',
      workspaceRoot,
      contributions: [],
      egressMode: overrides.egressMode ?? 'none',
      ...(overrides.egressAccess ? { egressAccess: overrides.egressAccess } : {}),
      ...(overrides.modelAccess ? { modelAccess: overrides.modelAccess } : {})
    },
    createTransport: async (handshake) => {
      const clientToServer = new PassThrough()
      const serverToClient = new PassThrough()
      const server = new WorkspaceHostJsonlServer({
        service,
        input: clientToServer,
        output: serverToClient,
        egressState: {
          mode: handshake.egressMode,
          status: handshake.egressMode === 'none' ? 'disabled' : 'connecting'
        },
        disposeServiceOnClose: false
      })
      runs.push(server.run().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error : new Error(String(error))
        })
      ))
      return { input: serverToClient, output: clientToServer }
    }
  })
  return {
    workspaceRoot,
    service,
    runs,
    connect,
    async cleanup() {
      service.dispose()
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolveWait) => setImmediate(resolveWait))
  }
  assert.fail('Timed out waiting for Workspace Host control frame.')
}

function waitForEvent(client: WorkspaceHostJsonlClient): Promise<WorkspaceHostEvent> {
  return new Promise((resolveEvent) => {
    const unsubscribe = client.subscribe((event) => {
      unsubscribe()
      resolveEvent(event)
    })
  })
}
