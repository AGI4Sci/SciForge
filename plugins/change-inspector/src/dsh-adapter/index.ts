/**
 * DSH entrypoint for Change Inspector.
 *
 * Entry shape (from the main-branch DSH tests): `export const inject = ['tools']`
 * and `export function apply(ctx, config)` registering tools with `defineTool`.
 *
 * Configuration is host-provided (`dshConfig`): `sessions` carries recorded
 * session details for the config-driven agent-threads fixture, used until the
 * host capability bridge for plugins exists (plugins/GAPS.md, G1).
 */
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ChangeInspectorService } from '../core/service.js'
import {
  changeInspectorFixtureConfigSchema,
  createConfigAgentThreads
} from '../fixture/config-agent-threads.js'
import { registerChangeInspectorTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools']

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  const fixtureConfig = changeInspectorFixtureConfigSchema.parse(config ?? {})
  const service = new ChangeInspectorService({
    agentThreads: createConfigAgentThreads(fixtureConfig)
  })
  registerChangeInspectorTools(
    (tool) => ctx.tools.register(tool as never),
    (definition: DshToolDefinition) => defineTool(definition as never),
    () => service
  )
}
