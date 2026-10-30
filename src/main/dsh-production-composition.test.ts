import { describe, it, expect, vi } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as dsh from './runtime/agent-runtime/dsh-agent-runtime-adapter'
import * as runtime from '@sciforge/dsh-runtime'
import type { AgentRuntimeAdapter } from './runtime/agent-runtime/adapter'
import type { AgentRuntimeToolSurface } from './runtime/agent-runtime/agent-tool-surface'

/** Execute the actual production adapters expression, not a duplicate helper composition.
 * Electron and the unrelated Codex/Claude constructors are the only substituted owners. */
function productionAdapters(userData: string, resourcesPath: string, toolSurface: AgentRuntimeToolSurface) {
  const source = ts.createSourceFile('index.ts', readFileSync(new URL('./index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let expression: ts.Expression | undefined
  let ledgerRegistry: ts.Expression | undefined
  const bindings = new Map<string, ts.Expression>()
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer)
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'RuntimeContextLedgerService') ledgerRegistry = node.arguments?.[1]
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'createAgentRuntimeHost') {
      const options = node.arguments[0]
      if (options && ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'adapters')
        if (property && ts.isPropertyAssignment(property)) expression = property.initializer
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(expression, 'main must compose neutral adapters').toBeDefined()
  expect(ledgerRegistry?.getText(source)).toBe(expression!.getText(source))
  const registry = ts.isIdentifier(expression!) ? bindings.get(expression!.text)! : expression!
  const factory = vi.fn(dsh.createProductionDshHostRuntimeAdapter)
  const noop = () => ({})
  const dshRuntimeAdapter = factory({ userDataDirectory: userData, resourcesDirectory: resourcesPath, toolSurface })
  const dependencies = {
    app: { getPath: (name: string) => { expect(name).toBe('userData'); return userData }, isPackaged: true },
    process: { resourcesPath }, agentRuntimeTools: toolSurface,
    createProductionDshHostRuntimeAdapter: factory, dshRuntimeAdapter,
    createPlacementAwareAgentRuntimeAdapter: () => ({ id: 'codex' }), createCodexAgentRuntimeAdapter: noop,
    getCodexRuntime: noop, createWorkspaceHostCodexAgentRuntimeAdapter: noop,
    createClaudeCodeAgentRuntimeAdapter: () => ({ id: 'claude' }), getClaudeCodeRuntime: noop,
    createPiAgentRuntimeAdapter: () => ({ id: 'pi' }), join
  }
  const body = ts.transpileModule(`return [...(${registry.getText(source)}).values()]`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const adapters = new Function(...Object.keys(dependencies), body)(...Object.values(dependencies)) as AgentRuntimeAdapter[]
  return { adapters, factory }
}

describe('production DSH composition', () => {
  it('registers the real package-backed factory with the canonical Broker surface and owned userData', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-composition-'))
    const surface: AgentRuntimeToolSurface = { tools: () => [], call: vi.fn(), abortTurn: vi.fn() }
    const coreFactory = vi.spyOn(runtime, 'createDshRuntimeAdapter')
    try {
      const { adapters, factory } = productionAdapters(join(root, 'user-data'), join(root, 'resources'), surface)
      expect(coreFactory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        stateDirectory: join(root, 'user-data', 'agent-runtime', 'dsh'),
        resolveDeploymentTarget: expect.any(Function),
        toolSurface: surface,
        requestTimeoutMs: 15_000, promptTimeoutMs: 600_000, cancelTimeoutMs: 15_000,
        getAuthorizedMcpServers: expect.any(Function)
      }))
      const composedOptions = coreFactory.mock.calls[0]![0] as unknown as Record<string, unknown>
      expect(composedOptions).not.toHaveProperty('executable')
      expect(composedOptions).not.toHaveProperty('verifyExecutable')
      expect(composedOptions).not.toHaveProperty('verifyDeployment')
      expect(factory).toHaveBeenCalledExactlyOnceWith({ userDataDirectory: join(root, 'user-data'), resourcesDirectory: join(root, 'resources'), toolSurface: surface })
      const adapter = adapters.find(a => a.id === 'dsh')!
      expect(adapter, 'selecting dsh must reach a registered runtime').toBeDefined()
      const settings = { agents: { dsh: { command: join(root, 'missing-dsh') } } }
      const result = await adapter.probe({ settings: settings as never })
      expect(result.available).toBe(false)
      expect(result.executablePath).toBeNull()
      expect(result.source).toBeNull()
      expect(result.failure).toEqual({ code: 'runtime_path_invalid', technicalDetail: 'runtime_path_invalid' })
      expect(await adapter.probe({ settings: settings as never })).toEqual(result)
      await expect(adapter.connect({ settings: {} as never })).rejects.toThrow('runtime_model_route_policy')
      await adapter.close?.()
    } finally { coreFactory.mockRestore(); await rm(root, { recursive: true, force: true }) }
  })
})
