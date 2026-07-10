import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { EnqueueEvidenceDagUpdateInput } from './evidence-dag-feed'
import { EvidenceArtifactLifecycle } from './evidence-artifact-lifecycle'

class FakeWatcher extends EventEmitter {
  close = vi.fn()
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

describe('Evidence Artifact lifecycle', () => {
  it('turns a project-scoped Registry event into the same durable Evidence queue', async () => {
    const watcher = new FakeWatcher()
    const enqueued: EnqueueEvidenceDagUpdateInput[] = []
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/artifacts/events/ack')
      ? ok({ acknowledged: ['artifact-event:1'], pending: 0 })
      : ok({
          events: [{
            eventId: 'artifact-event:1', type: 'ArtifactContentChanged',
            artifactId: 'artifact:1', outcome: 'content_changed'
          }],
          affectedThreads: [{
            threadId: 'sciforge:thread-1', targetWatermark: '52', artifactIds: ['artifact:1']
          }],
          scope: {
            projectKey: '/workspace/project',
            workspaceRoot: '/workspace/project',
            projectRoot: '/workspace/project'
          }
        })) as typeof fetch
    const lifecycle = new EvidenceArtifactLifecycle({
      threads: {
        listThreads: async () => [{
          id: 'thread-1', runtimeId: 'sciforge', title: 'Active',
          updatedAt: '2026-07-10T00:00:00Z', workspace: '/workspace/project'
        }, {
          id: 'thread-2', runtimeId: 'codex', title: 'Also active',
          updatedAt: '2026-07-10T00:00:00Z', workspace: '/workspace/project'
        }]
      },
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://evidence.test',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
      },
      fetchImpl,
      watchFactory: () => watcher as unknown as FSWatcher,
      enqueue: async (input) => { enqueued.push(input) }
    })

    await lifecycle.start()
    await lifecycle.scanNow('/workspace/project')
    lifecycle.stop()

    expect(fetchImpl).toHaveBeenCalledWith('http://evidence.test/artifacts/resolve', expect.objectContaining({
      method: 'POST'
    }))
    expect(fetchImpl).toHaveBeenCalledWith('http://evidence.test/artifacts/events/ack', expect.objectContaining({
      method: 'POST'
    }))
    expect(enqueued).toEqual([expect.objectContaining({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      items: [],
      targetWatermark: '52',
      reason: 'artifact_changed',
      priority: 'background',
      projectContext: expect.objectContaining({
        projectKey: '/workspace/project',
        includedSessions: ['sciforge:thread-1', 'codex:thread-2']
      })
    })])
    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('does not manufacture a runtime thread when an affected session is unavailable', async () => {
    const watcher = new FakeWatcher()
    const enqueue = vi.fn()
    const log = vi.fn()
    const lifecycle = new EvidenceArtifactLifecycle({
      threads: {
        listThreads: async () => [{
          id: 'thread-1', runtimeId: 'sciforge', title: 'Active',
          updatedAt: '2026-07-10T00:00:00Z', workspace: '/workspace/project'
        }]
      },
      env: {
        SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://evidence.test',
        SCIFORGE_EVIDENCE_DAG_API_KEY: 'secret'
      },
      fetchImpl: vi.fn(async () => ok({
        events: [{
          eventId: 'artifact-event:1', type: 'ArtifactMoved',
          artifactId: 'artifact:1', outcome: 'missing'
        }],
        affectedThreads: [{
          threadId: 'codex:deleted', targetWatermark: '7', artifactIds: ['artifact:1']
        }],
        scope: {
          projectKey: '/workspace/project',
          workspaceRoot: '/workspace/project',
          projectRoot: '/workspace/project'
        }
      })) as typeof fetch,
      watchFactory: () => watcher as unknown as FSWatcher,
      enqueue,
      log
    })

    await lifecycle.start()
    await expect(lifecycle.scanNow('/workspace/project')).rejects.toThrow('is unavailable')
    lifecycle.stop()

    expect(enqueue).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Artifact change references a runtime thread that is no longer available.',
      expect.objectContaining({ threadId: 'codex:deleted' })
    )
  })
})
