import { expect, test } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/dsh-adapter.js'

// Official registry/context contract test; real Python integration lives separately.
test('post-admission cancellation and dispose wait for owned request quiescence', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  let release!: () => void
  let enter!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { enter = resolve })
  let closed = false
  class ProjectHost extends Service {
    constructor(context: Context) { super(context, 'sciforgeProjectDag') }
    async open() { return {
      serviceUrl: 'http://127.0.0.1:3898', authorize: async () => {},
      subscribeInvalidation: () => () => {},
      request: async () => { enter(); await barrier; return { projectKey: 'path:/synthetic', state: 'empty' } },
      close: async () => { await barrier; closed = true }
    } }
  }
  await ctx.plugin(ProjectHost)
  const fork = await ctx.plugin(plugin)
  const controller = new AbortController()
  const pending = ctx.tools.execute({ callId: ToolCallId('barrier'), name: 'project_dag_status',
    arguments: { workspaceRoot: '/synthetic' }, signal: controller.signal })
  await entered
  controller.abort()
  const disposing = fork.dispose()
  await Promise.resolve()
  expect(closed).toBe(false)
  release()
  expect((await pending).isError).toBe(true)
  await disposing
  expect(closed).toBe(true)
  await ctx.fiber.dispose()
})

test('startup subscription failure closes the acquired port', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  let closed = 0
  class ProjectHost extends Service {
    constructor(context: Context) { super(context, 'sciforgeProjectDag') }
    async open() { return {
      subscribeInvalidation: () => { throw new Error('subscription failed') },
      close: async () => { closed++ }
    } }
  }
  await ctx.plugin(ProjectHost)
  await expect(ctx.plugin(plugin)).rejects.toThrow('subscription failed')
  expect(closed).toBe(1)
  await ctx.fiber.dispose()
})

test('DSH apply registers tools and unregisters them through Cordis disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  let closed = 0
  let subscribed = 0
  let detached = 0
  class ProjectHost extends Service {
    constructor(context: Context) { super(context, 'sciforgeProjectDag') }
    async open() { return {
      serviceUrl: 'http://127.0.0.1:3898',
      readSession: async () => { throw new Error('unused') },
      readCommittedSnapshot: async () => { throw new Error('unused') },
      authorize: async () => {},
      request: async () => ({ projectKey: 'path:/synthetic', state: 'empty' }),
      close: async () => { closed++ },
      subscribeInvalidation: () => { subscribed++; return () => { detached++ } }
    } }
  }
  await ctx.plugin(ProjectHost)
  const fork = await ctx.plugin(plugin)
  expect(ctx.tools.schemas().map(x => x.name)).toContain('project_dag_update')
  await fork.dispose()
  expect(ctx.tools.schemas().map(x => x.name)).not.toContain('project_dag_update')
  expect(subscribed).toBe(1)
  expect(detached).toBe(1)
  expect(closed).toBe(1)
  await ctx.fiber.dispose()
})
