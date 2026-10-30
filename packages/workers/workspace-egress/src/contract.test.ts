import assert from 'node:assert/strict'
import test from 'node:test'

import {
  workspaceEgressAcquireLeaseInputSchema,
  workspaceEgressSelectionSchema
} from './contract.js'

const allowlist = {
  rules: [{ host: 'api.example.org', ports: [443] }]
}

test('uses the three canonical SDK egress selections without redefining them', () => {
  assert.deepEqual(workspaceEgressSelectionSchema.parse({ mode: 'none' }), { mode: 'none' })
  assert.deepEqual(
    workspaceEgressSelectionSchema.parse({ mode: 'local', allowlist }),
    { mode: 'local', allowlist }
  )
  assert.deepEqual(
    workspaceEgressSelectionSchema.parse({
      mode: 'remote-target',
      authorizedSessionId: 'cpu-egress-session',
      allowlist
    }),
    {
      mode: 'remote-target',
      authorizedSessionId: 'cpu-egress-session',
      allowlist
    }
  )

  assert.throws(() => workspaceEgressSelectionSchema.parse({ mode: 'auto' }))
  assert.throws(() => workspaceEgressSelectionSchema.parse({
    mode: 'local',
    authorizedSessionId: 'unexpected',
    allowlist
  }))
  assert.throws(() => workspaceEgressSelectionSchema.parse({
    mode: 'remote-target',
    authorizedSessionId: ' ',
    allowlist
  }))
})

test('derives the only allowlist from selection and rejects wildcard or duplicate rules', () => {
  const parsed = workspaceEgressAcquireLeaseInputSchema.parse({
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'local',
      allowlist
    }
  })
  assert.deepEqual(parsed.selection.allowlist, allowlist)

  assert.throws(() => workspaceEgressAcquireLeaseInputSchema.parse({
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'local',
      allowlist
    },
    allowlist
  }))
  assert.throws(() => workspaceEgressAcquireLeaseInputSchema.parse({
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'local',
      allowlist: {
        rules: [{ host: '*.example.org', ports: [443] }]
      }
    }
  }))
  assert.throws(() => workspaceEgressAcquireLeaseInputSchema.parse({
    workspaceId: 'gpu-workspace',
    selection: {
      mode: 'local',
      allowlist: {
        rules: [
          { host: 'api.example.org', ports: [443] },
          { host: 'api.example.org', ports: [8443] }
        ]
      }
    }
  }))
})
