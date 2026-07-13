import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createModelRouterVisualInspector } from './visual-inspection.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('runs semantic screenshot inspection through Model Router and returns an attestation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  let capturedRequest: Request | undefined
  const inspector = createModelRouterVisualInspector({
    baseUrl: 'http://127.0.0.1:3892/v1/',
    apiKey: 'runtime-test-key',
    model: 'sciforge-model-router',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      capturedRequest = new Request(input, init)
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          summary: 'The table is visible and the second column is cramped.',
          visibleFacts: ['Two table columns are visible.'],
          layoutIssues: ['The description column wraps too aggressively.'],
          recommendedActions: ['Widen the description column.'],
          confidence: 0.93
        })
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })

  const result = await inspector({
    imagePath,
    prompt: 'Verify the final table layout.',
    truthLockedElements: ['Capability column must be first.']
  })

  assert.equal(result.status, 'inspected')
  if (result.status !== 'inspected') return
  assert.equal(result.provider, 'model-router-vision')
  assert.equal(result.model, 'sciforge-model-router')
  assert.equal(result.inspectedAt, '2026-07-13T00:00:00.000Z')
  assert.match(result.captureSha256, /^[a-f0-9]{64}$/u)
  assert.match(result.observationSha256, /^[a-f0-9]{64}$/u)
  assert.match(result.attestation, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(result.layoutIssues, ['The description column wraps too aggressively.'])

  assert.equal(capturedRequest?.url, 'http://127.0.0.1:3892/v1/responses')
  assert.equal(capturedRequest?.headers.get('authorization'), 'Bearer runtime-test-key')
  const body = await capturedRequest?.json() as {
    model: string
    input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>
  }
  assert.equal(body.model, 'sciforge-model-router')
  assert.match(body.input[0]?.content[0]?.text ?? '', /Verify the final table layout/u)
  assert.match(body.input[0]?.content[0]?.text ?? '', /Capability column must be first/u)
  assert.match(body.input[0]?.content[1]?.image_url ?? '', /^data:image\/png;base64,/u)
})

test('fails closed when Model Router returns no structured visual observation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-invalid-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  const inspector = createModelRouterVisualInspector({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'runtime-test-key',
    model: 'sciforge-model-router',
    fetchImpl: async () => new Response(JSON.stringify({ output_text: 'looks fine' }), { status: 200 })
  })

  const result = await inspector({ imagePath })

  assert.deepEqual(result, {
    status: 'visual_inspection_invalid',
    message: 'Model Router visual inspection returned an invalid observation payload.'
  })
})
