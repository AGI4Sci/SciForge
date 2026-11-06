/** Official DSH entry: no recorded sessions, static providers or Host-specific business injection. */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ChangeInspectorService } from '../core/service.js'
import type { ChangeInspectorSessionDetail } from '../ports/agent-threads.js'
import { registerChangeInspectorTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools', 'agentThreads']
type AgentThreadsClient = Readonly<{ invoke: (operation: string, input: unknown) => Promise<unknown> }>

export function apply(ctx: Context & { tools: ToolRuntime; agentThreads: AgentThreadsClient }): void {
  const service = new ChangeInspectorService({
    agentThreads: {
      read: async ({ runtimeId, threadId }) => await ctx.agentThreads.invoke('read', {
        ...(runtimeId ? { runtimeId } : {}),
        ...(threadId ? { sessionId: threadId } : {})
      }) as ChangeInspectorSessionDetail
    }
  })
  registerChangeInspectorTools(
    tool => ctx.tools.register(tool as never),
    (definition: DshToolDefinition) => defineTool(definition as never),
    () => service
  )
}
