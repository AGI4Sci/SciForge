import { describe, expect, it } from 'vitest'
import { scientificPlotEvidenceDeliveryReceiptV1Schema } from './contract'

const base = {
  schemaVersion: 1,
  consumer: 'evidence-dag',
  producer: 'scientific-plotting',
  operationId: 'plot-operation-delivery-0001',
  createdAt: '2026-08-20T00:00:00.000Z',
  runtimeId: 'codex',
  threadId: 'thread-1',
  sourceDigest: 'a'.repeat(64)
}

describe('Evidence delivery receipt persisted by earlier consumers', () => {
  it('reads the current committed generation', () => {
    const parsed = scientificPlotEvidenceDeliveryReceiptV1Schema.parse({
      ...base,
      state: 'committed',
      deltaDigest: `sha256:${'b'.repeat(64)}`
    })
    expect(parsed.state).toBe('committed')
  })

  it('reads the job-queue generation written before 2026-09-02', () => {
    const parsed = scientificPlotEvidenceDeliveryReceiptV1Schema.parse({
      ...base,
      state: 'enqueued',
      jobId: 'evidence-job-legacy'
    })
    expect(parsed.state).toBe('enqueued')
  })

  it('refuses mixed shapes and unknown states', () => {
    expect(() => scientificPlotEvidenceDeliveryReceiptV1Schema.parse({
      ...base, state: 'committed', jobId: 'evidence-job-legacy'
    })).toThrow()
    expect(() => scientificPlotEvidenceDeliveryReceiptV1Schema.parse({
      ...base, state: 'enqueued', deltaDigest: `sha256:${'b'.repeat(64)}`
    })).toThrow()
    expect(() => scientificPlotEvidenceDeliveryReceiptV1Schema.parse({ ...base, state: 'delivered' })).toThrow()
  })
})
