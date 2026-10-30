import { describe, expect, it } from 'vitest'
import { agentVisualLookInputSchema } from './agent-visual'

const resRef = `res_${'a'.repeat(24)}`
const targetRef = `target_${'t'.repeat(24)}`

describe('agentVisualLookInputSchema', () => {
  it('accepts a workspace-preview resourceRef as sourceRef', () => {
    expect(agentVisualLookInputSchema.safeParse({
      sourceRef: resRef,
      task: 'Inspect the figure.'
    }).success).toBe(true)
  })

  it('accepts a live-target ref as targetRef', () => {
    expect(agentVisualLookInputSchema.safeParse({
      targetRef,
      task: 'Inspect the surface target.'
    }).success).toBe(true)
  })

  it('rejects a resourceRef in targetRef with a sourceRef-directed message', () => {
    const result = agentVisualLookInputSchema.safeParse({
      targetRef: resRef,
      task: 'Inspect the figure.'
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((entry) => entry.path[0] === 'targetRef')
      expect(issue?.message).toContain('sourceRef')
      expect(issue?.message).toContain('target_')
    }
  })

  it('rejects a live-target ref in sourceRef with the accepted prefix shapes', () => {
    const result = agentVisualLookInputSchema.safeParse({
      sourceRef: targetRef,
      task: 'Inspect the surface target.'
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((entry) => entry.path[0] === 'sourceRef')
      expect(issue?.message).toContain('res_/artifact_/snapshot_')
    }
  })
})
