import { describe, expect, it } from 'vitest'
import { normalizeScheduleModel, normalizeScheduleReasoningEffort } from './app-settings-normalizers'
import {
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  SCHEDULE_REASONING_EFFORT_IDS
} from './app-settings-types'

describe('schedule normalizers no longer invent defaults', () => {
  it('defaults reasoning to unset instead of fabricating medium', () => {
    expect(DEFAULT_SCHEDULE_REASONING_EFFORT).toBe('')
    expect(SCHEDULE_REASONING_EFFORT_IDS.includes('')).toBe(true)
    expect(normalizeScheduleReasoningEffort(undefined)).toBe('')
    expect(normalizeScheduleReasoningEffort(null)).toBe('')
    expect(normalizeScheduleReasoningEffort('')).toBe('')
    expect(normalizeScheduleReasoningEffort('legacy-turbo')).toBe('')
  })

  it('preserves every explicit token, including a legacy stored medium', () => {
    for (const token of ['off', 'low', 'medium', 'high', 'max'] as const) {
      expect(normalizeScheduleReasoningEffort(token)).toBe(token)
    }
    // 'medium' may be a legacy default or a real user choice — it is kept
    // verbatim; migration only stops *new* tasks from being filled in.
    expect(normalizeScheduleReasoningEffort('medium')).toBe('medium')
  })

  it('keeps the legacy model normalizer behaviour (field no longer drives execution)', () => {
    expect(normalizeScheduleModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeScheduleModel('auto')).toBe('auto')
    expect(normalizeScheduleModel('something-else')).toBe('auto')
  })
})