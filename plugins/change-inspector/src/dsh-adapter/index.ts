/** Official DSH entry: no recorded sessions, static providers or Host-specific business injection. */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ChangeInspectorService } from '../core/service.js'
import type { ChangeInspectorSessionDetail } from '../ports/agent-threads.js'
import { registerChangeInspectorTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools', 'agentThreads']
type AgentThreadsClient = Readonly<{ invoke: (operation: string, input: unknown) => Promise<unknown> }>

export function apply(ctx: Context & { tools: ToolRuntime; agentThreads: AgentThreadsClient }): void {
  if (!ctx.agentThreads || typeof ctx.agentThreads.invoke !== 'function') {
    throw new Error('Change Inspector requires the authorized agentThreads Host service.')
  }
  const service = new ChangeInspectorService({
    agentThreads: {
      read: async ({ runtimeId, threadId }) => await ctx.agentThreads.invoke('read', {
        ...(runtimeId ? { runtimeId } : {}),
        ...(threadId ? { sessionId: threadId } : {})
      }) as ChangeInspectorSessionDetail
    }
  })
  const disposers: Array<() => void> = []
  const disposeAll = (): void => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch { /* Complete cleanup of remaining registrations. */ }
    }
  }
  try {
    registerChangeInspectorTools(
      tool => {
        const dispose = ctx.tools.register(tool as never)
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      (definition: DshToolDefinition) => defineTool(definition as never),
      () => service
    )
    ctx.effect(() => disposeAll)
  } catch (error) {
    disposeAll()
    throw error
  }
}
