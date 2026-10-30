import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const worktrees = resolve(root, '..')
const fixtureRoot = process.env.MIGRATION_FIXTURE_ROOT
  ? resolve(process.env.MIGRATION_FIXTURE_ROOT)
  : join(root, 'test-fixtures', 'migration-plugins')

const samples = {
  p1: {
    directory: 'p1-unitverse',
    id: 'sciforge.unitverse',
    source: join(worktrees, 'migrate-p1-unitverse/packages/domains/unitverse/src/conversion.ts'),
    code: (source) => `import { z } from 'zod'\nimport { convertDetailed } from ${JSON.stringify(source)}\n\nlet active = false\nconst inputSchema = z.object({ value: z.number(), from: z.string(), to: z.string() }).strict()\nconst outputSchema = z.object({ value: z.number(), from: z.string(), to: z.string(), result: z.number(), category: z.string(), categoryZh: z.string(), categoryEn: z.string(), fromInput: z.string(), toInput: z.string(), summary: z.string() }).strict()\nexport async function activate() { active = true }\nexport async function deactivate() { active = false }\nexport async function dispose() { active = false }\nexport function getCapabilityDefinitions() { return [{ descriptor: { contractVersion: 3, id: 'unitverse.convert', version: '0.1.0', title: 'Convert units', description: 'Convert a numeric value between supported units.', audiences: ['agent', 'ui', 'system'], scope: 'global', resourceKinds: [], effect: 'compute', approval: 'none', concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.toJSONSchema(inputSchema, { target: 'draft-07', unrepresentable: 'throw' }), outputSchema: z.toJSONSchema(outputSchema, { target: 'draft-07', unrepresentable: 'throw' }), tags: ['unitverse', 'conversion'] }, inputSchema, outputSchema, handler: async (input) => { if (!active) throw new Error('unitverse adapter is not active'); return { output: convertDetailed(input.value, input.from, input.to) } } }] }\nexport function smoke() { if (!active) throw new Error('unitverse adapter is not active'); return convertDetailed(5, 'ft', 'cm') }\n`,
    output: 'dist/main.js'
  },
  p2: {
    directory: 'p2-better-sidebar',
    id: 'sciforge.better-sidebar',
    source: join(worktrees, 'migrate-p2-better-sidebar/packages/domains/better-sidebar/src/contract.ts'),
    code: (source) => `import { createBetterSidebarRegistry } from ${JSON.stringify(source)}\n\nlet active = false\nlet disposeTabs = []\nexport async function activate() { active = true; const registry = createBetterSidebarRegistry(); disposeTabs = [registry.register({ id: 'fixture.extra', title: 'Fixture', order: 50, summary: 'Fixture tab' })]; globalThis.__betterSidebarRegistry = registry }\nexport async function deactivate() { for (const dispose of disposeTabs) dispose(); disposeTabs = []; active = false }\nexport async function dispose() { await deactivate(); delete globalThis.__betterSidebarRegistry }\nexport function smoke() { if (!active) throw new Error('better-sidebar adapter is not active'); const registry = globalThis.__betterSidebarRegistry; const tabs = registry.list(); return { tabIds: tabs.map((tab) => tab.id), count: tabs.length } }\n`,
    output: 'dist/main.js',
    renderer: '<!doctype html><html><body><div id="sciforge-plugin"></div><script type="module">document.querySelector("#sciforge-plugin").textContent="Better Sidebar renderer contribution"</script></body></html>',
    rendererModule: `const TABS = Object.freeze([
  { id: 'explorer', title: 'Explorer', order: 10 },
  { id: 'changes', title: 'Changes', order: 20 },
  { id: 'tasks', title: 'Tasks', order: 30 },
  { id: 'sidechat', title: 'Side chat', order: 40 }
])

export function activateRenderer(registrar, generation) {
  const disposers = []
  disposers.push(registrar.registerPanel({
    id: 'better-sidebar.workbench-right-panel',
    render: ({ sessionId, activeTabId }) => ({
      sessionId,
      tabs: TABS.map(({ id }) => id),
      activeTabId: activeTabId ?? TABS[0].id
    })
  }, generation))
  for (const tab of TABS) disposers.push(registrar.registerTab(tab, generation))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
`
  },
  p3: {
    directory: 'p3-mcp-bridge',
    id: 'sciforge.mcp-bridge-compat',
    source: join(worktrees, 'migrate-p3-mcp-bridge/packages/domains/mcp-bridge-compat/src/server.ts'),
    code: (source) => `import { boundedFixtureText, cancellableFixtureDelay } from ${JSON.stringify(source)}\n\nconst TOOLS = Object.freeze(['fixture_echo', 'fixture_delayed_echo', 'fixture_bounded_output'])\nlet active = false\nlet disposed = false\n\nfunction assertActive() {\n  if (!active || disposed) throw new Error('mcp adapter is not active')\n}\n\nfunction linkedSignal(signal, timeoutMs) {\n  const controller = new AbortController()\n  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)\n  const abort = () => controller.abort(new Error('aborted'))\n  signal?.addEventListener('abort', abort, { once: true })\n  return { controller, timer, signal, abort }\n}\n\nasync function invoke(tool, args = {}, options = {}) {\n  assertActive()\n  if (!TOOLS.includes(tool)) throw new Error('unknown operationRef')\n  const bridge = linkedSignal(options.signal, options.timeoutMs ?? 300)\n  try {\n    if (tool === 'fixture_echo') return { text: String(args.message ?? '') }\n    if (tool === 'fixture_bounded_output') return boundedFixtureText(Number(args.requestedLength ?? 0))\n    await cancellableFixtureDelay(Number(args.delayMs ?? 0), bridge.controller.signal)\n    return { text: String(args.message ?? '') }\n  } catch (error) {\n    if (options.signal?.aborted) throw new Error('aborted')\n    if (bridge.controller.signal.aborted) throw new Error('timeout')\n    throw error\n  } finally {\n    clearTimeout(bridge.timer)\n    bridge.signal?.removeEventListener('abort', bridge.abort)\n  }\n}\n\nexport async function activate() { active = true; disposed = false }\nexport async function deactivate() { active = false }\nexport async function dispose() { active = false; disposed = true }\nexport function discover() { assertActive(); return [...TOOLS] }\nexport { invoke }\nexport async function smoke() {\n  assertActive()\n  const discovered = discover()\n  const echo = await invoke('fixture_echo', { message: 'hello-pr1' })\n  const delayed = await invoke('fixture_delayed_echo', { message: 'delayed-ok', delayMs: 5 })\n  const bounded = await invoke('fixture_bounded_output', { requestedLength: 5000 })\n  return { discovered, echo: echo.text, delayed: delayed.text, returnedLength: bounded.returnedLength, truncated: bounded.truncated }\n}\n`,
    output: 'dist/main.js'
  },
  p5: {
    directory: 'p5-ws-scope',
    id: 'sciforge.ws-scope-fixture',
    source: '',
    code: () => `let active = false
export async function activate() { active = true }
export async function deactivate() { active = false }
export async function dispose() { active = false }
export function getCapabilityDefinitions() {
  return [{
    descriptor: {
      contractVersion: 3, id: 'fixture.ws.echo', version: '0.1.0', title: 'Echo workspace',
      description: 'Echoes the workspaceRoot the plugin child actually received (workspace binding probe).',
      audiences: ['agent', 'ui', 'system'], scope: 'workspace', resourceKinds: [], effect: 'workspace-write',
      approval: 'none', concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: ['fixture', 'ws-scope']
    },
    handler: async (input) => {
      if (!active) throw new Error('ws-scope fixture is not active')
      return { output: { workspaceRoot: typeof input.workspaceRoot === 'string' ? input.workspaceRoot : null } }
    }
  }]
}
export function smoke() { if (!active) throw new Error('ws-scope fixture is not active'); return { ok: true } }
`,
    output: 'dist/main.js'
  },
  p4: {
    directory: 'p4-agent-teams',
    id: 'sciforge.agent-teams-fixture',
    source: join(worktrees, 'migrate-p4-agent-teams/packages/domains/agent-teams-fixture/src/runtime.ts'),
    contract: join(worktrees, 'migrate-p4-agent-teams/packages/domains/agent-teams-fixture/src/contract.ts'),
    code: (source, contract) => `import { AgentTeamsFixtureRuntime } from ${JSON.stringify(source)}\nimport { fixtureTeamSnapshotSchema } from ${JSON.stringify(contract)}\n\nlet runtime\nexport async function activate() { runtime = new AgentTeamsFixtureRuntime() }\nexport async function deactivate() { runtime?.close(); runtime = undefined }\nexport async function dispose() { await deactivate() }\nexport function smoke() { if (!runtime) throw new Error('agent-teams adapter is not active'); const initial = runtime.start('pr1-success'); const middle = runtime.advance('pr1-success', 0); const completed = runtime.advance('pr1-success', 1); fixtureTeamSnapshotSchema.parse(completed); return { initialRevision: initial.revision, middleRevision: middle.revision, finalRevision: completed.revision, status: completed.status, tasks: completed.tasks.map((task) => task.status) } }\n`,
    output: 'dist/main.js'
  }
}

async function buildOne(sample) {
  const dir = join(fixtureRoot, sample.directory)
  await mkdir(join(dir, 'dist'), { recursive: true })
  const packageJson = {
    name: `@sciforge/migration-${sample.directory}`,
    version: '0.1.0', private: true, type: 'module',
    engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
    exports: { '.': `./${sample.output}`, ...(sample.rendererModule ? { './client': './dist/renderer.mjs' } : {}) },
    dsh: sample.rendererModule
      ? { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'desktop', inject: ['./dist/renderer.mjs'] } }
      : { bundle: { patch: './cordis.patch.yml' } }
  }
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  await writeFile(join(dir, 'cordis.patch.yml'), `${JSON.stringify([{ insert: [{ id: sample.id, name: `./${sample.output}` }] }], null, 2)}\n`)
  let sourceCode = sample.code(sample.source, sample.contract)
  if (sample.directory === 'p2-better-sidebar') {
    sourceCode += "\nexport function getRendererContributions() { return [{ id: 'better-sidebar.workbench-right-panel', kind: 'panel', title: 'Better Sidebar' }, ...['explorer', 'changes', 'tasks', 'sidechat'].map((id) => ({ id: `better-sidebar.tab.${id}`, kind: 'tab', title: id }))] }\n"
  }
  if (sample.directory === 'p4-agent-teams') {
    sourceCode += "\nexport function start(input) { if (!runtime) throw new Error('agent-teams adapter is not active'); return runtime.start(input.teamId, input.failTaskId) }\nexport function status(input) { if (!runtime) throw new Error('agent-teams adapter is not active'); return runtime.status(input.teamId) }\nexport function advance(input) { if (!runtime) throw new Error('agent-teams adapter is not active'); return runtime.advance(input.teamId, input.expectedRevision) }\nexport function cancel(input) { if (!runtime) throw new Error('agent-teams adapter is not active'); return runtime.cancel(input.teamId, input.expectedRevision) }\n"
  }
  await build({ stdin: { contents: sourceCode, resolveDir: root, sourcefile: `${sample.directory}.mjs`, loader: 'js' }, outfile: join(dir, sample.output), bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: false, logLevel: 'silent' })
  if (sample.renderer) await writeFile(join(dir, 'dist/renderer.html'), sample.renderer)
  if (sample.rendererModule) await writeFile(join(dir, 'dist/renderer.mjs'), sample.rendererModule)
}

const requested = process.argv[2]
if (requested && !Object.hasOwn(samples, requested)) {
  throw new Error(`Unknown migration fixture sample: ${requested}`)
}
for (const [name, sample] of Object.entries(samples)) if (!requested || requested === name) await buildOne(sample)
console.log(`Built ${requested ? requested : Object.keys(samples).join(', ')}`)
