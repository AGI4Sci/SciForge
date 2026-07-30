import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  workspaceHostAcknowledgeSchema,
  workspaceHostHandshakeRequestSchema,
  workspaceHostRequestSchema,
  type WorkspaceHostEvent,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import type {
  RemoteSshStreamingProcess,
  StreamingProcessExit
} from './process-runner.js'
import {
  connectRemoteWorkspaceHostClient
} from './workspace-host-client.js'

describe('Remote Workspace Host client', () => {
  it('handshakes, multiplexes requests, and sends canonical acknowledgements', async () => {
    const process = fakeStreamingProcess((line, peer) => {
      const decoded: unknown = JSON.parse(line)
      const handshake = workspaceHostHandshakeRequestSchema.safeParse(decoded)
      if (handshake.success) {
        peer.send({
          protocolVersion: 1,
          ok: true,
          session: session('session-1', 0)
        })
        return
      }
      const request = workspaceHostRequestSchema.safeParse(decoded)
      if (request.success) {
        peer.send({
          protocolVersion: 1,
          sessionId: request.data.sessionId,
          requestId: request.data.requestId,
          ok: true,
          result: { healthy: true }
        })
      }
    })
    const client = await connectRemoteWorkspaceHostClient({
      clientVersion: '1.0.0',
      workspaceRoot: '/cluster/project',
      contributions: [],
      egressMode: 'none',
      connect: async () => process.value
    })

    await expect(client.request(WORKSPACE_HOST_OPERATIONS.health, {}))
      .resolves.toEqual({ healthy: true })
    process.send(event('session-1', 1))
    await client.acknowledge(1)

    const acknowledgement = process.writes
      .map((line) => workspaceHostAcknowledgeSchema.safeParse(JSON.parse(line)))
      .find((result) => result.success)
    expect(acknowledgement?.success && acknowledgement.data).toEqual({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: 'session-1',
      sequence: 1
    })
    await client.close()
  })

  it('reattaches with the acknowledged sequence and accepts ordered replay in the handshake chunk', async () => {
    const first = fakeStreamingProcess((line, peer) => {
      const handshake = workspaceHostHandshakeRequestSchema.safeParse(JSON.parse(line))
      if (handshake.success) {
        peer.send({
          protocolVersion: 1,
          ok: true,
          session: session('session-replay', 1, 'persistent-daemon')
        })
      }
    })
    const second = fakeStreamingProcess((line, peer) => {
      const handshake = workspaceHostHandshakeRequestSchema.safeParse(JSON.parse(line))
      if (!handshake.success) return
      expect(handshake.data.resume).toEqual({
        sessionId: 'session-replay',
        lastAcknowledgedSequence: 1
      })
      peer.sendLines([
        {
          protocolVersion: 1,
          ok: true,
          session: session('session-replay', 3, 'persistent-daemon')
        },
        event('session-replay', 2),
        event('session-replay', 3)
      ])
    })
    let connection = 0
    const client = await connectRemoteWorkspaceHostClient({
      clientVersion: '1.0.0',
      workspaceRoot: '/cluster/project',
      contributions: [],
      egressMode: 'none',
      connect: async () => connection++ === 0 ? first.value : second.value
    })
    const sequences: number[] = []
    client.subscribe((next) => {
      sequences.push(next.sequence)
    })

    const reconnected = await client.reconnect({ lastAcknowledgedSequence: 1 })

    expect(reconnected.eventSequence).toBe(3)
    expect(reconnected.lifecycleMode).toBe('persistent-daemon')
    expect(sequences).toEqual([2, 3])
    expect(first.disposed).toBe(true)
    await client.close()
  })

  it('contains malformed server envelopes instead of throwing from the stream listener', async () => {
    const process = fakeStreamingProcess((line, peer) => {
      const handshake = workspaceHostHandshakeRequestSchema.safeParse(JSON.parse(line))
      if (handshake.success) {
        peer.send({
          protocolVersion: 1,
          ok: true,
          session: session('session-invalid', 0)
        })
      }
    })
    const client = await connectRemoteWorkspaceHostClient({
      clientVersion: '1.0.0',
      workspaceRoot: '/cluster/project',
      contributions: [],
      egressMode: 'none',
      connect: async () => process.value
    })

    expect(() => process.send({ eventId: 'broken' })).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
    expect(process.disposed).toBe(true)
    await client.close()
  })
})

function session(
  sessionId: string,
  sequence: number,
  lifecycleMode: WorkspaceHostSession['lifecycleMode'] = 'connection-session'
): WorkspaceHostSession {
  return {
    protocolVersion: 1,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-instance',
    sessionId,
    lifecycleMode,
    locator: {
      contractVersion: 1,
      hostSessionId: sessionId,
      path: '/cluster/project'
    },
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: [],
    contributions: [],
    eventSequence: sequence,
    replay: { earliestSequence: 0, latestSequence: sequence },
    egress: { mode: 'none', status: 'disabled' }
  }
}

function event(sessionId: string, sequence: number): WorkspaceHostEvent {
  return {
    protocolVersion: 1,
    sessionId,
    eventId: `event-${sequence}`,
    sequence,
    kind: 'workspace.fs.changed',
    occurredAt: '2026-07-30T00:00:00.000Z',
    payload: { path: 'result.txt' }
  }
}

function fakeStreamingProcess(
  onLine: (line: string, peer: Readonly<{
    send(value: unknown): void
    sendLines(values: readonly unknown[]): void
  }>) => void
) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const writes: string[] = []
  let disposed = false
  let resolveExit!: (exit: StreamingProcessExit) => void
  const exit = new Promise<StreamingProcessExit>((resolve) => {
    resolveExit = resolve
  })
  const peer = {
    send: (value: unknown) => stdout.write(`${JSON.stringify(value)}\n`),
    sendLines: (values: readonly unknown[]) =>
      stdout.write(`${values.map((value) => JSON.stringify(value)).join('\n')}\n`)
  }
  const value: RemoteSshStreamingProcess = {
    stdout,
    stderr,
    exit,
    write: async (data) => {
      const content = Buffer.from(data).toString('utf8')
      for (const line of content.split('\n').filter(Boolean)) {
        writes.push(line)
        onLine(line, peer)
      }
    },
    end: () => undefined,
    dispose: async () => {
      if (disposed) return
      disposed = true
      resolveExit({ exitCode: null, signal: 'SIGTERM' })
      stdout.end()
      stderr.end()
    }
  }
  return {
    value,
    writes,
    send: peer.send,
    get disposed() {
      return disposed
    }
  }
}
