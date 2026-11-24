import { describe, expect, it, vi } from 'vitest'
import { context, definitions, receipt, recordingInvoker } from './test-support.js'
import { reviewReceiptSchema } from './contract.js'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'

describe('receipt privacy', () => {
  it('serializes only the allowed receipt fields', () => {
    const parsed = JSON.parse(JSON.stringify(reviewReceiptSchema.parse(receipt)))
    expect(Object.keys(parsed).sort()).toEqual(['actorHash', 'artifactVersion', 'openedAt', 'submittedAt', 'verdict'])
    for (const key of ['rawText', 'comment', 'pid', 'open_id']) expect(parsed).not.toHaveProperty(key)
  })
  it.each(['commentBody', 'participantId', 'accountId', 'apiKey'])('rejects %s before committing or logging its value', async (key) => {
    const { invoker, calls } = recordingInvoker()
    const sentinel = 'synthetic-sensitive-sentinel'
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    try {
      let error: unknown
      try {
        await definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt: { ...receipt, [key]: sentinel } }, context)
      } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).not.toContain(sentinel)
      expect(calls).toHaveLength(0)
      expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(sentinel)
    } finally { spies.forEach((spy) => spy.mockRestore()) }
  })
  it('seals only the validated content-free payload', async () => {
    const { invoker, calls } = recordingInvoker()
    await definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, context)
    const candidates = calls[0]!.input.candidates as Array<{ content: { dataBase64: string } }>
    const payload = JSON.parse(Buffer.from(candidates[0]!.content.dataBase64, 'base64').toString('utf8'))
    expect(payload).toEqual(receipt)
    expect(Object.keys(payload).filter((key) => /actor|account|participant|identity/i.test(key))).toEqual(['actorHash'])
  })
  it('does not expose arbitrary downstream exception content', async () => {
    const invoker = { invoke: async () => { throw new Error('synthetic-private-sentinel') } } as unknown as NonNullable<DomainMainHost['capabilities']>
    let error: unknown
    try { await definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, context) }
    catch (caught) { error = caught }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('synthetic-private-sentinel')
  })
  it.todo('checks production trace and generated document outputs once their owners and entrypoints are specified')
})
