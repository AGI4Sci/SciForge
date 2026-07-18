import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DagPanelStatus } from '@shared/sciforge-api'
import {
  DAG_PANEL_PRIORITY_SIGNAL,
  DagProgressiveLegend,
  buildDagPanelPrioritySignal,
  dagPanelIsForeground,
  dagProgressiveView,
  postDagPanelPrioritySignal
} from './dag-progressive-view'

const labels: Record<string, string> = {
  dagProgressiveLayers: 'Committed graph and staging overlay',
  dagProgressiveLifecycle: 'Lifecycle',
  'dagNodeStage.collected': 'Collected',
  'dagNodeStage.extracting': 'Extracting',
  'dagNodeStage.pending_verification': 'Pending verification',
  'dagNodeStage.committed': 'Committed',
  dagTemporaryEdges: 'Temporary edges {{count}}',
  dagTemporaryEdgeHelp: 'Dashed edges belong to the staging overlay.',
  dagStagingAuditWarning: 'Staging results are excluded from audit until committed.',
  dagCommittedAuditEligible: 'Only the committed graph is eligible for audit.'
}

function t(key: string, values?: Record<string, unknown>): string {
  return (labels[key] ?? key).replace(/\{\{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? ''))
}

function progressiveStatus(): DagPanelStatus {
  return {
    freshness: 'updating',
    pendingCount: 6,
    progressiveView: {
      committed: {
        nodeCount: 14,
        edgeCount: 18,
        snapshotDigest: 'sha256:committed'
      },
      staging: {
        overlayId: 'overlay-2',
        collectedCount: 6,
        extractingCount: 3,
        pendingVerificationCount: 2,
        temporaryEdgeCount: 4
      }
    }
  }
}

describe('DAG progressive view', () => {
  it('renders committed and staging lifecycle stages with a dashed temporary-edge key', () => {
    const html = renderToStaticMarkup(createElement(DagProgressiveLegend, {
      status: progressiveStatus(),
      t
    }))

    expect(html).toContain('aria-label="Committed graph and staging overlay"')
    expect(html).toContain('data-dag-node-stage="collected"')
    expect(html).toContain('data-dag-node-stage="extracting"')
    expect(html).toContain('data-dag-node-stage="pending_verification"')
    expect(html).toContain('data-dag-node-stage="committed"')
    expect(html).toContain('Temporary edges 4')
    expect(html).toContain('border-dashed')
    expect(html).toContain('excluded from audit until committed')
  })

  it('keeps older services compatible by deriving a staging summary from panel status', () => {
    expect(dagProgressiveView({ freshness: 'updating', pendingCount: 3 })).toEqual({
      inferred: true,
      committed: { nodeCount: 0, edgeCount: 0 },
      staging: {
        collectedCount: 0,
        extractingCount: 3,
        pendingVerificationCount: 0,
        temporaryEdgeCount: 0
      }
    })
  })

  it('sends a foreground priority request for both graph layers when the panel is visible', () => {
    const target = { postMessage: vi.fn() }
    const signal = buildDagPanelPrioritySignal({
      dag: 'project',
      visible: true,
      status: progressiveStatus()
    })

    expect(signal).toMatchObject({
      type: DAG_PANEL_PRIORITY_SIGNAL,
      version: 1,
      dag: 'project',
      visible: true,
      priority: 'foreground',
      requestedLayers: ['committed', 'staging']
    })
    expect(postDagPanelPrioritySignal(target, signal)).toBe(true)
    expect(target.postMessage).toHaveBeenCalledWith(signal, '*')
  })

  it('expresses background priority when the panel is hidden or unmounted', () => {
    expect(buildDagPanelPrioritySignal({ dag: 'evidence', visible: false })).toEqual({
      type: DAG_PANEL_PRIORITY_SIGNAL,
      version: 1,
      dag: 'evidence',
      visible: false,
      priority: 'background',
      requestedLayers: ['committed', 'staging']
    })
    expect(postDagPanelPrioritySignal(null, buildDagPanelPrioritySignal({
      dag: 'evidence',
      visible: false
    }))).toBe(false)
  })

  it('requires both an active panel and a visible document for foreground priority', () => {
    expect(dagPanelIsForeground(true, 'visible')).toBe(true)
    expect(dagPanelIsForeground(false, 'visible')).toBe(false)
    expect(dagPanelIsForeground(true, 'hidden')).toBe(false)
    expect(dagPanelIsForeground(false, 'hidden')).toBe(false)
    expect(dagPanelIsForeground(true)).toBe(true)
    expect(dagPanelIsForeground(false)).toBe(false)
  })
})
