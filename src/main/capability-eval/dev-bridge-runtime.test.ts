import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'
import { startDevBrowserBridgeServer, type DevBrowserBridgeServer } from '../dev-browser-bridge'
import { createDevBrowserBridgeRuntime } from './dev-bridge-runtime'

describe('development bridge live runtime', () => {
  let bridge: DevBrowserBridgeServer | undefined

  afterEach(async () => {
    await bridge?.close()
    bridge = undefined
  })

  it('invokes the existing Agent Runtime and receives its event stream', async () => {
    const invoked: string[] = []
    let subscribedPayload: Record<string, unknown> | undefined
    const runtimeEvent: AgentRuntimeEvent = {
      kind: 'heartbeat',
      threadId: 'thread-1',
      runtimeId: 'codex',
      turnId: 'turn-1'
    }
    bridge = await startDevBrowserBridgeServer({
      port: 0,
      instanceId: 'test-instance',
      dispatcher: {
        invoke: async (channel, payload, sender) => {
          invoked.push(channel)
          if (channel === 'agentRuntime:startThread') {
            return {
              id: 'thread-1',
              runtimeId: 'codex',
              title: 'Capability Eval',
              updatedAt: '2026-09-15T00:00:00.000Z'
            }
          }
          if (channel === 'agentRuntime:readThreadStatus') {
            return {
              id: 'thread-1',
              runtimeId: 'codex',
              latestSeq: 0,
              latestTurnId: undefined,
              latestTurnStatus: undefined
            }
          }
          if (channel === 'agentRuntime:subscribeEvents') {
            subscribedPayload = payload as Record<string, unknown>
            const streamId = (payload as { streamId: string }).streamId
            queueMicrotask(() => {
              sender.send('agentRuntime:event', { streamId, event: runtimeEvent })
              sender.send('agentRuntime:end', { streamId })
            })
            // The production IPC handler starts the stream asynchronously and
            // intentionally has no response payload.
            return undefined
          }
          if (channel === 'agentRuntime:stopEvents') return true
          throw new Error(`Unexpected channel ${channel}`)
        }
      }
    })

    const runtime = await createDevBrowserBridgeRuntime({
      bridgeUrl: bridge.url,
      instanceId: 'test-instance',
      clientId: 'capability-eval-test'
    })

    await expect(runtime.startThread({
      runtimeId: 'codex',
      workspace: '/tmp/sciforge-live-eval'
    })).resolves.toMatchObject({ id: 'thread-1', runtimeId: 'codex' })

    const events: AgentRuntimeEvent[] = []
    const subscriptionController = new AbortController()
    for await (const event of runtime.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'thread-1',
      streamId: 'stream-1',
      signal: subscriptionController.signal
    })) {
      events.push(event)
    }

    expect(events).toEqual([runtimeEvent])
    expect(subscribedPayload).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      streamId: 'stream-1'
    })
    expect(invoked).toEqual([
      'agentRuntime:startThread',
      'agentRuntime:subscribeEvents',
      'agentRuntime:stopEvents'
    ])
    await runtime.close()
  })
})
