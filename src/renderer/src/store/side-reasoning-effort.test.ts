import { describe, expect, it, vi } from 'vitest'

// Mirror the module-mock pattern of chat-store-side-actions.test.ts so the
// heavy store module can be imported in a node environment.
const admissionMock = vi.hoisted(() => ({
  completeInputRecovery: vi.fn(async () => undefined),
  acceptQueuedInput: vi.fn(),
  abandonQueuedInput: vi.fn(),
  readQueuedInputs: vi.fn(),
  trySessionDecision: vi.fn()
}))
vi.mock('../agent/agent-runtime-client', () => ({ agentRuntimeClient: admissionMock }))

import { sideReasoningEffortRequestValue } from './chat-store-side-actions'

describe('side conversation reasoning effort requests', () => {
  it('never silently rewrites an explicit level (no low→off)', () => {
    expect(sideReasoningEffortRequestValue('low')).toBe('low')
    expect(sideReasoningEffortRequestValue('off')).toBe('off')
    expect(sideReasoningEffortRequestValue(' High ')).toBe('High')
    expect(sideReasoningEffortRequestValue('xhigh')).toBe('xhigh')
  })

  it('sends nothing when no level is set', () => {
    expect(sideReasoningEffortRequestValue('')).toBeUndefined()
    expect(sideReasoningEffortRequestValue('   ')).toBeUndefined()
  })
})