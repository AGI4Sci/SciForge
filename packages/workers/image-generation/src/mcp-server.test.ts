import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import * as engine from './image-generation-engine'
import { planVisualProduction } from './visual-production-planner'
import { createImageGenerationMcpServer } from './mcp-server'

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

describe('image generation MCP', () => {
  it('discovers hybrid composition and preserves its invocation arguments without fabricating an operation reference', async () => {
    const plan = planVisualProduction({ task: 'Plot exact values over an illustration.', requirements: {
      lockedElements: ['values'], modelOwnedElements: ['background'], reproducibleInputs: ['data.csv']
    } })
    if (!plan.ok || plan.status === 'needs_context') throw new Error('Expected a terminal hybrid plan')
    const render = vi.spyOn(engine, 'renderImageGeneration').mockResolvedValue({
      ok: true, status: 'rendered', outputPath: '/tmp/visual-layer.png', manifestPath: '/tmp/visual-layer.json'
    } as never)
    const server = createImageGenerationMcpServer({ workspaceRoot: '/tmp/visual-generate-test' })
    const client = new Client({ name: 'hybrid-image-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const prepared = await client.callTool({ name: 'image_generation_prepare', arguments: {
        task: 'Plot exact values over an illustration.', visualPlan: plan.handoff,
        referencePath: '/tmp/truth-layer.png'
      } })
      const rendered = await client.callTool({ name: 'image_generation_render',
        arguments: record(record(prepared.structuredContent).nextCall).arguments })
      const content = record(rendered.structuredContent)
      expect(content.nextCall).toEqual({ tool: 'sciforge_discover', arguments: {
        capabilityId: 'scientific-plotting.composite', includeSchema: true, limit: 1
      } })
      expect(content.invocationHandoff).toEqual({
        tool: 'sciforge_invoke', capabilityId: 'scientific-plotting.composite',
        requires: ['discoveredOperationRef', 'callerPersistedOperationId'],
        arguments: {
          workspaceRoot: '/tmp/visual-generate-test', visualPlan: plan.handoff,
          reviewTask: expect.any(String), layers: [
            { path: '/tmp/visual-layer.png', owner: 'model' },
            { path: '/tmp/truth-layer.png', owner: 'code' }
          ]
        }
      })
      expect(JSON.stringify(content)).not.toContain('scientific_plotting_composite')
      expect(content.invocationHandoff).not.toHaveProperty('operationRef')
      expect(content.invocationHandoff.arguments).not.toHaveProperty('operationRef')
      expect(render).toHaveBeenCalledOnce()
    } finally {
      render.mockRestore()
      await client.close()
      await server.close()
    }
  })
  it('exposes visual_generate as the single bounded visual-production planner', async () => {
    const server = createImageGenerationMcpServer({ workspaceRoot: '/tmp/visual-generate-test' })
    const client = new Client({ name: 'image-generation-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const tools = await client.listTools()
      const toolNames = tools.tools.map((tool) => tool.name)
      expect(toolNames).toContain('visual_generate')
      expect(toolNames).toContain('image_generation_review_candidate')
      expect(toolNames).not.toContain('visual_artifact_review')
      expect(tools.tools.find((tool) => tool.name === 'visual_generate')?.description).toContain(
        'traceable, reproducible, or provenance-recorded scientific figure'
      )
      expect(tools.tools.find((tool) => tool.name === 'image_generation_render')?.description).toContain(
        'exact effective prompt, public model identity/version'
      )

      const renderTool = tools.tools.find((tool) => tool.name === 'image_generation_render')!
      expect(renderTool.description).toContain('recipe.visualPlan')
      expect(renderTool.description).toContain('nextCall.arguments')
      expect(record(record(renderTool.inputSchema.properties).recipe).required).toContain('visualPlan')

      const planned = await client.callTool({ name: 'visual_generate', arguments: {
        task: 'Create a poetic illustration of moonlight on a lake.',
        requirements: { lockedElements: [], modelOwnedElements: ['poetic illustration'], reproducibleInputs: [] }
      } })
      const handoff = record(record(planned.structuredContent).plan).handoff
      expect(handoff).toMatchObject({ route: 'model', contextStatus: 'ready' })
      const prepared = await client.callTool({ name: 'image_generation_prepare', arguments: {
        task: 'Create a poetic illustration of moonlight on a lake.', visualPlan: handoff
      } })
      const nextCall = record(record(prepared.structuredContent).nextCall)
      expect(nextCall).toMatchObject({ tool: 'image_generation_render', arguments: { recipe: { visualPlan: handoff } } })
      expect(record(nextCall.arguments).recipe).toMatchObject({ mode: expect.any(String), prompt: expect.any(String), size: expect.any(Object) })

      const baseArguments = {
        task: 'Create a standards-aligned visual.',
        requirements: {
          lockedElements: [],
          modelOwnedElements: ['composition'],
          reproducibleInputs: []
        },
        context: {
          questions: [{
            id: 'standard',
            question: 'Which current standard applies?',
            priority: 'required',
            status: 'open'
          }]
        }
      }
      const needsContext = await client.callTool({ name: 'visual_generate', arguments: baseArguments })
      expect(record(record(needsContext.structuredContent).plan)).toMatchObject({
        ok: true,
        status: 'needs_context',
        routeLocked: false,
        nextAction: { tool: 'research_search' }
      })

      const exhausted = await client.callTool({
        name: 'visual_generate',
        arguments: {
          ...baseArguments,
          budget: { maxRounds: 1 },
          context: {
            ...baseArguments.context,
            usage: { rounds: 1 }
          }
        }
      })
      expect(record(record(exhausted.structuredContent).plan)).toMatchObject({
        ok: true,
        status: 'budget_exhausted',
        handoff: {
          route: 'model',
          contextStatus: 'budget_exhausted',
          releaseCeiling: 'draft_ready'
        },
        execution: {
          stages: expect.arrayContaining([expect.objectContaining({ tool: 'image_generation_review_candidate' })])
        }
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
