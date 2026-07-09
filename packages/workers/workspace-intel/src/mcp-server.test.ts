import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    schemaVersion: 1,
    updatedAt: '2026-07-04T00:00:00.000Z',
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

  const service = createWorkspaceIntelService({ workspaceRoot, visibleContextPath })
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
    'gui_workspace_list',
    'gui_workspace_preview',
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
  assert.equal(asRecord((structuredVisibleContext.components as unknown[])[0]).component, 'workspace-preview')

  const read = await client.callTool({
    name: 'gui_workspace_read',
    arguments: { path: 'notes.txt' }
  })
  const structuredRead = asRecord(read.structuredContent)
  assert.equal(structuredRead.ok, true)
  assert.equal(structuredRead.relativePath, 'notes.txt')
  assert.match(String(structuredRead.content), /hello from MCP/)

  const preview = await client.callTool({
    name: 'gui_workspace_preview',
    arguments: { path: 'notes.txt', maxChars: 20 }
  })
  const structuredPreview = asRecord(preview.structuredContent)
  assert.equal(structuredPreview.ok, true)
  assert.equal(structuredPreview.kind, 'text')

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
