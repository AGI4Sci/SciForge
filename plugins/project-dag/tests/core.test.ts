import { expect, test } from 'vitest'
import { ProjectDagCore } from '../../../packages/domains/project-dag/src/core/index.js'

const now = '2026-07-26T05:30:20.000Z'
const digest = `sha256:${'a'.repeat(64)}`
const capturedScope = { includedSessions: ['codex:t'], excludedSessions: [], isolatedSessions: [] }
const receipt = { projectKey: 'path:/synthetic', jobId: 'pjob_test', acceptedRequestVersion: 1,
  desiredFingerprint: `project-update-desired:${'b'.repeat(64)}`, desiredEvidenceVector: [{ threadId: 'codex:t', digest }],
  capturedScope, state: 'queued', acceptedAt: now, updatedAt: now }

test('core rejects a committed reference for a different thread before enqueue', async () => {
  let wrote = false
  const core = new ProjectDagCore({
    readSession: async (identity) => ({ runtimeId: identity.runtimeId, id: identity.threadId, workspaceRoot: '/synthetic' }),
    readCommittedSnapshot: async () => ({ threadId: 'codex:other', version: 1, digest, inputWatermark: 'turn:1',
      schemaVersion: '1', extractorVersion: '1', verifierVersion: '1', artifactDigests: [], createdAt: now }),
    request: async () => { wrote = true; return receipt }, serviceUrl: 'http://127.0.0.1:3898'
  })
  await expect(core.update({ workspaceRoot: '/synthetic', scope: ['codex:t'] })).rejects.toThrow(/identity/)
  expect(wrote).toBe(false)
})

test('core captures authoritative identity and exact committed vector before durable enqueue', async () => {
  const requests: unknown[] = []
  const core = new ProjectDagCore({
    readSession: async (identity) => ({ runtimeId: identity.runtimeId, id: identity.threadId, workspaceRoot: '/synthetic' }),
    readCommittedSnapshot: async () => ({ threadId: 'codex:t', version: 1, digest, inputWatermark: 'turn:1',
      schemaVersion: '1', extractorVersion: '1', verifierVersion: '1', artifactDigests: [], createdAt: now }),
    request: async (route, _method, body) => {
      requests.push(body)
      return route === '/updates' ? receipt : { projectKey: 'path:/synthetic', state: 'pending', latestReceipt: receipt, activeReceipt: receipt }
    },
    serviceUrl: 'http://127.0.0.1:3898'
  })
  const result = await core.update({ workspaceRoot: '/synthetic', scope: ['codex:t'] })
  expect(new URL(result.url).hash).toBe('')
  expect(result.receipt.desiredEvidenceVector).toEqual([{ threadId: 'codex:t', digest }])
  expect(requests[0]).toMatchObject({ evidenceVector: [{ threadId: 'codex:t', digest }], capturedScope })
})
