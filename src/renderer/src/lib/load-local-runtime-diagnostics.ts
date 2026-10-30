import type {
  LocalRuntimeMemoryRecordJson,
  LocalRuntimeInfoJson,
  LocalRuntimeToolDiagnosticsJson
} from '../agent/local-runtime-contract'
import type { AgentProvider } from '../agent/types'
import { describeRuntimeError } from './format-runtime-error'

type DiagnosticsProvider = Pick<AgentProvider, 'getRuntimeInfo' | 'getToolDiagnostics' | 'listMemories'>

export type LoadedLocalRuntimeDiagnostics = {
  runtimeInfo?: LocalRuntimeInfoJson | null
  toolDiagnostics?: LocalRuntimeToolDiagnosticsJson | null
  memoryRecords?: LocalRuntimeMemoryRecordJson[]
  errors: string[]
}

export async function loadLocalRuntimeDiagnostics(
  provider: DiagnosticsProvider,
  options: {
    workspace?: string
    memoryScope?: 'user' | 'workspace' | 'project'
    memoryQuery?: string
  } = {}
): Promise<LoadedLocalRuntimeDiagnostics> {
  const [runtimeInfo, toolDiagnostics, memoryRecords] = await Promise.allSettled([
    provider.getRuntimeInfo ? provider.getRuntimeInfo() : Promise.resolve(null),
    provider.getToolDiagnostics ? provider.getToolDiagnostics() : Promise.resolve(null),
    provider.listMemories
      ? provider.listMemories({
          workspace: options.workspace,
          scope: options.memoryScope,
          query: options.memoryQuery,
          includeDeleted: false
        })
      : Promise.resolve([])
  ])

  const loaded: LoadedLocalRuntimeDiagnostics = { errors: [] }

  if (runtimeInfo.status === 'fulfilled') {
    loaded.runtimeInfo = runtimeInfo.value ?? null
  } else {
    loaded.errors.push(`Runtime: ${errorMessage(runtimeInfo.reason)}`)
  }

  if (toolDiagnostics.status === 'fulfilled') {
    loaded.toolDiagnostics = toolDiagnostics.value ?? null
  } else {
    loaded.errors.push(`Tools: ${errorMessage(toolDiagnostics.reason)}`)
  }

  if (memoryRecords.status === 'fulfilled') {
    loaded.memoryRecords = memoryRecords.value ?? []
  } else {
    loaded.errors.push(`Memory: ${errorMessage(memoryRecords.reason)}`)
  }

  loaded.errors = [...new Set(loaded.errors)]
  return loaded
}

function errorMessage(error: unknown): string {
  return describeRuntimeError(error).summary
}
