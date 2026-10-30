/**
 * Capability orchestration equivalent to the static capability handlers in
 * `packages/domains/scientific-plotting/src/main.ts`. Each operation mirrors
 * its static handler: the caller workspace arrives as an explicit argument
 * (the host does not forward caller identity into tool arguments yet —
 * plugins/GAPS.md, G1), the contract schema is parsed strictly, and a spoofed
 * `workspaceRoot` inside the input is overwritten by the caller workspace.
 * Unlike Research Checkpoints, these handlers let failures throw — the
 * service result objects already carry the `{ ok, status, message }`
 * contract, and validation/scope errors propagate exactly like the static
 * host path.
 */
import {
  scientificPlottingCompareRequestSchema,
  scientificPlottingMapDataRequestSchema,
  scientificPlottingRenderRequestSchema,
  scientificPlottingRerunRequestSchema,
  scientificPlottingStatusInputSchema
} from '../contract.js'
import type { ScientificPlottingServiceFactory } from './service-factory.js'

export type ScientificPlottingOperationResult = Readonly<{ output: unknown }>

/** Same message as the static `requireWorkspace` in main.ts. */
function requireWorkspace(workspaceRoot: string): string {
  const value = workspaceRoot.trim()
  if (!value) throw new Error('Scientific Plotting requires a workspace-scoped caller.')
  return value
}

export async function plottingStatus(
  factory: ScientificPlottingServiceFactory,
  rawInput?: unknown
): Promise<ScientificPlottingOperationResult> {
  scientificPlottingStatusInputSchema.parse(rawInput ?? {})
  return { output: await factory.statusService.status() }
}

export async function mapData(
  factory: ScientificPlottingServiceFactory,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ScientificPlottingOperationResult> {
  const input = scientificPlottingMapDataRequestSchema.parse(rawInput)
  const workspace = requireWorkspace(workspaceRoot)
  return { output: await factory.serviceFor(workspace).mapData({ ...input, workspaceRoot: workspace }) }
}

export async function renderPlot(
  factory: ScientificPlottingServiceFactory,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ScientificPlottingOperationResult> {
  const input = scientificPlottingRenderRequestSchema.parse(rawInput)
  const workspace = requireWorkspace(workspaceRoot)
  return { output: await factory.serviceFor(workspace).render({ ...input, workspaceRoot: workspace }) }
}

export async function rerunPlot(
  factory: ScientificPlottingServiceFactory,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ScientificPlottingOperationResult> {
  const input = scientificPlottingRerunRequestSchema.parse(rawInput)
  const workspace = requireWorkspace(workspaceRoot)
  return { output: await factory.serviceFor(workspace).rerun({ ...input, workspaceRoot: workspace }) }
}

export async function comparePlots(
  factory: ScientificPlottingServiceFactory,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ScientificPlottingOperationResult> {
  const input = scientificPlottingCompareRequestSchema.parse(rawInput)
  const workspace = requireWorkspace(workspaceRoot)
  return { output: await factory.serviceFor(workspace).compare({ ...input, workspaceRoot: workspace }) }
}
