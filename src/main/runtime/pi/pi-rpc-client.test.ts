import { describe, expect, it } from 'vitest'
import { spawnFakePi, turnEvents, type FakePiHandle } from './pi-test-fakes'

/**
 * These tests run the REAL PiRpcClient over REAL stdio against a scripted
 * peer on the real Node executable. Only the peer is fake; framing, id
 * correlation, mark isolation, timeouts and process cleanup are all live.
 */

const withFake = async (
  scenario: Parameters<typeof spawnFakePi>[0],
  run: (handle: FakePiHandle) => Promise<void>
): Promise<void> => {
  const handle = spawnFakePi(scenario)
  try {
    await run(handle)
  } finally {
    await handle.client.close()
  }
}

describe('PiRpcClient framing and command correlation', () => {
  it('correlates responses by caller-set id', async () => {
    await withFake(
      { commands: { get_state: { respond: { success: true, data: { model: 'm1' } } } } },
      async ({ client }) => {
        const response = await client.command({ type: 'get_state' })
        expect(response.success).toBe(true)
        expect((response.data as { model: string }).model).toBe('m1')
      }
    )
  })

  it('accepts CRLF-framed records by stripping one optional CR', async () => {
    await withFake(
      { crlf: true, commands: { get_state: { respond: { success: true } } } },
      async ({ client }) => {
        const response = await client.command({ type: 'get_state' })
        expect(response.success).toBe(true)
      }
    )
  })

  it('surfaces peer-reported failure without throwing', async () => {
    await withFake(
      { commands: { set_model: { respond: { success: false, error: 'Model not found: bad/x' } } } },
      async ({ client }) => {
        const response = await client.command({ type: 'set_model', provider: 'bad', modelId: 'x' })
        expect(response.success).toBe(false)
        expect(response.error).toContain('Model not found')
      }
    )
  })

  it('rejects the command promise when the peer never answers', async () => {
    await withFake(
      { commands: { get_state: { noResponse: true } } },
      async ({ client }) => {
        await expect(client.command({ type: 'get_state' }, { timeoutMs: 300 })).rejects.toThrow(/timeout/)
      }
    )
  })
})

describe('PiRpcClient mark isolation (stale record protection)', () => {
  it('a settled record from BEFORE the mark never satisfies a new waitFor', async () => {
    await withFake(
      {
        commands: {
          emit_old: {
            respond: { success: true },
            events: [{ record: { type: 'agent_settled', aborted: false } }]
          },
          emit_new: {
            respond: { success: true },
            events: [{ atMs: 100, record: { type: 'agent_settled', aborted: true } }]
          }
        }
      },
      async ({ client }) => {
        await client.command({ type: 'emit_old' })
        await new Promise((resolve) => setTimeout(resolve, 100))
        const mark = client.mark()
        // The old settled is already buffered; a waiter after the mark must not see it.
        const stale = client.waitFor((record) => record.type === 'agent_settled' && record.aborted === true, {
          after: mark,
          timeoutMs: 400,
          label: 'fresh settled only'
        })
        await client.command({ type: 'emit_new' })
        const record = await stale
        expect(record.aborted).toBe(true)
      }
    )
  })

  it('times out instead of matching a pre-mark record', async () => {
    await withFake(
      {
        commands: {
          emit_old: {
            respond: { success: true },
            events: [{ record: { type: 'agent_settled', aborted: false } }]
          }
        }
      },
      async ({ client }) => {
        await client.command({ type: 'emit_old' })
        await new Promise((resolve) => setTimeout(resolve, 100))
        const mark = client.mark()
        await expect(
          client.waitFor((record) => record.type === 'agent_settled', { after: mark, timeoutMs: 300 })
        ).rejects.toThrow(/timeout/)
      }
    )
  })
})

describe('PiRpcClient lifecycle', () => {
  it('rejects pending waiters and resolves exit() when the peer dies', async () => {
    const handle = spawnFakePi({
      commands: { get_state: { respond: { success: true }, exitCode: 7, exitAfterMs: 50 } }
    })
    try {
      await handle.client.command({ type: 'get_state' })
      const exit = await handle.client.exit()
      expect(exit.code).toBe(7)
      await expect(
        handle.client.waitFor(() => true, { timeoutMs: 5_000 })
      ).rejects.toThrow(/closed|exited/)
      await expect(handle.client.command({ type: 'get_state' })).rejects.toThrow(/exited/)
    } finally {
      await handle.client.close()
    }
  })

  it('close() terminates the child and rejects outstanding waits', async () => {
    const handle = spawnFakePi({ commands: { get_state: { noResponse: true } } })
    const pending = handle.client.waitFor(() => true, { timeoutMs: 30_000 })
    // Attach the rejection handler BEFORE closing: the peer may exit during
    // close(), and an unattached rejection is an unhandled rejection.
    const assertion = expect(pending).rejects.toThrow(/closed|exited/)
    await handle.client.close()
    await assertion
    const exit = await handle.client.exit()
    expect(exit.code === null || typeof exit.code === 'number').toBe(true)
    expect(handle.client.hasExited).toBe(true)
  })

  it('waitFor honors an AbortSignal', async () => {
    await withFake({}, async ({ client }) => {
      const controller = new AbortController()
      const pending = client.waitFor(() => true, { timeoutMs: 30_000, signal: controller.signal })
      controller.abort()
      await expect(pending).rejects.toThrow(/aborted/)
    })
  })

  it('streams a full turn event sequence via onRecord', async () => {
    await withFake(
      { prompts: [{ respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('hello') }] },
      async ({ client }) => {
        const seen: string[] = []
        client.onRecord((record) => {
          if (record.type !== 'response') seen.push(String(record.type))
        })
        const response = await client.command({ type: 'prompt', message: 'hi' })
        expect(response.success).toBe(true)
        await client.waitFor((record) => record.type === 'agent_settled', { timeoutMs: 5_000 })
        expect(seen).toEqual([
          'agent_start',
          'turn_start',
          'message_start',
          'message_update',
          'message_end',
          'turn_end',
          'agent_end',
          'agent_settled'
        ])
      }
    )
  })
})
