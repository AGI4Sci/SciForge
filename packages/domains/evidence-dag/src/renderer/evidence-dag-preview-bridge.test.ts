import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainRendererWorkspacePreviewHost,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_PREVIEW_REQUEST,
  EVIDENCE_DAG_PREVIEW_RESULT,
  handleEvidenceDagPreviewMessage,
  parseEvidenceDagPreviewRequest
} from './evidence-dag-preview-bridge'

const snapshotDigest = `sha256:${'a'.repeat(64)}`
const contentDigest = `sha256:${'b'.repeat(64)}`

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: EVIDENCE_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId: 'preview-1',
    threadId: 'codex:thread-1',
    snapshotDigest,
    sourceAssertionId: 'source-1',
    artifactVersionId: 'artifact-v1',
    sourceAnchorId: 'anchor-1',
    ...overrides
  }
}

function frame(): {
  window: WindowProxy
  messages: unknown[][]
} {
  const messages: unknown[][] = []
  const window = {
    postMessage: (...args: unknown[]) => messages.push(args)
  } as unknown as WindowProxy
  return { window, messages }
}

test('accepts only opaque provenance identifiers from the iframe', () => {
  assert.deepEqual(parseEvidenceDagPreviewRequest(request()), request())
  assert.equal(parseEvidenceDagPreviewRequest(request({ path: '../secret' })), null)
  assert.equal(parseEvidenceDagPreviewRequest(request({ selector: { page: 1 } })), null)
})

test('ignores untrusted origins and rejects stale committed snapshots', async () => {
  const current = frame()
  let resolved = false
  const common = {
    frameWindow: current.window,
    frameUrl: 'http://127.0.0.1:8000/',
    sessionId: 'thread-1',
    surfaceId: 'surface-evidence-a',
    runtimeId: 'codex',
    threadId: 'thread-1',
    committedSnapshotDigest: snapshotDigest,
    resolvePreview: async () => {
      resolved = true
      return {
        ok: false as const,
        code: 'file_unavailable' as const,
        message: 'missing'
      }
    },
    t: (key: string) => key
  }
  assert.deepEqual(await handleEvidenceDagPreviewMessage({
    ...common,
    event: {
      data: request(),
      origin: 'http://malicious.test',
      source: current.window
    }
  }), { status: 'ignored' })
  assert.deepEqual(await handleEvidenceDagPreviewMessage({
    ...common,
    event: {
      data: request({ snapshotDigest: `sha256:${'c'.repeat(64)}` }),
      origin: 'http://127.0.0.1:8000',
      source: current.window
    }
  }), {
    status: 'rejected',
    message: 'evidenceDagPreviewSnapshotMismatch'
  })
  assert.equal(resolved, false)
})

test('opens only the resolved workspace target and preserves return activation', async () => {
  const current = frame()
  const opened: DomainWorkspacePreviewTarget[] = []
  const workspacePreview: DomainRendererWorkspacePreviewHost = {
    open: (target) => opened.push(target)
  }
  const result = await handleEvidenceDagPreviewMessage({
    event: {
      data: request(),
      origin: 'http://127.0.0.1:8000',
      source: current.window
    },
    frameWindow: current.window,
    frameUrl: 'http://127.0.0.1:8000/',
    sessionId: 'thread-1',
    surfaceId: 'surface-evidence-a',
    runtimeId: 'codex',
    threadId: 'thread-1',
    committedSnapshotDigest: snapshotDigest,
    activationRevision: 4,
    workspacePreview,
    resolvePreview: async () => ({
      ok: true,
      path: '/workspace/lab/paper.pdf',
      workspaceRoot: '/workspace/lab',
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest,
      sourceAssertionId: 'source-1',
      artifactVersionId: 'artifact-v1',
      sourceAnchorId: 'anchor-1',
      selector: { type: 'pdf', page: 3, quote: 'evidence' },
      contentDigest
    }),
    t: (key) => key
  })

  assert.equal(result.status, 'opened')
  assert.equal(opened.length, 1)
  assert.equal(opened[0]?.surfaceId, 'surface-evidence-a')
  assert.deepEqual(opened[0]?.integrity, {
    algorithm: 'sha256',
    expectedDigest: contentDigest
  })
  assert.deepEqual(opened[0]?.returnTo?.activation, {
    contributionId: 'evidence-dag.workbench-right-panel',
    revision: 4,
    payload: {
      view: 'graph',
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest,
      nodeId: 'source-1'
    }
  })
  assert.deepEqual(current.messages[0], [{
    type: EVIDENCE_DAG_PREVIEW_RESULT,
    version: 1,
    requestId: 'preview-1',
    ok: true
  }, 'http://127.0.0.1:8000'])
})
