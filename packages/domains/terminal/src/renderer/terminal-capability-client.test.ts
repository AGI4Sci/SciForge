import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  CONTROLLED_PROCESS_CREATE_ACTION_ID,
  CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
  CONTROLLED_PROCESS_READ_ACTION_ID,
  CONTROLLED_PROCESS_RESIZE_ACTION_ID,
  CONTROLLED_PROCESS_WRITE_ACTION_ID
} from '@sciforge/domain-sdk/controlled-process'
import { createTerminalCapabilityClient } from './terminal-capability-client'

const resource = {
  token: 'opaque-resource-token',
  semanticRevision: '1',
  expiresAt: '2099-01-01T00:00:00.000Z'
}

test('routes terminal lifecycle and streaming through the controlled-process contracts', async () => {
  const calls: Array<{
    actionId: string
    input: unknown
    options: unknown
  }> = []
  const invoker: DomainRendererCapabilityInvoker = {
    observe: async () => {
      throw new Error('not observed')
    },
    invoke: async (contract, input, options) => {
      calls.push({ actionId: contract.actionId, input, options })
      if (contract.actionId === CONTROLLED_PROCESS_CREATE_ACTION_ID) {
        return {
          resourceKind: 'host.controlled-process',
          resource,
          cursor: '0'
        } as never
      }
      if (contract.actionId === CONTROLLED_PROCESS_READ_ACTION_ID) {
        return {
          cursor: '5',
          chunks: [{ stream: 'stdout', data: 'hello' }],
          truncated: false
        } as never
      }
      if (contract.actionId === CONTROLLED_PROCESS_WRITE_ACTION_ID) {
        return { acceptedCharacters: 4 } as never
      }
      return { ok: true } as never
    }
  }
  const client = createTerminalCapabilityClient(invoker)

  const attachment = await client.open('terminal:workspace:main', '/workspace', {
    columns: 100,
    rows: 30
  })
  assert.deepEqual(attachment, { cursor: '0' })
  assert.deepEqual(await client.read('terminal:workspace:main', '0'), {
    cursor: '5',
    chunks: [{ stream: 'stdout', data: 'hello' }],
    truncated: false
  })
  client.commitCursor('terminal:workspace:main', '0', '5')
  await client.write('terminal:workspace:main', 'pwd\n')
  await client.resize('terminal:workspace:main', 120, 40)
  await client.dispose('terminal:workspace:main', 'test complete')

  assert.deepEqual(calls.map(({ actionId }) => actionId), [
    CONTROLLED_PROCESS_CREATE_ACTION_ID,
    CONTROLLED_PROCESS_READ_ACTION_ID,
    CONTROLLED_PROCESS_WRITE_ACTION_ID,
    CONTROLLED_PROCESS_RESIZE_ACTION_ID,
    CONTROLLED_PROCESS_DISPOSE_ACTION_ID
  ])
  assert.deepEqual(calls[0]?.input, {
    profile: 'system-shell',
    cwd: '/workspace',
    terminal: { columns: 100, rows: 30 }
  })
  for (const call of calls) {
    assert.equal((call.options as { workspaceId: string }).workspaceId, '/workspace')
  }
})

test('keeps the committed cursor when a stale reader finishes late', async () => {
  const invoker: DomainRendererCapabilityInvoker = {
    observe: async () => {
      throw new Error('not observed')
    },
    invoke: async (contract) => {
      if (contract.actionId === CONTROLLED_PROCESS_CREATE_ACTION_ID) {
        return {
          resourceKind: 'host.controlled-process',
          resource,
          cursor: '0'
        } as never
      }
      return { ok: true } as never
    }
  }
  const client = createTerminalCapabilityClient(invoker)
  await client.open('terminal:workspace:main', '/workspace', {
    columns: 80,
    rows: 24
  })
  client.commitCursor('terminal:workspace:main', '0', '10')
  client.commitCursor('terminal:workspace:main', '0', '5')
  assert.deepEqual(
    await client.open('terminal:workspace:main', '/workspace', {
      columns: 80,
      rows: 24
    }),
    { cursor: '10' }
  )
})
