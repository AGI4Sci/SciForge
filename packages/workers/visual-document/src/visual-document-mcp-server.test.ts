import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS } from './contract.js'
import {
  createVisualDocumentMcpServer,
  visualDocumentCreateCandidateInputSchema
} from './visual-document-mcp-server.js'
import { insertVisualDocumentArtifact } from './visual-document-engine.js'

function invalidArrayValuedItems(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => invalidArrayValuedItems(item, `${path}[${index}]`))
  }
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === 'items' && Array.isArray(item) ? [`${path}.items`] : []),
    ...invalidArrayValuedItems(item, `${path}.${key}`)
  ])
}

describe('VisualDocument MCP schemas', () => {
  it('emits Codex-compatible JSON Schema for candidate review evidence', () => {
    const jsonSchema = z.toJSONSchema(z.object(visualDocumentCreateCandidateInputSchema))
    expect(invalidArrayValuedItems(jsonSchema)).toEqual([])
    const semantic = jsonSchema.properties?.reviewEvidence
      && 'properties' in jsonSchema.properties.reviewEvidence
      ? jsonSchema.properties.reviewEvidence.properties?.semantic
      : undefined
    expect(semantic).toMatchObject({
      properties: {
        violations: { type: 'array', maxItems: 0, items: { type: 'string' } },
        repairInstructions: { type: 'array', maxItems: 0, items: { type: 'string' } }
      }
    })
  })

  it('lists every dynamic tool with app-server-compatible object schemas', async () => {
    const server = createVisualDocumentMcpServer({ workspaceRoot: '/tmp/sciforge-visual-document-test' })
    const client = new Client({ name: 'visual-document-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ])

      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        Object.keys(SCIFORGE_VISUAL_DOCUMENT_TOOL_SIDE_EFFECTS).sort()
      )
      for (const tool of listed.tools) {
        expect(tool.inputSchema, `${tool.name} must expose an object input schema`).toMatchObject({
          type: 'object',
          properties: expect.any(Object)
        })
        expect(
          invalidArrayValuedItems(tool.inputSchema),
          `${tool.name} must not expose tuple-style array-valued items`
        ).toEqual([])
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('returns file-derived raster dimensions through the candidate MCP tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'visual-document-mcp-'))
    const sourcePath = join(root, 'source.svg')
    const candidatePath = join(root, 'candidate.png')
    await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"/>')
    await insertVisualDocumentArtifact({
      workspaceRoot: root,
      documentId: 'review',
      kind: 'generated_image',
      sourcePath,
      width: 1600,
      height: 900
    })
    const canvas = createCanvas(1920, 1440)
    canvas.getContext('2d').fillRect(0, 0, 1920, 1440)
    const candidateBytes = canvas.toBuffer('image/png')
    await writeFile(candidatePath, candidateBytes)

    const server = createVisualDocumentMcpServer({ workspaceRoot: root })
    const client = new Client({ name: 'visual-document-dimensions-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({
        name: 'sciforge_visual_document_create_candidate',
        arguments: {
          documentId: 'review',
          candidatePath,
          summary: 'Preserve the candidate aspect ratio',
          width: 1200,
          height: 800,
          reviewEvidence: {
            tool: 'visual_artifact_review',
            ok: true,
            reviewedArtifactPath: candidatePath,
            reviewedArtifactHash: createHash('sha256').update(candidateBytes).digest('hex'),
            reviewedAt: '2026-07-12T00:00:00.000Z',
            score: {
              overall: 1,
              dimensions: 1,
              nonEmpty: 1,
              background: 1,
              semantic: 1,
              warnings: []
            },
            semantic: {
              pass: true,
              summary: 'The candidate is ready for human review.',
              violations: [],
              repairInstructions: []
            },
            repairable: false,
            warnings: []
          }
        }
      })

      expect(result.isError).not.toBe(true)
      const structured = result.structuredContent as {
        result?: { revision?: { width?: number; height?: number } }
      }
      expect(structured.result?.revision).toMatchObject({ width: 1920, height: 1440 })
    } finally {
      await client.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
