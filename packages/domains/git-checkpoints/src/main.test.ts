import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
  VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
  VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
  VERSION_CONTROL_RESTORE_ACTION_ID,
  VERSION_CONTROL_STATUS_ACTION_ID
} from '@sciforge/domain-sdk/version-control'
import {
  GIT_CHECKPOINTS_CAPABILITY_IDS
} from './contract.js'
import {
  createGitCheckpointsCapabilityFactory,
  createVersionControlCheckpointPort,
  type GitCheckpointsCapabilityOptions
} from './main.js'
import type { GitCheckpointService } from './service.js'

test('version-control adapter uses only public generic contracts and inherits restore authorization', async () => {
  const calls: Array<Readonly<{
    actionId: string
    input: unknown
    options: unknown
  }>> = []
  const invoker = {
    invoke: async (
      contract: DomainCapabilityContract<unknown, unknown>,
      input: unknown,
      options: unknown
    ): Promise<unknown> => {
      calls.push({ actionId: contract.actionId, input, options })
      switch (contract.actionId) {
        case VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID:
          return {
            resourceKind: 'host.version-control.workspace',
            resource: {
              token: 'token',
              semanticRevision: 'revision-0',
              expiresAt: '2026-07-28T01:00:00.000Z'
            },
            provider: 'git'
          }
        case VERSION_CONTROL_STATUS_ACTION_ID:
          return {
            revision: 'revision-0',
            clean: false,
            changes: [
              { path: 'a.ts', status: 'modified' },
              { path: 'b.ts', status: 'untracked' }
            ],
            truncated: false
          }
        case VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID:
          return {
            id: 'snapshot-1',
            revision: 'revision-1',
            createdAt: '2026-07-28T00:00:00.000Z'
          }
        case VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID:
          return { text: 'diff', truncated: false }
        case VERSION_CONTROL_RESTORE_ACTION_ID:
          return { ok: true, revision: 'revision-1' }
        default:
          throw new Error(`Unexpected contract ${contract.actionId}`)
      }
    }
  } as DomainMainSystemCapabilityInvoker
  const port = createVersionControlCheckpointPort(invoker)

  await assert.doesNotReject(port.capture({
    workspaceRoot: '/workspace',
    snapshotName: 'checkpoint-1'
  }))
  await assert.doesNotReject(port.preview({
    workspaceRoot: '/workspace',
    snapshotId: 'snapshot-1'
  }))
  await assert.doesNotReject(port.restore({
    workspaceRoot: '/workspace',
    snapshotId: 'snapshot-1'
  }))

  assert.deepEqual(calls.map(({ actionId }) => actionId), [
    VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
    VERSION_CONTROL_STATUS_ACTION_ID,
    VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
    VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
    VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
    VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
    VERSION_CONTROL_STATUS_ACTION_ID,
    VERSION_CONTROL_RESTORE_ACTION_ID
  ])
  assert.deepEqual(calls.at(-1)?.options, {
    workspaceId: '/workspace',
    idempotencyKey: calls.at(-1) &&
      (calls.at(-1)!.options as { idempotencyKey: string }).idempotencyKey,
    resource: {
      token: 'token',
      semanticRevision: 'revision-0',
      expiresAt: '2026-07-28T01:00:00.000Z'
    },
    expectedRevision: 'revision-0',
    authorization: { mode: 'inherit-current-action' }
  })
  assert.equal(
    calls.slice(0, -1).some(({ options }) =>
      Boolean((options as { authorization?: unknown } | undefined)?.authorization)
    ),
    false
  )
})

test('capability factory confirmation-gates restore and enforces caller workspace', async () => {
  const definitions: GitCheckpointsCapabilityOptions[] = []
  const restoreCalls: unknown[] = []
  const service = {
    list: async () => ({ ok: true, value: [] }),
    create: async () => ({ ok: false, reason: 'unused', message: 'unused' }),
    preview: async () => ({ ok: false, reason: 'unused', message: 'unused' }),
    restore: async (...args: unknown[]) => {
      restoreCalls.push(args)
      return { ok: false, reason: 'blocked', message: 'blocked' }
    }
  } as unknown as GitCheckpointService
  const factory = createGitCheckpointsCapabilityFactory({
    defineCapability: (definition) => {
      definitions.push(definition)
      return definition
    },
    getService: () => service
  })
  factory.createDefinitions()
  const restore = definitions.find(
    ({ id }) => id === GIT_CHECKPOINTS_CAPABILITY_IDS.restore
  )
  const list = definitions.find(
    ({ id }) => id === GIT_CHECKPOINTS_CAPABILITY_IDS.list
  )

  assert.ok(restore)
  assert.equal(restore.effect, 'destructive')
  assert.equal(restore.approval, 'confirmation')
  assert.deepEqual(restore.audiences, ['ui', 'agent'])
  await restore.handler(
    { checkpointId: 'checkpoint-1' },
    { caller: { workspaceId: '/workspace' } }
  )
  assert.deepEqual(restoreCalls, [[
    { checkpointId: 'checkpoint-1' },
    '/workspace'
  ]])

  assert.ok(list)
  await assert.rejects(
    list.handler(
      { workspaceRoot: '/another-workspace' },
      { caller: { workspaceId: '/workspace' } }
    ),
    /another workspace/u
  )
})
