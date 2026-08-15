import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'
import { captureTurnFilePatchReceipts } from './turn-file-write-attribution'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('turn file patch attribution', () => {
  it('durably copies complete add and update patches without reading live output bytes', async () => {
    const workspaceRoot = await workspace()
    const addPatch = 'executor A\n'
    const updatePatch = '@@ -1 +1 @@\n-v1\n+v2\n'
    await writeFile(join(workspaceRoot, 'result.txt'), 'foreign B')

    const addReceipts = captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: fileChangeEvent([{ path: 'result.txt', kind: { type: 'add' }, diff: addPatch }], 7)
    })
    const updateReceipts = captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: fileChangeEvent([{
        path: 'result.txt', kind: { type: 'update', move_path: null }, diff: updatePatch
      }], 8)
    })
    const receipts = [...addReceipts, ...updateReceipts]

    expect(receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'host-authenticated-file-patch', executorSequence: 7,
        operation: 'add', patchFormat: 'full-content', patchText: addPatch,
        patchDigest: digest(addPatch)
      }),
      expect.objectContaining({
        executorSequence: 8, operation: 'update', patchFormat: 'unified-hunks', patchText: updatePatch,
        patchDigest: digest(updatePatch)
      })
    ]))
    expect(JSON.stringify(receipts)).not.toContain('foreign B')
  })

  it('preserves two ordered patches for the same path rather than overwriting by path', async () => {
    const workspaceRoot = await workspace()
    const first = captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: fileChangeEvent([{ path: 'result.txt', kind: { type: 'add' }, diff: 'v1\n' }], 3)
    })
    const second = captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: fileChangeEvent([{ path: 'result.txt', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-v1\n+v2\n' }], 4)
    })
    expect([...first, ...second].map((item) => item.operation)).toEqual(['add', 'update'])
  })

  it('keeps a valid empty-file add as exact full content', async () => {
    const workspaceRoot = await workspace()
    const receipts = captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: fileChangeEvent([{ path: 'empty.txt', kind: { type: 'add' }, diff: '' }], 5)
    })
    expect(receipts).toEqual([expect.objectContaining({
      operation: 'add', patchFormat: 'full-content', patchText: '', patchDigest: digest('')
    })])
  })

  it('fails closed for sensitive, outside, missing-diff, failed, and non-Codex receipts', async () => {
    const workspaceRoot = await workspace()
    const canonical = fileChangeEvent([{ path: '.env', kind: { type: 'add' }, diff: '@@ -0,0 +1 @@\n+SECRET\n' }], 1)
    expect(captureTurnFilePatchReceipts({ runtimeId: 'codex', workspaceRoot, event: canonical })).toEqual([])
    expect(captureTurnFilePatchReceipts({ runtimeId: 'codex', workspaceRoot, event: fileChangeEvent([
      { path: '../../outside', kind: { type: 'add' }, diff: '@@ -0,0 +1 @@\n+x\n' },
      { path: 'missing.txt', kind: { type: 'add' } }
    ], 2) })).toEqual([])
    expect(captureTurnFilePatchReceipts({ runtimeId: 'claude', workspaceRoot, event: canonical })).toEqual([])
    expect(captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: { ...canonical, factSource: 'model_output' }
    })).toEqual([])
  })

  it('rejects a whole malformed event for duplicate paths, NUL data, invalid UTF-8, or oversized patches', async () => {
    const workspaceRoot = await workspace()
    const valid = { path: 'safe.txt', kind: { type: 'add' }, diff: 'safe' }
    for (const changes of [
      [valid, { ...valid, diff: 'second' }],
      [valid, { path: 'bad\0name', kind: { type: 'add' }, diff: 'bad' }],
      [valid, { path: 'nul-content.txt', kind: { type: 'add' }, diff: 'bad\0bytes' }],
      [valid, { path: 'invalid-utf8.txt', kind: { type: 'add' }, diff: '\ud800' }],
      [valid, { path: 'huge.txt', kind: { type: 'add' }, diff: 'x'.repeat(4 * 1024 * 1024 + 1) }]
    ]) {
      expect(captureTurnFilePatchReceipts({
        runtimeId: 'codex', workspaceRoot, event: fileChangeEvent(changes, 9)
      })).toEqual([])
    }
    expect(captureTurnFilePatchReceipts({
      runtimeId: 'codex', workspaceRoot,
      event: { ...fileChangeEvent([valid], 10), callId: 'bad\0call', itemId: 'bad\0call' }
    })).toEqual([])
  })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'turn-file-patch-attribution-'))
  roots.push(root)
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  return workspaceRoot
}

function fileChangeEvent(changes: readonly unknown[], seq: number): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  const callId = `apply-patch-${seq}`
  return {
    kind: 'tool_event', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1',
    itemId: callId, seq, callId, toolName: 'apply_patch', toolKind: 'file_change',
    status: 'success', receipt: {
      status: 'success', outcome: 'progress', output: undefined,
      exitCode: undefined, errorCode: undefined, failureClass: undefined,
      retryable: undefined, objective: undefined, resourceIdentity: undefined,
      evidenceDelta: undefined, stateChanged: undefined, recoveryGuidance: undefined,
      providerStage: undefined, detail: undefined
    },
    phase: 'succeeded', factSource: 'executor_result', evidenceStrength: 'executor_receipt',
    effects: ['local_write'], detail: JSON.stringify(changes)
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
