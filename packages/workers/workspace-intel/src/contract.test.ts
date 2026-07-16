import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VisualCaptureInputSchema,
  WorkspaceImageInspectInputSchema,
  WorkspaceListInputSchema,
  WorkspaceReadInputSchema,
  WorkspaceTreeInputSchema,
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  workspaceFileResourceUri
} from './contract.js'

test('workspace intel schemas reject unbounded inputs', () => {
  const snapshotToken = `vc_${'a'.repeat(64)}`
  assert.equal(WorkspaceListInputSchema.safeParse({ limit: 0 }).success, false)
  assert.equal(WorkspaceListInputSchema.safeParse({ depth: 999 }).success, false)
  assert.equal(WorkspaceTreeInputSchema.safeParse({ depth: 999 }).success, false)
  assert.equal(WorkspaceReadInputSchema.safeParse({ path: 'a.txt', maxBytes: 0 }).success, false)
  assert.equal(WorkspaceReadInputSchema.safeParse({ path: '' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'window' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({
    scope: 'window',
    snapshotToken,
    task: 'Inspect the final layout.',
    truthLocks: ['Capability is the first column.'],
    outputIntent: { kind: 'quality-review' }
  }).success, true)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'window', snapshotToken, task: '' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'window', snapshotToken, requireSemanticInspection: false }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'window', snapshotToken, inspectionPrompt: 'old input' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'window', snapshotToken, targetId: 'page' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({ scope: 'target' }).success, false)
  assert.equal(VisualCaptureInputSchema.safeParse({
    scope: 'target',
    snapshotToken,
    componentId: 'preview',
    targetId: 'current-page'
  }).success, true)
  assert.equal(WorkspaceImageInspectInputSchema.safeParse({
    task: 'Compare both artifacts.',
    artifacts: [{
      id: 'before',
      path: 'before.jpg',
      regions: [{ id: 'subject', x: 0.1, y: 0.2, width: 0.5, height: 0.4 }]
    }, {
      id: 'after',
      path: 'after.webp'
    }],
    outputIntent: { kind: 'comparison' }
  }).success, true)
  assert.equal(WorkspaceImageInspectInputSchema.safeParse({
    task: 'Compare both artifacts.',
    artifacts: [{ id: 'duplicate', path: 'before.jpg' }, { id: 'duplicate', path: 'after.jpg' }]
  }).success, false)
  assert.equal(WorkspaceImageInspectInputSchema.safeParse({
    task: 'Inspect a region.',
    artifacts: [{
      id: 'image',
      path: 'image.png',
      regions: [{ id: 'outside', x: 0.8, y: 0, width: 0.4, height: 1 }]
    }]
  }).success, false)
  assert.equal(WorkspaceImageInspectInputSchema.safeParse({ path: 'old.png' }).success, false)
})

test('workspace resource URI helpers keep paths encoded and stable', () => {
  assert.equal(WORKSPACE_TREE_RESOURCE_URI, 'workspace://tree')
  assert.equal(WORKSPACE_FILE_RESOURCE_URI_TEMPLATE, 'workspace://file/{+path}')
  assert.equal(workspaceFileResourceUri('src/a file.ts'), 'workspace://file/src/a%20file.ts')
  assert.equal(workspaceFileResourceUri('/src/a#b.ts'), 'workspace://file/src/a%23b.ts')
})
