import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createHostVisualCapturePort } from './visual-capture.js'

// Engineering fixture only; not screenshot acceptance evidence.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII='
const PNG = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'))
const SOURCE = {
  instanceId: 'instance-a', workspaceRoot: '/workspace', threadId: 'thread-a', windowId: 'window-a',
  targetRef: 'target-a', resourcePath: '/workspace/a.md', validatedRevision: 1, captureRevisionAtomic: false,
  capturedAt: '2026-11-03T05:00:00.000Z', redactionPolicy: 'registered-target-v1'
}
const SUCCESS = {
  ok: true, pngBase64: PNG_BASE64, width: 2, height: 2,
  sha256: createHash('sha256').update(PNG).digest('hex'), byteLength: PNG.byteLength,
  redacted: true, source: SOURCE
}
const REQUEST = { targetRef: 'target-a', expectedResourcePath: 'a.md', annotation: 'callout' as const, label: 'Document A' }

function fixture(value: unknown) {
  const calls: Array<{ operation: string; input: unknown }> = []
  const port = createHostVisualCapturePort({ async invoke(operation, input) { calls.push({ operation, input }); return value } })
  return { port, calls }
}

test('Host visual capture port forwards bounded target selection and preserves verified wire source', async () => {
  const { port, calls } = fixture(SUCCESS)
  const result = await port.captureRegisteredTarget(REQUEST)
  assert.deepEqual(calls, [{ operation: 'captureRegisteredTarget', input: REQUEST }])
  assert.deepEqual(result, { ok: true, png: PNG, width: 2, height: 2, sha256: SUCCESS.sha256, redacted: true, source: SOURCE })
})

test('Host visual capture port refuses missing canonical resource before making a Host request', async () => {
  const { port, calls } = fixture(SUCCESS)
  await assert.rejects(port.captureRegisteredTarget({ targetRef: 'target-a' }), /canonical resource path/)
  assert.deepEqual(calls, [])
})

for (const [name, patch] of [
  ['whitespace in base64', { pngBase64: `${PNG_BASE64}\n` }],
  ['missing base64 padding', { pngBase64: PNG_BASE64.slice(0, -1) }],
  ['non-base64 suffix', { pngBase64: `${PNG_BASE64}!` }],
  ['wrong byte count', { byteLength: PNG.byteLength + 1 }],
  ['zero byte count', { byteLength: 0 }],
  ['empty payload', { pngBase64: '' }]
] as const) {
  test(`Host visual capture port rejects ${name}`, async () => {
    const { port } = fixture({ ...SUCCESS, ...patch })
    await assert.rejects(port.captureRegisteredTarget(REQUEST))
  })
}

for (const [name, patch] of [
  ['missing source', { source: undefined }],
  ['unrecognized source field', { source: { ...SOURCE, rawDesktopId: 'forbidden' } }],
  ['empty instance identity', { source: { ...SOURCE, instanceId: '' } }],
  ['negative validated revision', { source: { ...SOURCE, validatedRevision: -1 } }],
  ['missing validated revision', { source: { ...SOURCE, validatedRevision: undefined } }],
  ['legacy revision claim', { source: { ...SOURCE, revision: 1 } }],
  ['missing atomicity limitation', { source: { ...SOURCE, captureRevisionAtomic: undefined } }],
  ['false atomic snapshot claim', { source: { ...SOURCE, captureRevisionAtomic: true } }],
  ['unknown redaction policy', { source: { ...SOURCE, redactionPolicy: 'none' } }],
  ['invalid digest', { sha256: 'not-a-digest' }],
  ['unrecognized success field', { rawWindow: {} }]
] as const) {
  test(`Host visual capture port rejects ${name}`, async () => {
    const { port } = fixture({ ...SUCCESS, ...patch })
    await assert.rejects(port.captureRegisteredTarget(REQUEST))
  })
}

test('Host visual capture port forwards explicit Host denial without image data', async () => {
  const denial = { ok: false, error: { code: 'target-redacted', message: 'Sensitive target refused' } }
  const { port } = fixture(denial)
  assert.deepEqual(await port.captureRegisteredTarget(REQUEST), denial)
})

test('Host target enumeration sends no model identity and accepts only the declared target fields', async () => {
  const targets = { targets: [{ targetRef: 'target-a', resourcePath: '/workspace/a.md', label: 'Document A' }] }
  const { port, calls } = fixture(targets)
  assert.ok(port.listTargets)
  assert.deepEqual(await port.listTargets(), targets)
  assert.deepEqual(calls, [{ operation: 'listTargets', input: {} }])
  for (const value of [
    { targets: [{ ...targets.targets[0], rawWindowId: 99 }] },
    { targets: [{ targetRef: '', resourcePath: '/workspace/a.md', label: 'A' }] },
    { targets: [], extra: true }
  ]) {
    const invalid = fixture(value).port
    await assert.rejects(invalid.listTargets!())
  }
})
