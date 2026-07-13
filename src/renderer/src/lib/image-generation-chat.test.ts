import { describe, expect, it } from 'vitest'
import { buildImageGenerationWorkflowPrompt } from './image-generation-chat'

describe('visual artifact chat workflow', () => {
  it('builds a route-neutral workflow prompt with shared artifact arguments', () => {
    const prompt = buildImageGenerationWorkflowPrompt('一张神经网络架构示意图', {
      workspaceRoot: '/tmp/workspace',
      visualDocumentId: 'paper-figure-6',
      threadId: 'thread-1'
    })

    expect(prompt).toContain('[SciForge artifact request]')
    expect(prompt).toContain('一张神经网络架构示意图')
    expect(prompt).toContain('does not select a renderer')
    expect(prompt).not.toContain('Route selection and execution')
    expect(prompt).toContain('"workspaceRoot":"/tmp/workspace"')
    expect(prompt).toContain('"visualDocumentId":"paper-figure-6"')
    expect(prompt).toContain('"threadId":"thread-1"')
  })

  it('leaves route selection to the runtime policy', () => {
    const prompt = buildImageGenerationWorkflowPrompt('根据论文数据画图')

    expect(prompt).toContain('The runtime scientific-visual policy owns route selection')
    expect(prompt).not.toContain('image_generation_render')
  })
})
