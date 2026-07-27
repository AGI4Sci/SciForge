import type { AgentRuntimeId } from './app-settings-types'

export type CodingPlanAdapterDefinition = Readonly<{
  id: string
  runtimeId: AgentRuntimeId
}>

export const CODING_PLAN_ADAPTERS = [
  { id: 'codex', runtimeId: 'codex' }
] as const satisfies readonly CodingPlanAdapterDefinition[]

export type CodingPlanAdapterId = typeof CODING_PLAN_ADAPTERS[number]['id']

export function resolveCodingPlanAdapter(
  adapterId: string
): CodingPlanAdapterDefinition | undefined {
  return CODING_PLAN_ADAPTERS.find((adapter) => adapter.id === adapterId)
}
