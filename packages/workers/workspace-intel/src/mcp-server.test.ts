import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  VISIBLE_CONTEXT_RESOURCE_URI,
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  workspaceFileResourceUri
} from './contract.js'
import { createWorkspaceIntelMcpServer } from './mcp-server.js'
import { createWorkspaceIntelService } from './service.js'
import type { VisualInspectionRequest } from './visual-inspection.js'

const SNAPSHOT_TOKEN = `vc_${'e'.repeat(64)}`

test('serves structured workspace tool results and resource reads over MCP', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-mcp-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(join(workspaceRoot, '.codex', 'skills', 'demo-skill'), { recursive: true })
  await writeFile(join(workspaceRoot, 'notes.txt'), 'hello from MCP\n', 'utf8')
  const visibleContextPath = join(tempRoot, 'visible-context.json')
  await writeFile(visibleContextPath, JSON.stringify({
    schemaVersion: 3,
    windowId: 'window-1',
    revision: 3,
    snapshotToken: SNAPSHOT_TOKEN,
    publishedAt: new Date().toISOString(),
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
    activeThreadId: 'thread-1',
    workspaceRoot,
    route: 'chat',
    components: [{
      id: 'right-sidebar.file-preview',
      region: 'right-sidebar',
      component: 'workspace-preview',
      title: 'notes.txt',
      visible: true,
      updatedAt: '2026-07-04T00:00:00.000Z',
      summary: 'Previewing text file notes.txt.',
      resources: [{
        kind: 'workspaceFile',
        role: 'preview-target',
        workspaceRoot,
        relativePath: 'notes.txt'
      }],
      visualTargets: [{
        id: 'current-preview',
        kind: 'region',
        bounds: { x: 100, y: 80, width: 900, height: 700 },
        active: true
      }]
    }]
  }), 'utf8')
  await writeFile(join(workspaceRoot, '.codex', 'skills', 'demo-skill', 'SKILL.md'), [
    '---',
    'id: demo-skill',
    'name: demo-skill',
    'description: Demo MCP skill.',
    '---',
    '',
    '# Demo Skill',
    '',
    'Use this skill through MCP.'
  ].join('\n'), 'utf8')
  await writeFile(join(tempRoot, 'outside.txt'), 'outside\n', 'utf8')

  const service = createWorkspaceIntelService({
    workspaceRoot,
    visibleContextPath,
    visualInspector: async (request) => visualEvidence(request)
  })
  const server = createWorkspaceIntelMcpServer(service)
  const client = new Client({ name: 'workspace-intel-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  const toolNames = tools.tools.map((tool) => tool.name).sort()
  assert.deepEqual(toolNames, [
    'gui_visible_context',
    'gui_visual_capture',
    'gui_workspace_image_inspect',
    'gui_workspace_list',
    'gui_workspace_read',
    'gui_workspace_reference_list',
    'gui_workspace_reference_preview',
    'gui_workspace_skill_list',
    'gui_workspace_skill_read',
    'gui_workspace_tree'
  ])

  const treeTool = await client.callTool({
    name: 'gui_workspace_tree',
    arguments: { depth: 1 }
  })
  const structuredTreeTool = asRecord(treeTool.structuredContent)
  assert.equal(structuredTreeTool.ok, true)
  assert.equal(asRecord(structuredTreeTool.tree).kind, 'directory')

  const visibleContext = await client.callTool({
    name: 'gui_visible_context',
    arguments: { region: 'right-sidebar' }
  })
  const structuredVisibleContext = asRecord(visibleContext.structuredContent)
  assert.equal(structuredVisibleContext.ok, true)
  assert.equal(structuredVisibleContext.componentCount, 1)
  assert.equal(structuredVisibleContext.windowId, 'window-1')
  assert.equal(structuredVisibleContext.snapshotToken, SNAPSHOT_TOKEN)
  assert.equal(asRecord((structuredVisibleContext.components as unknown[])[0]).component, 'workspace-preview')

  const captureDirectory = join(tempRoot, 'captures')
  const requestDirectory = join(tempRoot, 'capture-requests')
  const capturePath = join(captureDirectory, 'latest.png')
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await mkdir(captureDirectory, { recursive: true })
  await writeFile(capturePath, pngBytes)
  const capturePromise = client.callTool({
    name: 'gui_visual_capture',
    arguments: { scope: 'window', snapshotToken: SNAPSHOT_TOKEN }
  })
  const requestName = await waitForFileName(requestDirectory, '.request.json')
  const captureRequest = JSON.parse(await readFile(join(requestDirectory, requestName), 'utf8')) as { requestId: string }
  await writeFile(join(requestDirectory, `${captureRequest.requestId}.response.json`), JSON.stringify({
    schemaVersion: 2,
    requestId: captureRequest.requestId,
    completedAt: new Date().toISOString(),
    ok: true,
    capture: {
      kind: 'visualSnapshot',
      role: 'window',
      path: capturePath,
      mimeType: 'image/png',
      capturedAt: new Date().toISOString(),
      width: 1280,
      height: 720,
      scaleFactor: 2,
      windowId: 'window-1',
      revision: 3
    }
  }), 'utf8')
  const capture = await capturePromise
  const structuredCapture = asRecord(capture.structuredContent)
  assert.equal(structuredCapture.ok, true)
  assert.equal(asRecord(structuredCapture.resource).kind, 'visualSnapshot')
  assert.match(String(asRecord(structuredCapture.evidence).attestation), /^sha256:[a-f0-9]{64}$/u)
  const textContent = capture.content.find((item) => item.type === 'text')
  assert.match(textContent?.type === 'text' ? textContent.text : '', /Visual understanding completed through Model Router/u)
  const imageContent = capture.content.find((item) => item.type === 'image')
  assert.equal(imageContent?.type, 'image')
  if (imageContent?.type === 'image') {
    assert.equal(imageContent.mimeType, 'image/png')
    assert.deepEqual(Buffer.from(imageContent.data, 'base64'), pngBytes)
  }

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
  const webpBytes = Buffer.from('RIFF0000WEBP', 'ascii')
  await Promise.all([
    writeFile(join(workspaceRoot, 'sample.jpg'), jpegBytes),
    writeFile(join(workspaceRoot, 'render.webp'), webpBytes)
  ])
  const visualTask = await client.callTool({
    name: 'gui_workspace_image_inspect',
    arguments: {
      task: 'Compare the sample with the render.',
      artifacts: [
        { id: 'sample', path: 'sample.jpg' },
        { id: 'render', path: 'render.webp' }
      ],
      outputIntent: { kind: 'comparison' }
    }
  })
  const structuredVisualTask = asRecord(visualTask.structuredContent)
  assert.equal(structuredVisualTask.ok, true)
  assert.equal((structuredVisualTask.artifacts as unknown[]).length, 2)
  assert.equal(asRecord(structuredVisualTask.evidence).task, 'Compare the sample with the render.')
  const visualImages = visualTask.content.filter((item) => item.type === 'image')
  assert.deepEqual(visualImages.map((item) => item.type === 'image' ? item.mimeType : ''), ['image/jpeg', 'image/webp'])

  const read = await client.callTool({
    name: 'gui_workspace_read',
    arguments: { path: 'notes.txt' }
  })
  const structuredRead = asRecord(read.structuredContent)
  assert.equal(structuredRead.ok, true)
  assert.equal(structuredRead.relativePath, 'notes.txt')
  assert.match(String(structuredRead.content), /hello from MCP/)

  const references = await client.callTool({
    name: 'gui_workspace_reference_list',
    arguments: { recursive: true, limit: 10 }
  })
  const structuredReferences = asRecord(references.structuredContent)
  assert.equal(structuredReferences.ok, true)
  assert.equal(
    (structuredReferences.references as Array<{ relativePath?: string }>).some((reference) => reference.relativePath === 'notes.txt'),
    true
  )

  const referencePreview = await client.callTool({
    name: 'gui_workspace_reference_preview',
    arguments: { path: 'notes.txt', maxChars: 20 }
  })
  const structuredReferencePreview = asRecord(referencePreview.structuredContent)
  assert.equal(structuredReferencePreview.ok, true)
  assert.equal(asRecord(structuredReferencePreview.reference).relativePath, 'notes.txt')

  const skillList = await client.callTool({
    name: 'gui_workspace_skill_list',
    arguments: {}
  })
  const structuredSkillList = asRecord(skillList.structuredContent)
  assert.equal(structuredSkillList.ok, true)
  assert.equal(asRecord((structuredSkillList.skills as unknown[])[0]).id, 'demo-skill')

  const skillRead = await client.callTool({
    name: 'gui_workspace_skill_read',
    arguments: { skillId: 'demo-skill' }
  })
  const structuredSkillRead = asRecord(skillRead.structuredContent)
  assert.equal(structuredSkillRead.ok, true)
  assert.match(String(structuredSkillRead.content), /Use this skill through MCP/)

  const failure = await client.callTool({
    name: 'gui_workspace_read',
    arguments: { path: '../outside.txt' }
  })
  assert.equal(failure.isError, true)
  const structuredFailure = asRecord(failure.structuredContent)
  assert.equal(structuredFailure.ok, false)
  assert.equal(asRecord(structuredFailure.error).code, 'path_outside_workspace')

  const resources = await client.listResources()
  assert.ok(resources.resources.some((resource) => resource.uri === WORKSPACE_TREE_RESOURCE_URI))
  assert.ok(resources.resources.some((resource) => resource.uri === VISIBLE_CONTEXT_RESOURCE_URI))
  const templates = await client.listResourceTemplates()
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === WORKSPACE_FILE_RESOURCE_URI_TEMPLATE))

  const treeResource = await client.readResource({ uri: WORKSPACE_TREE_RESOURCE_URI })
  const tree = JSON.parse(String(treeResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(tree.ok, true)

  const visibleResource = await client.readResource({ uri: VISIBLE_CONTEXT_RESOURCE_URI })
  const visible = JSON.parse(String(visibleResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(visible.ok, true)
  assert.equal(visible.componentCount, 1)

  const fileResource = await client.readResource({ uri: workspaceFileResourceUri('notes.txt') })
  const file = JSON.parse(String(fileResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(file.ok, true)
  assert.match(String(file.content), /hello from MCP/)
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function waitForFileName(directory: string, suffix: string): Promise<string> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const match = (await readdir(directory).catch(() => [])).find((entry) => entry.endsWith(suffix))
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${suffix} in ${directory}`)
}

function visualEvidence(request: VisualInspectionRequest) {
  return {
    status: 'inspected' as const,
    provider: 'model-router' as const,
    model: 'sciforge-model-router',
    inspectedAt: '2026-07-13T00:00:00.000Z',
    task: request.task,
    artifacts: request.artifacts.map(({ id, mimeType }, index) => ({
      id,
      mimeType,
      sha256: String(index + 1).repeat(64)
    })),
    requestSha256: 'a'.repeat(64),
    evidenceSha256: 'b'.repeat(64),
    attestation: `sha256:${'c'.repeat(64)}`,
    summary: 'The requested visual evidence is available.',
    claims: request.artifacts.map(({ id }) => ({
      kind: 'observation' as const,
      text: `Artifact ${id} is visible.`,
      artifactId: id,
      confidence: 0.9
    })),
    uncertainties: []
  }
}
