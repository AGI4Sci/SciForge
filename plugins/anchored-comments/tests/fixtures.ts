/**
 * Deterministic fixtures shared by the parity, golden and host-loading suites.
 * Every timestamp is a literal so the goldens never depend on wall-clock time.
 */
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  type AnchoredCommentThread,
  type ProductFeedbackPacket
} from '../src/core/contract.js'

export const CAPTURED_AT = '2026-07-11T00:00:00.000Z'
export const MESSAGE_AT = '2026-07-11T00:00:01.000Z'
export const UPDATED_AT = '2026-07-11T00:00:01.000Z'
export const NOW = '2026-07-11T03:00:00.000Z'
export const WORKSPACE_KEY = '/workspace/example'

// Valid 2x2 PNG for automated tests only, never acceptance screenshot evidence.
export const PNG_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=',
  'base64'
))

export function researchThread(id = 'thread-1'): AnchoredCommentThread {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id,
    workspaceKey: WORKSPACE_KEY,
    purpose: 'research',
    anchor: {
      targetKey: 'figure:2',
      targetLabel: 'Figure 2',
      canonical: { kind: 'research', resourceKind: 'figure', resourceId: 'figure-2' },
      bounds: { x: 20, y: 30, width: 200, height: 120 }
    },
    capture: {
      capturedAt: CAPTURED_AT,
      appVersion: '1.0.2',
      platform: 'darwin',
      viewport: { width: 1200, height: 800, scaleFactor: 2 },
      targetLabel: 'Figure 2',
      targetBounds: { x: 20, y: 30, width: 200, height: 120 },
      unavailableReason: 'No window was available.'
    },
    messages: [{
      id: `${id}-message`,
      authorKind: 'user',
      body: 'Please check this plot.',
      createdAt: MESSAGE_AT,
      updatedAt: MESSAGE_AT
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: CAPTURED_AT,
    updatedAt: UPDATED_AT
  }
}

export function productFeedbackThread(id = 'thread-feedback'): AnchoredCommentThread {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id,
    workspaceKey: WORKSPACE_KEY,
    purpose: 'product_feedback',
    anchor: {
      targetKey: 'ui:export',
      targetLabel: 'Export button',
      canonical: { kind: 'ui', componentId: 'toolbar', elementId: 'export' },
      bounds: { x: 1, y: 1, width: 20, height: 10 }
    },
    capture: {
      capturedAt: CAPTURED_AT,
      appVersion: '1.0.2',
      platform: 'darwin',
      viewport: { width: 100, height: 60, scaleFactor: 1 },
      targetLabel: 'Export button',
      targetBounds: { x: 1, y: 1, width: 20, height: 10 },
      unavailableReason: 'Feedback threads in the fixture carry no screenshot.'
    },
    messages: [{
      id: `${id}-message`,
      authorKind: 'user',
      body: 'Export is broken.',
      createdAt: MESSAGE_AT,
      updatedAt: MESSAGE_AT
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: CAPTURED_AT,
    updatedAt: UPDATED_AT
  }
}

export function feedbackPacket(idempotencyKey = 'feedback:thread-1234567890'): ProductFeedbackPacket {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    idempotencyKey,
    threadId: 'thread-feedback',
    repository: { owner: 'sciforge', name: 'sciforge' },
    title: 'Export button does not respond',
    body: 'Clicking the export button has no visible effect.',
    disclosure: {
      annotatedScreenshots: true,
      applicationEnvironment: true,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    },
    environment: { appVersion: '1.0.2' }
  }
}

export function gatewayResult(idempotencyKey = 'feedback:thread-1234567890') {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    idempotencyKey,
    issueNumber: 42,
    issueUrl: 'https://github.com/sciforge/sciforge/issues/42',
    author: 'octocat',
    assetUrls: [],
    createdAt: NOW
  }
}

export function captureRequest() {
  return {
    targetRef: 'preview.figure:figure-2',
    targetBounds: { x: 10, y: 20, width: 120, height: 80 },
    targetLabel: 'Figure 2',
    viewport: { width: 1000, height: 800, scaleFactor: 2 }
  }
}