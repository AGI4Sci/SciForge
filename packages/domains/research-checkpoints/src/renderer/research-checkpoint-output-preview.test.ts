import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import type { ArtifactVersionReadResultV1 } from '@sciforge/domain-artifact-versions/contract'

import type { ResearchCheckpointOutputArtifactV1 } from '../contract.js'
import {
  buildExactOutputPreview,
  outputPreviewMaxBytes,
  rasterizeSanitizedSvgToPng
} from './research-checkpoint-output-preview.js'

function output(
  path: string,
  mediaType: string,
  byteLength: number,
  digest = 'a'.repeat(64)
): ResearchCheckpointOutputArtifactV1 {
  return {
    path,
    role: 'generated',
    capture: 'host-turn-boundary-exact',
    artifactOrdinal: 3,
    ref: {
      artifactId: 'artifact:output:penguins',
      versionId: 'artifact-version:output:penguins:3',
      contentDigest: digest,
      byteLength,
      mediaType,
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    }
  }
}

function readResult(
  expected: ResearchCheckpointOutputArtifactV1,
  text: string
): ArtifactVersionReadResultV1 {
  return {
    ok: true,
    value: {
      ref: expected.ref,
      dataBase64: Buffer.from(text).toString('base64')
    }
  } as ArtifactVersionReadResultV1
}

test('builds a bounded exact CSV preview with quoted fields', async () => {
  const csv = 'species,island,note\nAdelie,Torgersen,"one, two"\nGentoo,Biscoe,stable\n'
  const exact = output('results/penguins.csv', 'text/csv', Buffer.byteLength(csv), digest(csv))
  const preview = await buildExactOutputPreview(exact, readResult(exact, csv))

  assert.equal(outputPreviewMaxBytes(exact), 256 * 1024)
  assert.deepEqual(preview, {
    kind: 'table',
    columns: ['species', 'island', 'note'],
    rows: [
      ['Adelie', 'Torgersen', 'one, two'],
      ['Gentoo', 'Biscoe', 'stable']
    ],
    rowCount: 2,
    columnCount: 3,
    truncated: false
  })
})

test('never previews bytes returned for a different exact ref or payload digest', async () => {
  const csv = 'a,b\n1,2\n'
  const exact = output('results/penguins.csv', 'text/csv', Buffer.byteLength(csv), digest(csv))
  const result = readResult(exact, 'a,b\n1,2\n')
  assert.equal(result.ok, true)
  if (!result.ok) return
  const mismatched: ArtifactVersionReadResultV1 = {
    ...result,
    value: {
      ...result.value,
      ref: { ...exact.ref, contentDigest: 'b'.repeat(64) }
    }
  }

  assert.equal(await buildExactOutputPreview(exact, mismatched), undefined)
  assert.equal(await buildExactOutputPreview(exact, readResult(exact, 'a,b\n9,9\n')), undefined)
})

test('sanitizes an exact SVG then exposes only the rasterized PNG preview', async () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">',
    '<script>alert(1)</script>',
    '<foreignObject><iframe src="https://example.invalid/private"/></foreignObject>',
    '<image href="https://example.invalid/pixel.png"/>',
    '<rect width="120" height="80" fill="url(https://example.invalid/paint)"/>',
    '<circle cx="4" cy="4" r="2" fill="red"/>',
    '</svg>'
  ].join('')
  const exact = output('figures/penguins.svg', 'image/svg+xml', Buffer.byteLength(svg), digest(svg))
  let sanitizedSource = ''
  const pngDataUrl = `data:image/png;base64,${Buffer.from('bounded-png').toString('base64')}`
  const preview = await buildExactOutputPreview(exact, readResult(exact, svg), {
    rasterizeSvg: async (bytes) => {
      sanitizedSource = new TextDecoder().decode(bytes)
      return pngDataUrl
    }
  })

  assert.equal(outputPreviewMaxBytes(exact), 1024 * 1024)
  assert.deepEqual(preview, {
    kind: 'image',
    dataUrl: pngDataUrl,
    mediaType: 'image/png'
  })
  assert.match(sanitizedSource, /<circle/u)
  assert.doesNotMatch(sanitizedSource, /script|foreignObject|iframe|<image|example\.invalid/iu)
  assert.doesNotMatch(preview?.kind === 'image' ? preview.dataUrl : '', /image\/svg\+xml/iu)
})

test('does not sanitize or rasterize SVG bytes until exact digest verification succeeds', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
  const exact = output('figure.svg', 'image/svg+xml', Buffer.byteLength(svg), digest(svg))
  let sanitizeCalls = 0
  let rasterizeCalls = 0
  const preview = await buildExactOutputPreview(exact, readResult(exact, svg.replace('width="1"', 'width="9"')), {
    sanitizeSvg: (bytes) => {
      sanitizeCalls += 1
      return bytes
    },
    rasterizeSvg: async () => {
      rasterizeCalls += 1
      return 'data:image/png;base64,cG5n'
    }
  })

  assert.equal(preview, undefined)
  assert.equal(sanitizeCalls, 0)
  assert.equal(rasterizeCalls, 0)
})

test('rasterizes through a short-lived sanitized Blob when Chromium rejects SVG createImageBitmap', async () => {
  const sanitized = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024" viewBox="0 0 2048 1024">' +
    '<rect width="2048" height="1024" fill="#6b4eff"></rect></svg>'
  )
  const pngDataUrl = `data:image/png;base64,${Buffer.from('fallback-png').toString('base64')}`
  let bitmapAttempts = 0
  let assignedImageSource = ''
  let revokedUrl = ''
  let rasterBlob: Blob | undefined
  const drawCalls: unknown[][] = []
  let imageLoaded: (() => void) | null = null
  const image = {
    decoding: 'auto',
    naturalWidth: 1_024,
    naturalHeight: 512,
    get onload() { return imageLoaded },
    set onload(value: (() => void) | null) { imageLoaded = value },
    onerror: null as null | (() => void),
    set src(value: string) {
      assignedImageSource = value
      queueMicrotask(() => imageLoaded?.())
    }
  } as unknown as HTMLImageElement
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => drawCalls.push(args) }),
    toDataURL: () => pngDataUrl
  } as unknown as HTMLCanvasElement

  const preview = await rasterizeSanitizedSvgToPng(sanitized, {
    createImageBitmap: async () => {
      bitmapAttempts += 1
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
    },
    createCanvas: () => canvas,
    createImage: () => image,
    createObjectUrl: (blob) => {
      rasterBlob = blob
      return 'blob:sciforge-sanitized-svg'
    },
    revokeObjectUrl: (url) => { revokedUrl = url }
  })

  assert.equal(preview, pngDataUrl)
  assert.equal(bitmapAttempts, 1)
  assert.equal(canvas.width, 1_024)
  assert.equal(canvas.height, 512)
  assert.equal(drawCalls.length, 1)
  assert.equal(assignedImageSource, 'blob:sciforge-sanitized-svg')
  assert.equal(revokedUrl, assignedImageSource)
  assert.doesNotMatch(assignedImageSource, /^data:image\/svg\+xml/iu)
  assert.ok(rasterBlob)
  assert.equal(rasterBlob.type, 'image/svg+xml')
  assert.match(await rasterBlob.text(), /width="1024" height="512"/u)
})

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

test('does not request oversized inline image content', () => {
  assert.equal(outputPreviewMaxBytes(output('figure.svg', 'image/svg+xml', 1_024)), 1024 * 1024)
  assert.equal(outputPreviewMaxBytes(output('large.svg', 'image/svg+xml', 1024 * 1024 + 1)), undefined)
  assert.equal(outputPreviewMaxBytes(output('large.png', 'image/png', 1024 * 1024 + 1)), undefined)
  assert.equal(outputPreviewMaxBytes(output('figure.png', 'image/png', 1_024)), 1024 * 1024)
})
