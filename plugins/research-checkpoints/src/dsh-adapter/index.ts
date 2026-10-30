/**
 * DSH entrypoint for Research Checkpoints.
 *
 * Entry shape (from the main-branch DSH tests): `export const inject = ['tools']`
 * and `export function apply(ctx, config)` registering tools with `defineTool`.
 * The runtime requires async activation (durable journal reconciliation), so
 * `apply` returns cordis's async startup effect: activation completes before
 * the fiber reports ACTIVE, and the returned disposer deactivates the runtime
 * on unload.
 *
 * Configuration is host-provided (`dshConfig`): `dataDir` is the root under
 * which the store keeps its durable per-workspace journals (same on-disk
 * layout as the static module), and `sessions` carries recorded session
 * details for the fixture agent-threads port (plugins/GAPS.md, G1).
 */
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ResearchCheckpointRuntime } from '../core/runtime.js'
import {
  createFixtureRuntimeContext,
  researchCheckpointFixtureSessionsSchema
} from '../fixture/config-runtime-context.js'
import { registerResearchCheckpointTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools']

const configSchema = z.object({
  dataDir: z.string().trim().min(1).max(4_096),
  sessions: researchCheckpointFixtureSessionsSchema.default({})
}).strict()

export async function apply(
  ctx: Context & { tools: ToolRuntime },
  config?: unknown
): Promise<() => Promise<void>> {
  const { dataDir, sessions } = configSchema.parse(config ?? {})
  const controller = new AbortController()
  const runtime = new ResearchCheckpointRuntime({ userDataDir: dataDir })
  const deactivate = await runtime.activate(
    createFixtureRuntimeContext({ sessions, signal: controller.signal })
  )
  registerResearchCheckpointTools(
    (tool) => ctx.tools.register(tool as never),
    (definition: DshToolDefinition) => defineTool(definition as never),
    () => runtime
  )
  return async () => {
    await deactivate()
    controller.abort()
  }
}
