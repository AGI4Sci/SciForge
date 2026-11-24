import { expect, test } from 'vitest'
import { projectCreateCommandSchema } from './cloud-state-protocol.js'
import { projectSchema } from './entities.js'

test('project creation and persisted project accept a blank description', () => {
  for (const goal of ['', '   ', 'Research objective']) {
    expect(projectCreateCommandSchema.shape.goal.parse(goal)).toBe(goal.trim())
    expect(projectSchema.shape.goal.parse(goal)).toBe(goal.trim())
  }
  expect(projectCreateCommandSchema.shape.goal.safeParse('x'.repeat(32_001)).success).toBe(false)
  expect(projectSchema.shape.goal.safeParse(null).success).toBe(false)
})
