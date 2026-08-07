import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  VisualReviewSurface,
  clampNormalizedPoint,
  normalizedBoxFromPoints,
  normalizedPointFromRect,
  type VisualReviewAnnotation
} from './VisualReviewSurface'
import { buildVisualRevisionRequest, VisualReviewPanel } from './VisualReviewPanel'
import type { VisualReviewCapabilityClient } from './capability-client'
import { VisualStyleControl } from './VisualStyleControl'

const source = {
  id: 'source-v1',
  src: 'asset://source.png',
  alt: 'Source figure',
  width: 1600,
  height: 900
}

const annotations: VisualReviewAnnotation[] = [
  {
    id: 'note-1',
    kind: 'box',
    geometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
    comment: 'Increase spacing around this group.',
    status: 'open'
  },
  {
    id: 'note-2',
    kind: 'pin',
    geometry: { x: 0.75, y: 0.65 },
    comment: 'Keep this label unchanged.',
    status: 'resolved'
  }
]

const capabilityClient = {} as VisualReviewCapabilityClient
const workbench = {
  openRightPanel: vi.fn()
}

describe('visual review normalized geometry', () => {
  it('converts viewport coordinates into source-relative coordinates', () => {
    expect(normalizedPointFromRect(
      { x: 250, y: 175 },
      { left: 50, top: 75, width: 400, height: 200 }
    )).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps points outside the displayed image', () => {
    expect(clampNormalizedPoint({ x: -0.4, y: 1.7 })).toEqual({ x: 0, y: 1 })
    expect(normalizedPointFromRect(
      { x: 1_000, y: -50 },
      { left: 100, top: 100, width: 300, height: 300 }
    )).toEqual({ x: 1, y: 0 })
  })

  it('normalizes reverse drag direction into a positive box', () => {
    const box = normalizedBoxFromPoints(
      { x: 0.8, y: 0.7 },
      { x: 0.2, y: 0.3 }
    )
    expect(box.x).toBe(0.2)
    expect(box.y).toBe(0.3)
    expect(box.width).toBeCloseTo(0.6)
    expect(box.height).toBeCloseTo(0.4)
  })
})

describe('VisualReviewSurface', () => {
  it('routes every image revision MCP operation through the runtime-neutral capability tools', () => {
    const request = buildVisualRevisionRequest({
      workspaceRoot: '/tmp/project',
      sessionId: 'session-1',
      documentId: 'figure-1',
      packetPath: '/tmp/project/.sciforge/visual-documents/figure-1/review-packet.json'
    })

    expect(request).toContain('providerFamily: "managed-mcp"')
    expect(request).toContain('sciforge_discover({ operationRef, includeSchema: true })')
    expect(request).toContain('sciforge_invoke({ operationRef, input })')
    expect(request).toContain('visual_generate')
    expect(request).toContain('image_generation_edit_from_visual_review_packet')
    expect(request).toContain('image_generation_review_candidate')
    expect(request).toContain('capabilityId: "visual-review.create-candidate"')
    expect(request).toContain('会话 ID：session-1')
    expect(request).toContain('不能把 visual_generate')
  })

  it('carves the desktop review panel out of the Electron window drag region', () => {
    const markup = renderToStaticMarkup(createElement(VisualReviewPanel, {
      workspaceRoot: '/tmp/project',
      sessionId: 'session-1',
      documentId: 'figure-1',
      onCollapse: vi.fn(),
      client: capabilityClient,
      workbench
    }))

    expect(markup).toContain('class="ds-no-drag ')
  })

  it('renders an annotation-first surface without an external editor dependency', () => {
    const markup = renderToStaticMarkup(createElement(VisualReviewSurface, {
      source,
      annotations,
      onAnnotationsChange: vi.fn(),
      onRequestRevision: vi.fn()
    }))

    expect(markup).toContain('图像审改')
    expect(markup).toContain('框选')
    expect(markup).toContain('圈画')
    expect(markup).toContain('Increase spacing around this group.')
    expect(markup).toContain('1 条待处理')
    expect(markup).toContain('生成修改版')
    expect(markup).not.toContain('iframe')
  })

  it('renders the package-owned image style recognition control', () => {
    const markup = renderToStaticMarkup(createElement(VisualStyleControl, {
      workspaceRoot: '/tmp/project',
      documentId: 'figure-1',
      profileRef: null,
      client: capabilityClient,
      onApplied: vi.fn()
    }))

    expect(markup).toContain('风格：保持当前图片')
  })

  it('renders candidate comparison and explicit human acceptance controls', () => {
    const markup = renderToStaticMarkup(createElement(VisualReviewSurface, {
      source,
      candidate: { ...source, id: 'candidate-v2', src: 'asset://candidate.png' },
      annotations,
      mode: 'compare',
      comparisonMode: 'overlay',
      onAccept: vi.fn(),
      onReject: vi.fn(),
      onContinueAnnotating: vi.fn()
    }))

    expect(markup).toContain('修改前')
    expect(markup).toContain('修改后')
    expect(markup).toContain('分割对比')
    expect(markup).toContain('叠加对比')
    expect(markup).toContain('接受并替换')
    expect(markup).toContain('继续批注')
    expect(markup).toContain('拒绝')
    expect(markup).toContain('candidate.png')
  })
})
