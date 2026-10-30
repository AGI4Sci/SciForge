export const PLUGIN_RUNTIME_RUNNER_FILES: readonly string[]

export function stagePluginRuntimeRunner(input: Readonly<{
  repositoryRoot: string
  mainOutputDirectory: string
}>): Promise<readonly string[]>

export function clearPluginRuntimeRunner(input: Readonly<{
  mainOutputDirectory: string
}>): Promise<void>