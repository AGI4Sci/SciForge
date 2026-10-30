/**
 * DSH entrypoint for Scientific Plotting.
 *
 * Entry shape (from the main-branch DSH tests): `export const inject = ['tools']`
 * and `export function apply(ctx, config)` registering tools with `defineTool`.
 * The engine needs no asynchronous activation: services are created lazily per
 * workspace and the plugin holds no timers, sockets or global state.
 *
 * Stage-one configuration is empty (`{}`): until the host capability bridge
 * for plugins exists (plugins/GAPS.md, G1), workspace services run in the
 * engine's own dependency-free degraded mode. See src/fixture/config.ts.
 */
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScientificPlottingServiceFactory } from '../core/service-factory.js'
import { scientificPlottingConfigSchema } from '../fixture/config.js'
import { registerScientificPlottingTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools']

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  scientificPlottingConfigSchema.parse(config ?? {})
  const factory = createScientificPlottingServiceFactory()
  registerScientificPlottingTools(
    (tool) => ctx.tools.register(tool as never),
    (definition: DshToolDefinition) => defineTool(definition as never),
    () => factory
  )
}
