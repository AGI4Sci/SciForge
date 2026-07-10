import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  EvidenceDagPanel,
  runEvidenceDagUpdate
} from './EvidenceDagPanel'

const labels: Record<string, string> = {
  rightPanelEvidenceDag: 'Evidence DAG',
  rightPanelCollapse: 'Collapse right sidebar',
  evidenceDagGlobalView: 'All threads',
  evidenceDagRefresh: 'Refresh Evidence DAG',
  evidenceDagUpdate: 'Update now',
  evidenceDagUpdateRunning: 'Queueing',
  evidenceDagUpdateHelp: 'Queue an immediate incremental update for this thread',
  evidenceDagUpdateUnavailableHint: 'Open an active thread to update the DAG'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key
  })
}))

describe('EvidenceDagPanel', () => {
  it('renders a visible update action for the active thread DAG', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDagPanel, {
      activeThreadId: 'thread-1',
      runtimeId: 'codex',
      onCollapse: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('Update now')
    expect(html).toContain('aria-label="Queue an immediate incremental update for this thread"')
  })

  it('uses the dedicated update bridge when it is available', async () => {
    const updateEvidenceDag = vi.fn(async () => ({
      url: 'http://127.0.0.1:4897/?thread=codex%3Athread-1',
      threadId: 'thread-1',
      itemCount: 2,
      jobId: 'job-1',
      status: { freshness: 'queued' as const, pendingCount: 1 }
    }))

    await expect(runEvidenceDagUpdate({
      updateEvidenceDag
    }, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).resolves.toMatchObject({ itemCount: 2 })

    expect(updateEvidenceDag).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
  })

  it('reports update failures without falling back to another workflow', async () => {
    const updateEvidenceDag = vi.fn(async () => {
      throw new Error('extract failed')
    })

    await expect(runEvidenceDagUpdate({
      updateEvidenceDag
    }, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })).rejects.toThrow(/extract failed/)
  })

})
