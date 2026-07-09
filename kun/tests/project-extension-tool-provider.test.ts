import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildProjectExtensionToolProviders } from '../src/adapters/tool/project-extension-tool-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

let tempRoot: string | null = null

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('project extension tool provider', () => {
  it('loads headless project extension tools from a manifest without MCP transport', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'project-extension-provider-'))
    const extensionRoot = join(tempRoot, 'extensions', 'demo-extension')
    mkdirSync(join(extensionRoot, 'dist'), { recursive: true })
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({
      id: 'demo-extension',
      name: 'Demo Extension',
      kind: 'project-extension',
      activation: ['agent-runtime'],
      storage: '.sciforge/demo/demo.sqlite',
      headless: true,
      runtimeModule: 'dist/index.js',
      contributes: {
        agentTools: ['demo_extension_echo'],
        skills: []
      }
    }), 'utf8')
    writeFileSync(join(extensionRoot, 'dist', 'index.js'), [
      'export function createProjectExtensionTools(input) {',
      '  return [input.defineTool({',
      '    name: "demo_extension_echo",',
      '    description: "Echo from a project extension.",',
      '    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },',
      '    policy: "auto",',
      '    execute: async (args, context) => ({ output: { text: args.text, workspace: context.workspace } })',
      '  })]',
      '}'
    ].join('\n'), 'utf8')

    const result = await buildProjectExtensionToolProviders({
      enabled: true,
      manifests: [join(extensionRoot, 'extension.json')]
    })
    expect(result.loadedExtensions).toBe(1)
    expect(result.toolCount).toBe(1)
    expect(result.diagnostics[0]).toMatchObject({
      id: 'demo-extension',
      available: true,
      toolCount: 1
    })

    const host = new LocalToolHost({
      registry: new CapabilityRegistry(result.providers)
    })
    const execution = await host.execute({
      callId: 'call-1',
      toolName: 'demo_extension_echo',
      arguments: { text: 'hello' }
    }, fakeContext(tempRoot))
    expect((execution.item as { output?: unknown }).output).toEqual({
      text: 'hello',
      workspace: tempRoot
    })
    expect(result.providers[0].kind).toBe('extension')
  })

  it('reports unavailable diagnostics when the runtime module is missing', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'project-extension-provider-missing-'))
    const extensionRoot = join(tempRoot, 'extensions', 'broken-extension')
    mkdirSync(extensionRoot, { recursive: true })
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({
      id: 'broken-extension',
      name: 'Broken Extension',
      kind: 'project-extension',
      activation: ['agent-runtime'],
      storage: '.sciforge/broken.sqlite',
      headless: true,
      runtimeModule: 'dist/index.js',
      contributes: { agentTools: ['broken_tool'] }
    }), 'utf8')

    const result = await buildProjectExtensionToolProviders({
      enabled: true,
      manifests: [join(extensionRoot, 'extension.json')]
    })
    expect(result.providers).toEqual([])
    expect(result.loadedExtensions).toBe(0)
    expect(result.diagnostics[0]).toMatchObject({
      id: 'broken-extension',
      available: false,
      toolCount: 0
    })
    expect(result.diagnostics[0]?.reason).toContain('runtime module not found')
  })

  it('rejects runtime modules outside the extension root', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'project-extension-provider-outside-'))
    const extensionRoot = join(tempRoot, 'extensions', 'outside-extension')
    mkdirSync(extensionRoot, { recursive: true })
    writeFileSync(join(tempRoot, 'outside.js'), 'export function createProjectExtensionTools() { return [] }\n', 'utf8')
    writeFileSync(join(extensionRoot, 'extension.json'), JSON.stringify({
      id: 'outside-extension',
      name: 'Outside Extension',
      kind: 'project-extension',
      activation: ['agent-runtime'],
      storage: '.sciforge/outside.sqlite',
      headless: true,
      runtimeModule: '../../outside.js',
      contributes: { agentTools: [] }
    }), 'utf8')

    const result = await buildProjectExtensionToolProviders({
      enabled: true,
      manifests: [join(extensionRoot, 'extension.json')]
    })

    expect(result.providers).toEqual([])
    expect(result.loadedExtensions).toBe(0)
    expect(result.diagnostics[0]).toMatchObject({
      id: 'outside-extension',
      available: false,
      toolCount: 0
    })
    expect(result.diagnostics[0]?.reason).toContain('within the extension root')
  })
})

function fakeContext(workspace: string): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}
