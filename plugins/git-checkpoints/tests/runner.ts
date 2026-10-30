import {
  createCheckpoint,
  listCheckpoints,
  previewCheckpoint,
  restoreCheckpoint
} from '../src/core/operations.js'
import { GitCheckpointService } from '../src/core/service.js'
import type { GitCheckpointVcsPort } from '../src/ports/vcs.js'
import { WORKSPACE, type ScenarioStep } from './cases.js'

/**
 * Runs one scenario against the plugin operations and records either the
 * output value or the thrown error message per step. Used by the parity test
 * (against the static handlers) and by the golden baseline.
 */
export async function runPluginScenario(
  steps: readonly ScenarioStep[],
  options: Readonly<{
    vcs: GitCheckpointVcsPort
    userDataDir: string
    now: () => Date
    createId: () => string
  }>
): Promise<readonly unknown[]> {
  const service = new GitCheckpointService({
    userDataDir: options.userDataDir,
    vcs: options.vcs,
    now: options.now,
    createId: options.createId
  })
  const results: unknown[] = []
  for (const step of steps) {
    const caller = step.caller ?? WORKSPACE
    try {
      const result = step.op === 'create'
        ? await createCheckpoint(service, step.input, caller)
        : step.op === 'list'
          ? await listCheckpoints(service, step.input, caller)
          : step.op === 'preview'
            ? await previewCheckpoint(service, step.input, caller)
            : await restoreCheckpoint(service, step.input, caller)
      results.push({ value: result.output })
    } catch (error) {
      results.push({ threw: error instanceof Error ? error.message : String(error) })
    }
  }
  return Object.freeze(results)
}
