import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { CapabilityRegistry } from '../capabilities/registry'
import { CapabilityBroker } from '../capabilities/broker'

/**
 * Execute the actual main-process composition statements in their source order.
 * Only Electron/unrelated application construction is omitted: the service,
 * persisted state, capability registry, Broker and Cordis child remain real.
 * This is a startup-boundary regression, not an Electron application launch.
 */
async function runProductionStartup(
  developmentPlugins: DevelopmentExternalPluginService | undefined,
  applicationCapabilityRegistry: CapabilityRegistry,
  agentRuntimeHostRef: { current: object | null },
  agentRuntimeHost: object
): Promise<void> {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  const statements: ts.ExpressionStatement[] = []
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node)) {
      const expression = node.expression
      const call = ts.isAwaitExpression(expression) ? expression.expression : undefined
      const method = call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        ? call.expression : undefined
      const pluginCall = method && ts.isIdentifier(method.expression) && method.expression.text === 'developmentPlugins'
        && ['initialize', 'attachCapabilityRegistry'].includes(method.name.text)
      const assignment = ts.isBinaryExpression(expression)
        && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(expression.left)
        && ts.isIdentifier(expression.left.expression) && expression.left.expression.text === 'agentRuntimeHostRef'
        && expression.left.name.text === 'current'
      if (pluginCall || assignment) statements.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(statements).toHaveLength(3)
  const printer = ts.createPrinter()
  const body = statements.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, file)).join('\n')
  const execute = new Function('developmentPlugins', 'applicationCapabilityRegistry', 'agentRuntimeHostRef', 'agentRuntimeHost',
    `return (async () => { ${body} })()`)
  await execute(developmentPlugins, applicationCapabilityRegistry, agentRuntimeHostRef, agentRuntimeHost)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'development-plugin-startup-'))
  const name = 'neutral-startup-consumer'
  const plugin = join(root, 'plugins', name)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'main.mjs'), `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  for (const name of ['status', 'read']) ctx.tools.register(defineTool({ name, description: name, parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: () => ctx.inspect.read() }))
}`)
  const clientPath = join(root, 'client.mjs')
  await writeFile(clientPath, `export function create(client) { return { read: () => client.request('inspect', 'read', {}).result } }`)
  const host = { marker: 'ready-host' }
  const hostRef: { current: object | null } = { current: host }
  const resolutions: object[] = []
  let failure: Error | undefined
  const create = () => new DevelopmentExternalPluginService({
    root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[name, { hostApiRange: '^1', permissions: [], approved: true, dshAuthorization: { packageName: name, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', tools: { status: { id: 'neutral.status', effect: 'read' }, read: { id: 'neutral.read', effect: 'read' } } } }]]),
    hostServiceIds: ['inspect'],
    resolveHostServiceClients: () => [{ serviceId: 'inspect', modulePath: clientPath, exportName: 'create', config: {} }],
    resolveHostServiceProviders: () => {
      if (!hostRef.current) throw new Error('Agent runtime Host is not ready for composition.')
      resolutions.push(hostRef.current)
      if (failure) throw failure
      return { inspect: { authorize: async request => { request.assertCurrent?.() }, operations: { read: () => ({ marker: host.marker }) } } }
    }
  })
  const first = create()
  try {
    await first.initialize()
    await first.attachCapabilityRegistry(new CapabilityRegistry())
    expect(await first.setEnabled(name, true)).toMatchObject({ activationState: 'active' })
  } finally { await first.dispose() }
  expect(JSON.parse(await readFile(join(root, 'profile/extensions/development-external-state.json'), 'utf8')).enabled).toContain(name)
  resolutions.length = 0
  hostRef.current = null
  return { root, name, host, hostRef, resolutions, service: create(), failWith: (error: Error) => { failure = error } }
}

it('restores persisted enabled plugins only after the production Host is published, and invokes the restored real child', async () => {
  const f = await fixture()
  const registry = new CapabilityRegistry()
  const registrations = vi.spyOn(registry, 'register')
  try {
    await runProductionStartup(f.service, registry, f.hostRef, f.host)
    expect(await f.service.list()).toEqual([expect.objectContaining({ enabled: true, activationState: 'active', status: 'active' })])
    expect(f.resolutions).toEqual([f.host])
    expect(registrations.mock.calls.filter(([definition]) => definition.descriptor.id === 'neutral.read')).toHaveLength(1)
    const broker = new CapabilityBroker(registry)
    const caller = { audience: 'agent' as const, callerId: 'startup-test', workspaceId: f.root }
    const opened = await broker.invokeOrdinarySession(caller, { actionId: `${f.name}.dsh-session.open`, input: {} }, { runtimeId: 'runtime', threadId: 'thread' })
    const resource = opened.output as { token: string; semanticRevision: string; expiresAt: string }
    const result = await broker.invokeOrdinarySession(caller, { actionId: 'neutral.read', invocationId: 'cold-read', input: {}, resource }, { runtimeId: 'runtime', threadId: 'thread' })
    expect(result.output).toEqual({ marker: 'ready-host' })
    expect(f.resolutions).toHaveLength(1)
  } finally {
    await f.service.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

it('does not hide a real provider composition failure after Host readiness', async () => {
  const f = await fixture()
  const registry = new CapabilityRegistry()
  const error = new Error('provider composition rejected')
  f.failWith(error)
  try {
    await expect(runProductionStartup(f.service, registry, f.hostRef, f.host)).rejects.toBe(error)
    expect(f.hostRef.current).toBe(f.host)
    expect((await f.service.list())[0]).toMatchObject({ enabled: true, activationState: 'failed', status: 'invalid' })
    expect(registry.get('neutral.read')).toBeUndefined()
  } finally {
    await f.service.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

it('keeps startup valid when development plugins are not configured', async () => {
  const host = {}
  const ref = { current: null as object | null }
  await runProductionStartup(undefined, new CapabilityRegistry(), ref, host)
  expect(ref.current).toBe(host)
})
