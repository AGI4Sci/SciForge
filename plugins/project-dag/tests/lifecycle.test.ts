import { expect, test } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import * as plugin from '../src/dsh-adapter.js'
import { ProjectDagPythonProcess } from '../src/python-process.js'

async function setup(port: unknown) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  class Host extends Service {
    constructor(c: Context) { super(c, 'sciforgeProjectDag') }
    open() { return port }
  }
  await ctx.plugin(Host)
  return { ctx, fork: await ctx.plugin(plugin) }
}
async function options() {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'lifecycle-'))
  const evidence = join(root, 'evidence'); await mkdir(evidence)
  return { python: process.env.PROJECT_DAG_PYTHON!, db: join(root, 'project.db'), evidence,
    workspace: root, environment: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, closeTimeoutMs: 150 }
}

test('official detach failure still closes the real owned wheel PID', async () => {
  const opts = await options(), python = new ProjectDagPythonProcess(opts)
  await python.request('/updates/status?workspaceRoot=' + encodeURIComponent(opts.workspace), 'GET')
  let closed = 0
  const { ctx, fork } = await setup({ subscribeInvalidation: () => () => { throw new Error('synthetic detach failure') },
    close: () => { closed++; return python.close() } })
  try {
    await fork.dispose()
    expect(closed).toBe(1)
    expect(() => process.kill(python.pid!, 0)).toThrow()
    expect(JSON.stringify(ctx.logger.buffer)).toContain('synthetic detach failure')
  } finally { await python.close(); await ctx.fiber.dispose() }
})

test('official dispose starts the owned timeout before waiting for a hung request', async () => {
  const opts = await options(), wrapper = join(opts.workspace, 'synthetic-python')
  await writeFile(wrapper, `#!${opts.python}\nimport sys,json,time\nfor line in sys.stdin:\n r=json.loads(line)\n if r['route']=='/hang': time.sleep(60)\n print(json.dumps({'id':r['id'],'ok':True,'data':{}}),flush=True)\n`)
  await chmod(wrapper, 0o700)
  const python = new ProjectDagPythonProcess({ ...opts, python: wrapper })
  await python.request('/ready', 'GET')
  let enter!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const { ctx, fork } = await setup({ authorize: async () => {}, subscribeInvalidation: () => () => {},
    request: () => { const pending = python.request('/hang', 'GET'); enter(); return pending }, close: () => python.close() })
  const pending = ctx.tools.execute({ callId: ToolCallId('hung'), name: 'project_dag_status',
    arguments: { workspaceRoot: opts.workspace }, signal: new AbortController().signal })
  await entered
  const disposal = fork.dispose()
  try {
    expect(await Promise.race([disposal.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 700))])).toBe(true)
    expect((await pending).isError).toBe(true)
    expect(() => process.kill(python.pid!, 0)).toThrow()
    expect(JSON.stringify(ctx.logger.buffer)).toContain('timed out')
  } finally { await python.close().catch(() => {}); await pending; await disposal; await ctx.fiber.dispose() }
})

test('authorization preparation cannot delay process close or dispatch after disposal', async () => {
  let release!: () => void, enter!: () => void, requests = 0, closed = 0
  const barrier = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { enter = resolve })
  const { ctx, fork } = await setup({ subscribeInvalidation: () => () => {},
    authorize: async () => { enter(); await barrier }, request: async () => { requests++; return {} },
    close: async () => { closed++ } })
  const pending = ctx.tools.execute({ callId: ToolCallId('preparing'), name: 'project_dag_status',
    arguments: { workspaceRoot: '/synthetic' }, signal: new AbortController().signal })
  await entered
  try {
    await fork.dispose()
    expect(closed).toBe(1)
    release()
    expect((await pending).isError).toBe(true)
    expect(requests).toBe(0)
  } finally { release(); await pending; await ctx.fiber.dispose() }
})

test('process environment selects only HOME and TMPDIR at runtime', async () => {
  const opts = await options(), wrapper = join(opts.workspace, 'synthetic-python')
  await writeFile(wrapper, `#!${opts.python}\nimport sys,json,os\nfor line in sys.stdin:\n r=json.loads(line)\n print(json.dumps({'id':r['id'],'ok':True,'data':{k:os.environ.get(k) for k in ['HOME','TMPDIR','REVIEW_SYNTHETIC_SECRET','NODE_OPTIONS']}}),flush=True)\n`)
  await chmod(wrapper, 0o700)
  const environment = { ...opts.environment, REVIEW_SYNTHETIC_SECRET: 'synthetic-not-a-credential', NODE_OPTIONS: '--synthetic' }
  const python = new ProjectDagPythonProcess({ ...opts, python: wrapper, environment })
  try {
    expect(await python.request('/env', 'GET')).toEqual({ HOME: opts.environment.HOME, TMPDIR: opts.environment.TMPDIR,
      REVIEW_SYNTHETIC_SECRET: null, NODE_OPTIONS: null })
  } finally { await python.close() }
})
