/**
 * The five Scientific Plotting capabilities expressed as DSH tool definitions.
 *
 * This file has no DSH import on purpose: `defineTool` is passed in, so the
 * wiring (names, parameters, delegation to the core, error behaviour) can be
 * tested without the official runtime packages. `index.ts` supplies the real one.
 *
 * Host contract, read from `packages/plugin-sdk/src/process-extension-runner.mjs`:
 *   - the host grants each tool by its DSH name; the grant must have an id
 *     matching ^[a-z][a-z0-9]*([._-][a-z0-9]+)+$ and an approved effect
 *     (read/compute/workspace-write/external-write/destructive)
 *   - granted read tools are projected with scope `resource`; every other
 *     effect gets scope `global` and idempotency `required`
 *   - `output.schema` is converted with `z.fromJSONSchema`, so it must be plain JSON Schema
 *
 * Caller workspace: the static capabilities derive it from the invocation
 * context; the host does not forward caller identity into tool arguments yet
 * (plugins/GAPS.md, G1), so workspace-scoped tools take an explicit required
 * `workspaceRoot` parameter. The adapter strips it before strict contract
 * parsing, and the operations overwrite any spoofed `workspaceRoot` inside the
 * input exactly like the static handlers.
 */
import { z } from 'zod'
import { SCIENTIFIC_PLOTTING_CAPABILITY_IDS } from '../contract.js'
import { SCIENTIFIC_PLOTTING_TEMPLATES } from '@sciforge/scientific-plotting/contract'
import {
  comparePlots,
  mapData,
  plottingStatus,
  renderPlot,
  rerunPlot,
  type ScientificPlottingOperationResult
} from '../core/operations.js'
import type { ScientificPlottingServiceFactory } from '../core/service-factory.js'

/** Host-side grant table this plugin expects. It is configured by the host, not by the plugin. */
export const EXPECTED_HOST_GRANTS = Object.freeze({
  status: { id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status, effect: 'read' },
  map_data: { id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData, effect: 'compute' },
  render: { id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render, effect: 'workspace-write' },
  rerun: { id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun, effect: 'workspace-write' },
  compare: { id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare, effect: 'read' }
} as const)

export type DshToolParameter = Readonly<{
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'json'
  required?: true
  items?: Readonly<{ type: 'string' }>
  enum?: readonly string[]
}>

export type DshToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, DshToolParameter>>
  output: Readonly<{
    schema: Readonly<Record<string, unknown>>
    render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[]
  }>
  execute: (args: unknown) => Promise<unknown>
}>

const render = (_args: unknown, value: unknown): readonly { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) }
]

/** Plain JSON Schema: the results are validated precisely by the core's zod schemas. */
const OBJECT_OUTPUT = Object.freeze({ type: 'object', additionalProperties: true })

const workspaceArgumentSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4_096)
}).passthrough()

function splitWorkspaceArgument(args: unknown): Readonly<{ input: unknown; workspaceRoot: string }> {
  const parsed = workspaceArgumentSchema.parse(args ?? {})
  const { workspaceRoot, ...input } = parsed
  return Object.freeze({ input, workspaceRoot })
}

const WORKSPACE_ROOT: DshToolParameter = { type: 'string', required: true }
const JSON_VALUE: DshToolParameter = { type: 'json' }
const REQUIRED_JSON: DshToolParameter = { type: 'json', required: true }
const OPERATION_ID: DshToolParameter = { type: 'string', required: true }
const TEMPLATE_ENUM: DshToolParameter = { type: 'string', enum: SCIENTIFIC_PLOTTING_TEMPLATES }
const REPRODUCIBILITY_MODE: DshToolParameter = {
  type: 'string',
  enum: ['standard', 'reproducible'] as const
}

/** The shared optional evidence/provenance fields of render and map-data requests. */
const COMMON_OPTIONAL = Object.freeze({
  reproducibilityMode: REPRODUCIBILITY_MODE,
  dataSources: JSON_VALUE,
  derivedTableReceipts: JSON_VALUE,
  transformations: JSON_VALUE,
  statistics: JSON_VALUE,
  provenanceWarnings: JSON_VALUE,
  versioning: JSON_VALUE,
  labels: JSON_VALUE,
  styleSpec: JSON_VALUE,
  styleSpecPath: { type: 'string' },
  styleProfileId: { type: 'string' },
  evidenceFigureVersionRef: JSON_VALUE,
  evidenceRecipeVersionRef: JSON_VALUE,
  evidenceRouting: JSON_VALUE
} as const satisfies Record<string, DshToolParameter>)

export function scientificPlottingTools(
  getFactory: () => ScientificPlottingServiceFactory
): readonly DshToolDefinition[] {
  const tool = (
    definition: Readonly<{
      name: string
      description: string
      parameters: Readonly<Record<string, DshToolParameter>>
      run: (
        factory: ScientificPlottingServiceFactory,
        input: unknown,
        workspaceRoot: string
      ) => Promise<ScientificPlottingOperationResult>
      needsWorkspace?: boolean
    }>
  ): DshToolDefinition => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: { schema: OBJECT_OUTPUT, render },
    execute: async (args) => {
      if (definition.needsWorkspace === false) {
        return (await definition.run(getFactory(), args, '')).output
      }
      const { input, workspaceRoot } = splitWorkspaceArgument(args)
      return (await definition.run(getFactory(), input, workspaceRoot)).output
    }
  })
  return [
    tool({
      name: 'status',
      description: 'Checks the deterministic renderer and its supported scientific templates.',
      parameters: {},
      run: (factory, input) => plottingStatus(factory, input),
      needsWorkspace: false
    }),
    tool({
      name: 'map_data',
      description: 'Maps structured data without rendering and records explicit transformations and statistics.',
      parameters: {
        operationId: OPERATION_ID,
        task: { type: 'string', required: true },
        visualPlan: REQUIRED_JSON,
        data: REQUIRED_JSON,
        templateHint: TEMPLATE_ENUM,
        ...COMMON_OPTIONAL,
        workspaceRoot: WORKSPACE_ROOT
      },
      run: mapData
    }),
    tool({
      name: 'render',
      description: 'Renders a versioned PNG with exact data, statistics, recipe, environment, manifest, and logs.',
      parameters: {
        operationId: OPERATION_ID,
        visualPlan: REQUIRED_JSON,
        data: REQUIRED_JSON,
        template: { type: 'string', enum: SCIENTIFIC_PLOTTING_TEMPLATES, required: true },
        matplotlib: JSON_VALUE,
        reviewTask: { type: 'string' },
        ...COMMON_OPTIONAL,
        workspaceRoot: WORKSPACE_ROOT
      },
      run: renderPlot
    }),
    tool({
      name: 'rerun',
      description: 'Reruns exact historical inputs and reports replication or divergence without reading latest.',
      parameters: {
        operationId: OPERATION_ID,
        baselineFigureVersionRef: REQUIRED_JSON,
        recipeVersionRef: REQUIRED_JSON,
        expectedCurrentVersionId: { type: 'string', required: true },
        runtimeId: { type: 'string' },
        threadId: { type: 'string' },
        workspaceRoot: WORKSPACE_ROOT
      },
      run: rerunPlot
    }),
    tool({
      name: 'compare',
      description: 'Compares output, data, statistics, transforms, style, sources, and environment.',
      parameters: {
        baselineManifestVersionRef: REQUIRED_JSON,
        candidateManifestVersionRef: REQUIRED_JSON,
        workspaceRoot: WORKSPACE_ROOT
      },
      run: comparePlots
    })
  ]
}

export function registerScientificPlottingTools(
  register: (tool: unknown) => unknown,
  defineTool: (definition: DshToolDefinition) => unknown,
  getFactory: () => ScientificPlottingServiceFactory
): void {
  for (const definition of scientificPlottingTools(getFactory)) register(defineTool(definition))
}
