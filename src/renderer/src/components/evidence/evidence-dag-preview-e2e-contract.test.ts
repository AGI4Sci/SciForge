import { describe, expect, it, vi } from 'vitest'
import {
  EVIDENCE_DAG_PREVIEW_REQUEST,
  handleEvidenceDagPreviewMessage
} from './evidence-dag-preview-bridge'

const SNAPSHOT = 'sha256:f8fbb8954a7d7a73d7a2748983b5735d6374edd63dfccf1df6772a9c87eae15f'
const CONTENT = 'sha256:338ee1304330c643d0fea83f60b4b552e78d833fa69a0481d21b9d61bf95c8b4'

function frame(): { window: WindowProxy; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  return { window: { postMessage } as unknown as WindowProxy, postMessage }
}

describe('Evidence DAG molclaw preview contract', () => {
  it('keeps the engine thread opaque while resolving with the trusted raw runtime thread', async () => {
    const current = frame()
    const resolver = vi.fn(async () => ({
      ok: true as const,
      path: '/Applications/workspace/ailab/research/molclaw/molclaw_demo_scenes/scene_02_multimodal_context/inputs/EGFR_9VMR.pdb',
      workspaceRoot: '/Applications/workspace/ailab/research/molclaw',
      runtimeId: 'sciforge' as const,
      threadId: 'thr_4lvhxekm',
      snapshotDigest: SNAPSHOT,
      sourceAssertionId: 'source_assertion:f8c758d153df535c38cf46e0',
      artifactId: 'artifact:11e3106a9fad43a5a0cf352050fb41e3',
      artifactVersionId: 'artifact-version:2bcca914688dbd7b9928e62a',
      sourceAnchorId: 'anchor:cd29e3c4214a621e121670ff',
      selector: { type: 'text' as const, lineRange: '1:60', quote: 'HEADER HYDROLASE' },
      contentDigest: CONTENT
    }))
    const openPreview = vi.fn()

    const result = await handleEvidenceDagPreviewMessage({
      event: {
        origin: 'http://127.0.0.1:4897',
        source: current.window,
        data: {
          type: EVIDENCE_DAG_PREVIEW_REQUEST,
          version: 1,
          requestId: 'molclaw-pdb',
          threadId: 'sciforge:thr_4lvhxekm',
          snapshotDigest: SNAPSHOT,
          sourceAssertionId: 'source_assertion:f8c758d153df535c38cf46e0',
          artifactVersionId: 'artifact-version:2bcca914688dbd7b9928e62a',
          sourceAnchorId: 'anchor:cd29e3c4214a621e121670ff'
        }
      },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/?thread=sciforge%3Athr_4lvhxekm',
      runtimeId: 'sciforge',
      currentThreadId: 'thr_4lvhxekm',
      expectedSnapshotDigest: SNAPSHOT,
      resolveEvidenceDagEvidencePreview: resolver,
      openPreview
    })

    expect(resolver).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thr_4lvhxekm',
      snapshotDigest: SNAPSHOT,
      sourceAssertionId: 'source_assertion:f8c758d153df535c38cf46e0',
      artifactVersionId: 'artifact-version:2bcca914688dbd7b9928e62a',
      sourceAnchorId: 'anchor:cd29e3c4214a621e121670ff'
    })
    expect(openPreview).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { kind: 'text', line: 1, endLine: 60 },
      line: 1,
      integrity: { algorithm: 'sha256', expectedDigest: CONTENT },
      returnTo: {
        kind: 'evidence-dag',
        label: 'Evidence',
        nodeId: 'source_assertion:f8c758d153df535c38cf46e0',
        threadId: 'thr_4lvhxekm'
      }
    }))
    expect(result).toMatchObject({ status: 'opened' })
  })

  it('rejects a different engine thread before calling the resolver', async () => {
    const current = frame()
    const resolver = vi.fn()

    await expect(handleEvidenceDagPreviewMessage({
      event: {
        origin: 'http://127.0.0.1:4897',
        source: current.window,
        data: {
          type: EVIDENCE_DAG_PREVIEW_REQUEST,
          version: 1,
          requestId: 'wrong-thread',
          threadId: 'sciforge:thr_other',
          snapshotDigest: SNAPSHOT,
          sourceAssertionId: 'source_assertion:f8c758d153df535c38cf46e0',
          artifactVersionId: 'artifact-version:2bcca914688dbd7b9928e62a',
          sourceAnchorId: 'anchor:cd29e3c4214a621e121670ff'
        }
      },
      frameWindow: current.window,
      frameUrl: 'http://127.0.0.1:4897/?thread=sciforge%3Athr_4lvhxekm',
      runtimeId: 'sciforge',
      currentThreadId: 'thr_4lvhxekm',
      expectedSnapshotDigest: SNAPSHOT,
      resolveEvidenceDagEvidencePreview: resolver
    })).resolves.toMatchObject({ status: 'rejected' })
    expect(resolver).not.toHaveBeenCalled()
  })
})
