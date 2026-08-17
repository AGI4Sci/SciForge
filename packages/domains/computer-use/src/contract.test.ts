import { describe, expect, it } from 'vitest'
import { computerUseRunInputSchema, computerUseTargetSchema } from './contract'

describe('Computer Use structured contract', () => {
  it('accepts bounded single-session actions', () => {
    expect(computerUseRunInputSchema.parse({
      sessionId: '55a6d04e-c87d-4cd2-87ab-309cab4347c7',
      semanticAction: {
        kind: 'sequence',
        steps: [
          { kind: 'click', role: 'button', name: 'Commit' },
          { kind: 'type', text: 'bounded' },
          { kind: 'press', keys: ['Enter'] },
          { kind: 'scroll', deltaY: 200 }
        ]
      },
      expectedRevision: 'cdp:7',
      deadlineMs: 30_000,
      instruction: 'audit context only'
    })).toMatchObject({ expectedRevision: 'cdp:7' })
  })

  it('rejects instruction-only and parallel inputs', () => {
    expect(computerUseRunInputSchema.safeParse({ instruction: 'click' }).success).toBe(false)
    expect(computerUseRunInputSchema.safeParse({ parallel: [] }).success).toBe(false)
  })

  it('only accepts generation-bound CDP targets', () => {
    expect(computerUseTargetSchema.parse({
      targetId: 'target-1', kind: 'browser-page', ownership: 'attached',
      locator: { cdpTargetId: 'one' }, generation: 'generation-1'
    }).kind).toBe('browser-page')
    expect(computerUseTargetSchema.safeParse({
      targetId: 'target-2', kind: 'windows-uia', ownership: 'attached', locator: {}, generation: 'g'
    }).success).toBe(false)
  })
})
