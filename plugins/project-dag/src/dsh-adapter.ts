import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext, JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { ProjectDagCore, normalizeProjectDagStatus } from '../../../packages/domains/project-dag/src/core/index.js'
import type { ProjectDagPorts } from '../../../packages/domains/project-dag/src/ports/index.js'
import {
  PROJECT_DAG_CAPABILITY_IDS, projectDagUpdateInputSchema, projectDagUpdateOutputSchema,
  projectDagSaveGoalInputSchema, projectDagSaveGoalOutputSchema,
  projectDagViewInputSchema, projectDagStatusSchema
} from '../../../packages/domains/project-dag/src/contract.js'

/** SciForge service requirement, NOT an official DSH service or runner command. */
export interface ProjectDagHostPort extends ProjectDagPorts {
  authorize(actionId: string, target: unknown, call: Readonly<{
    callId: string; agentId?: string; signal: AbortSignal
  }>): Promise<void>
  subscribeInvalidation(listener: (event: Readonly<{
    workspaceRoot: string; project?: string; changedFields: readonly string[]
  }>) => Promise<void>): () => void | Promise<void>
  close(): Promise<void>
  /** Observer/close wait bound, default 10s. Timeout fences callbacks but does
   * not assert that the Host actually released its subscription/resources. */
  teardownTimeoutMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { sciforgeProjectDag: { open(): Promise<ProjectDagHostPort> } }
}

/** DSH's supported structural subset; full bounds/refinements remain enforced
 * by the canonical Zod contracts immediately before/after domain execution.
 */
function dshSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchemaNode {
  const source = JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io })))
  function project(node: Record<string, unknown>): JsonSchemaNode {
    const result: Record<string, unknown> = {}
    for (const key of ['type', 'enum', 'const', 'required', 'description', 'title']) {
      if (node[key] !== undefined) result[key] = node[key]
    }
    if (node.properties) result.properties = Object.fromEntries(Object.entries(
      node.properties as Record<string, Record<string, unknown>>).map(([key, value]) => [key, project(value)]))
    if (node.items) result.items = project(node.items as Record<string, unknown>)
    if (typeof node.additionalProperties === 'boolean') result.additionalProperties = node.additionalProperties
    const union = node.oneOf ?? node.anyOf
    if (Array.isArray(union)) result.oneOf = union.map(value => project(value))
    return result as JsonSchemaNode
  }
  return project(source)
}

export const name = 'sciforge-project-dag'
export const inject = ['tools', 'sciforgeProjectDag']

/** Fixed dsh-v0.2.0-rc.2 named apply(ctx); no private activate/runner hooks. */
export async function apply(ctx: Context): Promise<void> {
  const port = await ctx.sciforgeProjectDag.open()
  let closing = false
  const timeoutMs = Number.isSafeInteger(port.teardownTimeoutMs) && port.teardownTimeoutMs! > 0
    ? port.teardownTimeoutMs! : 10_000
  async function bounded(operation: () => void | Promise<void>, message: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Promise.race observes late rejection too. A timeout is a retained failure,
      // not successful release; it cannot cancel an arbitrary Host disposer.
      await Promise.race([Promise.resolve().then(operation), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })])
    } finally { clearTimeout(timer) }
  }
  const request: ProjectDagPorts['request'] = (route, method, body) => {
    if (closing) return Promise.reject(new Error('Project DAG is closing'))
    return port.request(route, method, body)
  }
  const core = new ProjectDagCore({
    serviceUrl: port.serviceUrl,
    readSession: identity => port.readSession(identity),
    readCommittedSnapshot: identity => port.readCommittedSnapshot(identity),
    request
  })
  let detach: ReturnType<ProjectDagHostPort['subscribeInvalidation']> = () => {}
  ctx.effect(() => async () => {
    closing = true
    const failures: unknown[] = []
    // The process owns bounded drain of already-dispatched work. Start it
    // before any observer/authorization wait; late commands hit the fence.
    await Promise.all([
      bounded(() => port.close(), 'Project DAG close timed out; owned resource release unconfirmed; durable work retained for recovery')
        .catch(error => { failures.push(error) }),
      bounded(() => detach(), 'Project DAG subscription detach timed out; listener fenced; subscription release unconfirmed')
        .catch(error => { failures.push(error) })
    ])
    if (failures.length) {
      ctx.logger.error('Project DAG cleanup failed: %s', failures.map(error =>
        error instanceof Error ? error.message : String(error)).join('; '))
      throw new AggregateError(failures, 'Project DAG cleanup failed')
    }
  })
  detach = port.subscribeInvalidation(event => {
    if (closing) return Promise.resolve()
    return request('/invalidation', 'POST', {
      ...event, reason: 'upstream_changed'
    }).then(() => undefined)
  })
  function register<I, O>(toolName: string, actionId: string, description: string,
    input: z.ZodType<I>, output: z.ZodType<O>, run: (value: I, signal: AbortSignal) => Promise<O>) {
    ctx.tools.register({
      name: toolName, description,
      parameters: { ...dshSchema(input, 'input') },
      output: {
        schema: dshSchema(output),
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
      },
      execute: async (args: unknown, exec: ToolRunContext) => {
        if (closing) throw new Error('Project DAG is closing')
        exec.signal.throwIfAborted()
        const value = input.parse(args)
        await port.authorize(actionId, value, {
          callId: String(exec.callId), signal: exec.signal,
          ...(exec.agent ? { agentId: String(exec.agent.id) } : {})
        })
        if (closing) throw new Error('Project DAG is closing')
        exec.signal.throwIfAborted()
        // Core checks cancellation immediately before its first write, including
        // after preparation/lane waits; admitted writes run to quiescence.
        const result = output.parse(await run(value, exec.signal))
        exec.signal.throwIfAborted()
        return result
      }
    })
  }
  register('project_dag_update', PROJECT_DAG_CAPABILITY_IDS.update,
    'Enqueue Project compilation from an explicit scope of committed Evidence snapshots.',
    projectDagUpdateInputSchema, projectDagUpdateOutputSchema, (value, signal) => core.update(value, signal))
  register('project_dag_save_goal', PROJECT_DAG_CAPABILITY_IDS.saveGoal,
    'Save and apply a Project goal using the durable Project command lane.',
    projectDagSaveGoalInputSchema, projectDagSaveGoalOutputSchema, (value, signal) => core.saveGoal(value, signal))
  register('project_dag_status', PROJECT_DAG_CAPABILITY_IDS.view,
    'Read durable Project status without opening UI or scanning chats.',
    projectDagViewInputSchema, projectDagStatusSchema, async value => {
      const query = new URLSearchParams(Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'))
      return normalizeProjectDagStatus(await request(`/updates/status?${query}`, 'GET'))
    })
}
