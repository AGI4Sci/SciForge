import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createModelRouterVisualInspector } from './visual-inspection.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb])

test('runs a multi-artifact visual task through Model Router with MIME-correct inputs and anchored evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const chartPath = join(root, 'chart.png')
  const photoPath = join(root, 'photo.jpg')
  await Promise.all([
    writeFile(chartPath, PNG_BYTES),
    writeFile(photoPath, JPEG_BYTES)
  ])
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
          summary: 'The chart and photo both show the requested sample.',
          claims: [{
            kind: 'observation',
            text: 'The highlighted chart region contains a rising curve.',
            artifactId: 'chart',
            region: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
            confidence: 0.93
          }, {
            kind: 'observation',
            text: 'The photo contains the same sample label.',
            artifactId: 'photo',
            confidence: 0.88
          }],
          uncertainties: ['The smallest chart tick is not legible.'],
          structuredResult: { matched: true }
        })
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })

  const result = await inspector({
    task: 'Compare the sample identity across the chart and photo.',
    artifacts: [{
      id: 'chart',
      imagePath: chartPath,
      mimeType: 'image/png',
      regions: [{ id: 'curve', label: 'Primary curve', x: 0.1, y: 0.2, width: 0.5, height: 0.4 }]
    }, {
      id: 'photo',
      imagePath: photoPath,
      mimeType: 'image/jpeg'
    }],
    truthLocks: ['Sample labels must be read verbatim.'],
    outputIntent: { kind: 'comparison', instructions: 'Return whether the identities match.' }
  })

  assert.equal(result.status, 'inspected')
  if (result.status !== 'inspected') return
  assert.equal(result.provider, 'model-router')
  assert.equal(result.model, 'sciforge-model-router')
  assert.equal(result.inspectedAt, '2026-07-13T00:00:00.000Z')
  assert.equal(result.artifacts.length, 2)
  assert.deepEqual(result.artifacts.map(({ id, mimeType }) => ({ id, mimeType })), [
    { id: 'chart', mimeType: 'image/png' },
    { id: 'photo', mimeType: 'image/jpeg' }
  ])
  assert.match(result.artifacts[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.match(result.requestSha256, /^[a-f0-9]{64}$/u)
  assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/u)
  assert.match(result.attestation, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(result.claims[0]?.artifactId, 'chart')
  assert.deepEqual(result.claims[0]?.region, { x: 0.1, y: 0.2, width: 0.5, height: 0.4 })
  assert.deepEqual(result.uncertainties, ['The smallest chart tick is not legible.'])
  assert.deepEqual(result.structuredResult, { matched: true })

  assert.equal(capturedRequest?.url, 'http://127.0.0.1:3892/v1/responses')
  assert.equal(capturedRequest?.headers.get('authorization'), 'Bearer runtime-test-key')
  const body = await capturedRequest?.json() as {
    model: string
    input: Array<{ content: Array<{ type: string; text?: string; image_url?: string; mime_type?: string }> }>
  }
  const content = body.input[0]?.content ?? []
  assert.equal(body.model, 'sciforge-model-router')
  assert.match(content[0]?.text ?? '', /Compare the sample identity/u)
  assert.match(content[0]?.text ?? '', /Sample labels must be read verbatim/u)
  assert.match(content[0]?.text ?? '', /at least one visibly grounded claim for every supplied artifact/u)
  assert.match(content[2]?.image_url ?? '', /^data:image\/png;base64,/u)
  assert.equal(content[2]?.mime_type, 'image/png')
  assert.match(content[4]?.image_url ?? '', /^data:image\/jpeg;base64,/u)
  assert.equal(content[4]?.mime_type, 'image/jpeg')
})

test('fails closed when Model Router returns a claim for an unknown artifact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-invalid-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  const inspector = createModelRouterVisualInspector({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'runtime-test-key',
    model: 'sciforge-model-router',
    fetchImpl: async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'Unsupported claim anchor.',
        claims: [{
          kind: 'observation',
          text: 'Invented image claim.',
          artifactId: 'missing',
          confidence: 0.9
        }],
        uncertainties: []
      })
    }), { status: 200 })
  })

  const result = await inspector({
    task: 'Describe the image.',
    artifacts: [{ id: 'capture', imagePath, mimeType: 'image/png' }]
  })

  assert.deepEqual(result, {
    status: 'visual_inspection_invalid',
    message: 'Model Router visual inspection returned an invalid evidence payload.'
  })
})

test('fails closed when Model Router returns no structured visual evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-unstructured-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  const inspector = createModelRouterVisualInspector({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'runtime-test-key',
    model: 'sciforge-model-router',
    fetchImpl: async () => new Response(JSON.stringify({ output_text: 'looks fine' }), { status: 200 })
  })

  const result = await inspector({
    task: 'Describe the image.',
    artifacts: [{ id: 'capture', imagePath, mimeType: 'image/png' }]
  })

  assert.deepEqual(result, {
    status: 'visual_inspection_invalid',
    message: 'Model Router visual inspection returned an invalid evidence payload.'
  })
})

test('fails closed when Model Router masks an upstream visual failure as structured text-only output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-degraded-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  const inspector = createModelRouterVisualInspector({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'runtime-test-key',
    model: 'sciforge-model-router',
    fetchImpl: async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'The image could not be inspected.',
        claims: [],
        uncertainties: ['The visual translator was unavailable.']
      })
    }), { status: 200 })
  })

  const result = await inspector({
    task: 'Describe the image.',
    artifacts: [{ id: 'capture', imagePath, mimeType: 'image/png' }]
  })

  assert.deepEqual(result, {
    status: 'visual_inspection_invalid',
    message: 'Model Router visual inspection returned an invalid evidence payload.'
  })
})

test('rejects remote or malformed Model Router URLs before fetch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-router-url-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const imagePath = join(root, 'capture.png')
  await writeFile(imagePath, PNG_BYTES)
  const rejectedUrls = [
    'https://api.openai.com/v1',
    'http://model-router.internal/v1',
    'http://user:secret@127.0.0.1:3892/v1',
    'http://127.0.0.1:3892/v1?provider=openai',
    'http://127.0.0.1:3892/v1#responses',
    'http://127.0.0.1:3892/provider/v1',
    'file:///v1'
  ]
  let fetchCount = 0

  for (const baseUrl of rejectedUrls) {
    const inspector = createModelRouterVisualInspector({
      baseUrl,
      apiKey: 'runtime-test-key',
      model: 'sciforge-model-router',
      fetchImpl: async () => {
        fetchCount += 1
        return new Response('{}', { status: 200 })
      }
    })
    const result = await inspector({
      task: 'Describe the image.',
      artifacts: [{ id: 'capture', imagePath, mimeType: 'image/png' }]
    })
    assert.deepEqual(result, {
      status: 'visual_inspection_unavailable',
      message: 'Visual understanding requires a local SciForge Model Router URL at http(s)://<loopback>/v1.'
    })
  }

  assert.equal(fetchCount, 0)
})
