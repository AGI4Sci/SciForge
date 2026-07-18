import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  EvidenceDagPanel,
  evidenceDagViewUrlWithNode,
  runEvidenceDagUpdate,
  withEvidenceDagViewTimeout
} from './EvidenceDagPanel'

const labels: Record<string, string> = {
  rightPanelEvidenceDag: 'Evidence DAG',
  dagRuntimeToggle: 'Toggle DAG background processing',
  dagRuntimeToggleHelp: 'Shared DAG switch',
  dagRuntimeEnabled: 'DAG on',
  dagRuntimeDisabled: 'DAG off',
  dagRuntimeSaving: 'Applying',
  dagRuntimeLoading: 'Checking DAG status',
  dagRuntimeLoadFailed: 'Could not read DAG settings',
  dagRuntimePausedTitle: 'DAG background processing is paused',
  dagRuntimePausedDescription: 'Turn it on to resume.',
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
      ownerSessionId: 'thread-1',
      runtimeId: 'codex',
      onCollapse: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-label="Toggle DAG background processing"')
    expect(html).toContain('Update now')
    expect(html).toContain('aria-label="Queue an immediate incremental update for this thread"')
  })

  it('keeps the runtime switch available while DAG processing is paused', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDagPanel, {
      ownerSessionId: 'thread-1',
      runtimeId: 'codex',
      onCollapse: vi.fn(),
      dagRuntimeControl: {
        enabled: false,
        saving: false,
        error: null,
        setEnabled: vi.fn()
      }
    }))

    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('DAG background processing is paused')
  })

  it('keeps the retained panel rendered while it has background priority', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDagPanel, {
      ownerSessionId: 'thread-1',
      runtimeId: 'codex',
      active: false,
      onCollapse: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('Update now')
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

  it('does not leave the panel waiting forever when view startup stalls', async () => {
    await expect(withEvidenceDagViewTimeout(new Promise(() => undefined), 1))
      .rejects.toThrow(/did not become ready in time/)
  })

  it('restores a returned Evidence node without exposing the iframe token', () => {
    expect(evidenceDagViewUrlWithNode(
      'http://127.0.0.1:4897/?thread=thread-1#token=secret',
      'source_assertion:1',
      true
    )).toBe('http://127.0.0.1:4897/?thread=thread-1&node=source_assertion%3A1&preview=trusted#token=secret')
    expect(evidenceDagViewUrlWithNode('http://127.0.0.1:4897/', undefined, true))
      .toBe('http://127.0.0.1:4897/?preview=trusted')
    expect(evidenceDagViewUrlWithNode('not a url', 'source_assertion:1')).toBe('not a url')
  })

})
