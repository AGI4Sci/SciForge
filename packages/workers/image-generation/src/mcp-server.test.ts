import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createImageGenerationMcpServer } from './mcp-server'

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

describe('image generation MCP', () => {
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
