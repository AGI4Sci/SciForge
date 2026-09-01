import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensurePrivateWorkspaceRoot } from './private-workspace-root.js'

test('Windows creates a private Worker workspace without applying a POSIX mode', async () => {
  const calls: string[] = []

  await ensurePrivateWorkspaceRoot('worker-root', {
    platform: 'win32',
    mkdir: async (_path, options) => {
      assert.deepEqual(options, { recursive: true, mode: 0o700 })
      calls.push('mkdir:700')
      return undefined
    },
    chmod: async () => {
      calls.push('chmod')
    }
  })

  assert.deepEqual(calls, ['mkdir:700'])
})

test('POSIX Worker workspaces enforce mode 0700 and fail closed when chmod fails', async () => {
  const calls: string[] = []

  await assert.rejects(
    ensurePrivateWorkspaceRoot('worker-root', {
      platform: 'linux',
      mkdir: async (_path, options) => {
        assert.deepEqual(options, { recursive: true, mode: 0o700 })
        calls.push('mkdir:700')
        return undefined
      },
      chmod: async (_path, mode) => {
        calls.push(`chmod:${mode.toString(8)}`)
        throw new Error('chmod failed')
      }
    }),
    /chmod failed/u
  )

  assert.deepEqual(calls, ['mkdir:700', 'chmod:700'])
})
