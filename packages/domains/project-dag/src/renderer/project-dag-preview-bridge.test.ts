import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainRendererWorkspacePreviewHost,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import {
  PROJECT_DAG_PREVIEW_REQUEST,
  PROJECT_DAG_PREVIEW_RESULT,
  handleProjectDagPreviewMessage,
  parseProjectDagPreviewRequest
} from './project-dag-preview-bridge'

const snapshotDigest = `sha256:${'a'.repeat(64)}`

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: PROJECT_DAG_PREVIEW_REQUEST,
    version: 1,
    requestId: 'preview-1',
    artifactVersionId: 'artifact-v1',
    sourceAnchorId: 'anchor-1',
    graphNodeId: 'node-1',
    claim: { id: 'claim-1', snapshotDigest },
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

test('accepts only opaque Project provenance identifiers', () => {
  assert.deepEqual(parseProjectDagPreviewRequest(request()), request())
  assert.equal(parseProjectDagPreviewRequest(request({ path: '../secret' })), null)
  assert.equal(parseProjectDagPreviewRequest(request({ graphNodeId: '../bad node' })), null)
})

test('rejects stale snapshots before invoking the trusted resolver', async () => {
  const current = frame()
  let resolved = false
  const result = await handleProjectDagPreviewMessage({
    event: {
      data: request({ claim: {
        id: 'claim-1',
        snapshotDigest: `sha256:${'c'.repeat(64)}`
      } }),
      origin: 'http://127.0.0.1:9000',
      source: current.window
    },
    frameWindow: current.window,
    frameUrl: 'http://127.0.0.1:9000/',
    sessionId: 'session-1',
    target: {
      workspaceRoot: '/workspace/lab',
      projectRoot: '/workspace/lab'
    },
    committedSnapshotDigest: snapshotDigest,
    resolvePreview: async () => {
      resolved = true
      return {
        ok: false as const,
        error: {
          code: 'file_unavailable' as const,
          message: 'missing',
          retryable: false
        }
      }
    },
    t: (key) => key
  })
  assert.deepEqual(result, {
    status: 'rejected',
    message: 'projectDagPreviewSnapshotMismatch'
  })
  assert.equal(resolved, false)
})

test('opens a trusted Project evidence target through the host facade', async () => {
  const current = frame()
  const opened: DomainWorkspacePreviewTarget[] = []
  const workspacePreview: DomainRendererWorkspacePreviewHost = {
    open: (target) => opened.push(target)
  }
  const result = await handleProjectDagPreviewMessage({
    event: {
      data: request(),
      origin: 'http://127.0.0.1:9000',
      source: current.window
    },
    frameWindow: current.window,
    frameUrl: 'http://127.0.0.1:9000/',
    sessionId: 'session-1',
    target: {
      workspaceRoot: '/workspace/lab',
      projectRoot: '/workspace/lab',
      project: 'paper-reading'
    },
    committedSnapshotDigest: snapshotDigest,
    activationRevision: 6,
    workspacePreview,
    resolvePreview: async () => ({
      ok: true,
      data: {
        path: '/workspace/lab/paper.pdf',
        workspaceRoot: '/workspace/lab',
        snapshotDigest,
        claimId: 'claim-1',
        artifactVersionId: 'artifact-v1',
        sourceAnchorId: 'anchor-1',
        selector: { type: 'pdf', page: 2, quote: 'claim support' },
        contentDigest: `sha256:${'b'.repeat(64)}`
      }
    }),
    t: (key) => key
  })

  assert.equal(result.status, 'opened')
  assert.equal(opened.length, 1)
  assert.deepEqual(opened[0]?.returnTo?.activation, {
    contributionId: 'project-dag.workbench-right-panel',
    revision: 6,
    payload: {
      workspaceRoot: '/workspace/lab',
      projectRoot: '/workspace/lab',
      project: 'paper-reading',
      view: 'graph',
      focus: { claimId: 'claim-1', nodeId: 'node-1' }
    }
  })
  assert.deepEqual(current.messages[0], [{
    type: PROJECT_DAG_PREVIEW_RESULT,
    version: 1,
    requestId: 'preview-1',
    ok: true
  }, 'http://127.0.0.1:9000'])
})
