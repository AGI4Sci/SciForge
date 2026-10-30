/**
 * The Worker-delivery view is the only shape the collaboration renderer sees.
 * These cases pin the redaction-by-construction contract: service addresses,
 * credentials, auth headers or raw requests can never travel inside it, while
 * structured failure facts (state + bounded error text) survive.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { workerDeliveryViewSchema, type WorkerDeliveryView } from './worker-delivery.js'

const BASE = {
  projectId: 'project-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  state: 'blocked' as const,
  draft: null,
  confirmationTarget: null,
  history: [],
  candidate: null,
  operationId: null,
  deliveryManifestId: null,
  error: 'Worker execution failed before producing a result.',
  residuals: []
} satisfies WorkerDeliveryView

test('the documented worker delivery view shape parses', () => {
  assert.equal(workerDeliveryViewSchema.safeParse(BASE).success, true)
})

test('service addresses, credentials, auth headers and raw requests can never enter the view', () => {
  const leaks = [
    { endpoint: 'https://upstream.example/v1' },
    { apiKey: 'sk-live-123' },
    { authorization: 'Bearer sk-live-123' },
    { baseUrl: 'https://upstream.example/v1' },
    { rawRequest: { model: 'x', messages: [] } }
  ]
  for (const leak of leaks) {
    const key = Object.keys(leak)[0]
    assert.equal(
      workerDeliveryViewSchema.safeParse({ ...BASE, ...leak }).success,
      false,
      `view must not accept ${key}`
    )
  }
})

test('the structured failure state and its bounded, sanitized reason survive', () => {
  const parsed = workerDeliveryViewSchema.parse({
    ...BASE,
    state: 'blocked',
    error: 'Upstream rejected the request (HTTP 422). Detail redacted.'
  })
  assert.equal(parsed.state, 'blocked')
  assert.match(String(parsed.error), /HTTP 422/u)
})
