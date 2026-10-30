/**
 * DSH entrypoint for Git Checkpoints.
 *
 * Entry shape (from the main-branch DSH tests): `export const inject = ['tools']`
 * and `export function apply(ctx, config)` registering tools with `defineTool`.
 *
 * Configuration is host-provided (`dshConfig`): `dataDir` is the root under
 * which the service keeps package-owned checkpoint metadata, using the same
 * on-disk layout as the static module. The version-control port uses the
 * bundled local Git fixture until the host capability bridge for plugins
 * exists (plugins/GAPS.md, G1).
 */
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { GitCheckpointService } from '../core/service.js'
import { createLocalGitVcs } from '../fixture/local-git-vcs.js'
import { registerGitCheckpointTools, type DshToolDefinition } from './tools.js'

export const inject = ['tools']

const configSchema = z.object({
  dataDir: z.string().trim().min(1).max(4_096)
}).strict()

export function apply(ctx: Context & { tools: ToolRuntime }, config?: unknown): void {
  const { dataDir } = configSchema.parse(config ?? {})
  const service = new GitCheckpointService({
    userDataDir: dataDir,
    vcs: createLocalGitVcs()
  })
  registerGitCheckpointTools(
    (tool) => ctx.tools.register(tool as never),
    (definition: DshToolDefinition) => defineTool(definition as never),
    () => service
  )
}
