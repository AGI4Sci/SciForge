/**
 * Capability-layer parity with the in-tree static module. Every capability is
 * exercised through both surfaces with the same scripted service underneath:
 * the static side goes through `createScientificPlottingCapabilityFactory`
 * handlers (caller workspace via invocation context, input pre-parsed by the
 * host's inputSchema exactly like production), the plugin side through
 * `core/operations` (caller workspace as an explicit argument — G1, contract
 * parse inside the operation). Both must produce identical `{ output }`
 * results, forward identical service inputs (including the anti-spoofing
 * workspace overwrite) and reject with the same messages. The static module
 * is imported by relative path, which is allowed in tests only.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createScientificPlottingCapabilityFactory,
  type ScientificPlottingCapabilityOptions
} from '../../../packages/domains/scientific-plotting/src/main.js'
import type { ScientificPlottingService } from '@sciforge/scientific-plotting/service'
import { SCIENTIFIC_PLOTTING_CAPABILITY_IDS } from '../src/contract.js'
import {
  comparePlots,
  mapData,
  plottingStatus,
  renderPlot,
  rerunPlot
} from '../src/core/operations.js'
import type { ScientificPlottingServiceFactory } from '../src/core/service-factory.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

const WORKSPACE = '/workspace/parity'

type ServiceCall = Readonly<{ operation: string; input?: unknown }>

/** Scripted service double mirroring the static main.test.ts fixture shape. */
function scriptedService(calls: ServiceCall[]): ScientificPlottingService {
  return {
    status: async () => {
      calls.push({ operation: 'status' })
      return {
        ok: true,
        serverName: 'scientific_plotting',
        version: 'parity',
        degraded: false,
        supportedTemplates: []
      } as never
    },
    mapData: async (input) => {
      calls.push({ operation: 'mapData', input })
      return { ok: false, status: 'invalid_request', message: 'scripted' } as never
    },
    render: async (input) => {
      calls.push({ operation: 'render', input })
      return { ok: false, status: 'invalid_request', message: 'scripted' } as never
    },
    rerun: async (input) => {
      calls.push({ operation: 'rerun', input })
      return { ok: false, status: 'rerun_failed', message: 'scripted' } as never
    },
    compare: async (input) => {
      calls.push({ operation: 'compare', input })
      return { ok: false, status: 'manifest_read_failed', message: 'scripted' } as never
    }
  }
}

type StaticDefinition = ScientificPlottingCapabilityOptions

function staticDefinitions(
  service: ScientificPlottingService
): ReadonlyMap<string, StaticDefinition> {
  const factory = createScientificPlottingCapabilityFactory<StaticDefinition>({
    defineCapability: (value) => value,
    statusService: service,
    serviceFor: () => service
  })
  return new Map(factory.createDefinitions().map((definition) => [definition.id, definition]))
}

function pluginFactory(service: ScientificPlottingService): ScientificPlottingServiceFactory {
  return Object.freeze({ statusService: service, serviceFor: () => service })
}

function artifactRef(name: string) {
  return {
    artifactId: `artifact:${name}`,
    versionId: `artifact-version:${name}`,
    contentDigest: 'a'.repeat(64),
    byteLength: 42,
    mediaType: 'application/json',
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }
}

const VALID_PLAN = {
  planId: 'plan-parity-1',
  route: 'code',
  routeLocked: true,
  rationale: 'parity',
  sourceArtifacts: [],
  reproducibleInputs: [],
  lockedElements: [],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'draft_ready',
  fallbackPolicy: 'fail_closed'
}
const OPERATION_ID = 'parity-operation-0001'

type ParityCase = Readonly<{
  capabilityId: string
  run: (
    factory: ScientificPlottingServiceFactory,
    input: unknown,
    workspace: string
  ) => Promise<Readonly<{ output: unknown }>>
  input: unknown
}>

const CASES: readonly ParityCase[] = [
  {
    capabilityId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
    run: (factory, input) => plottingStatus(factory, input),
    input: {}
  },
  {
    capabilityId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
    run: (factory: ScientificPlottingServiceFactory, input: unknown, workspace: string) =>
      mapData(factory, input, workspace),
    input: { operationId: OPERATION_ID, task: 'Parity mapping', visualPlan: VALID_PLAN, data: [] }
  },
  {
    capabilityId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
    run: (factory: ScientificPlottingServiceFactory, input: unknown, workspace: string) =>
      renderPlot(factory, input, workspace),
    input: { operationId: OPERATION_ID, visualPlan: VALID_PLAN, data: [], template: 'scatter' }
  },
  {
    capabilityId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
    run: (factory: ScientificPlottingServiceFactory, input: unknown, workspace: string) =>
      rerunPlot(factory, input, workspace),
    input: {
      operationId: OPERATION_ID,
      baselineFigureVersionRef: artifactRef('figure-v1'),
      recipeVersionRef: artifactRef('recipe-v1'),
      expectedCurrentVersionId: 'artifact-version:figure-v1'
    }
  },
  {
    capabilityId: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare,
    run: (factory: ScientificPlottingServiceFactory, input: unknown, workspace: string) =>
      comparePlots(factory, input, workspace),
    input: {
      baselineManifestVersionRef: artifactRef('manifest-v1'),
      candidateManifestVersionRef: artifactRef('manifest-v2')
    }
  }
] as const

async function runBoth(
  testCase: (typeof CASES)[number],
  workspace: string | undefined
): Promise<Readonly<{
  staticOutput?: unknown
  pluginOutput?: unknown
  staticError?: string
  pluginError?: string
  staticCalls: readonly ServiceCall[]
  pluginCalls: readonly ServiceCall[]
}>> {
  const staticCalls: ServiceCall[] = []
  const pluginCalls: ServiceCall[] = []
  const definitions = staticDefinitions(scriptedService(staticCalls))
  const definition = definitions.get(testCase.capabilityId)
  assert.ok(definition, `static definition missing for ${testCase.capabilityId}`)

  let staticOutput: unknown
  let staticError: string | undefined
  try {
    // The static host parses input with the capability inputSchema before the
    // handler runs; reproduce that boundary so both surfaces see identical input.
    const parsed = definition.inputSchema.parse(testCase.input)
    staticOutput = (await definition.handler(parsed, {
      caller: workspace === undefined ? {} : { workspaceId: workspace }
    })).output
  } catch (error) {
    staticError = error instanceof Error ? error.message : String(error)
  }

  let pluginOutput: unknown
  let pluginError: string | undefined
  try {
    pluginOutput = (await testCase.run(
      pluginFactory(scriptedService(pluginCalls)),
      testCase.input,
      workspace ?? ''
    )).output
  } catch (error) {
    pluginError = error instanceof Error ? error.message : String(error)
  }
  return { staticOutput, pluginOutput, staticError, pluginError, staticCalls, pluginCalls }
}

test('every capability forwards identical service inputs and outputs through both surfaces', async () => {
  assert.equal(CASES.length, 5)
  for (const testCase of CASES) {
    const { staticOutput, pluginOutput, staticError, pluginError, staticCalls, pluginCalls } =
      await runBoth(testCase, WORKSPACE)
    assert.equal(pluginError, undefined, `${testCase.capabilityId} plugin error: ${pluginError}`)
    assert.equal(staticError, undefined, `${testCase.capabilityId} static error: ${staticError}`)
    assert.deepEqual(pluginOutput, staticOutput, `${testCase.capabilityId} output diverged`)
    assert.deepEqual(pluginCalls, staticCalls, `${testCase.capabilityId} service calls diverged`)
  }
})

test('a spoofed input workspaceRoot is overwritten by the caller workspace on both surfaces', async () => {
  for (const testCase of CASES) {
    if (testCase.capabilityId === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status) continue
    const spoofed = {
      ...testCase,
      input: { ...(testCase.input as Record<string, unknown>), workspaceRoot: '/spoofed' }
    }
    const { staticCalls, pluginCalls, staticError, pluginError } = await runBoth(spoofed, WORKSPACE)
    assert.equal(pluginError, undefined)
    assert.equal(staticError, undefined)
    assert.deepEqual(pluginCalls, staticCalls, `${testCase.capabilityId} spoof handling diverged`)
    const input = pluginCalls[0]?.input as { workspaceRoot: string }
    assert.equal(input.workspaceRoot, WORKSPACE, `${testCase.capabilityId} kept a spoofed root`)
  }
})

test('missing caller workspace scope rejects with the identical message on both surfaces', async () => {
  for (const testCase of CASES) {
    if (testCase.capabilityId === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status) continue
    const { staticError, pluginError, staticCalls, pluginCalls } = await runBoth(testCase, undefined)
    assert.equal(pluginError, 'Scientific Plotting requires a workspace-scoped caller.')
    assert.equal(staticError, pluginError, `${testCase.capabilityId} scope error diverged`)
    assert.deepEqual(pluginCalls, [])
    assert.deepEqual(staticCalls, [])
  }
})

test('invalid inputs reject identically before any service call', async () => {
  for (const testCase of CASES) {
    const invalidCase = { ...testCase, input: { unexpected: true } }
    const { staticError, pluginError, staticCalls, pluginCalls } = await runBoth(
      invalidCase,
      WORKSPACE
    )
    assert.equal(pluginError, staticError, `${testCase.capabilityId} invalid-input error diverged`)
    assert.ok(pluginError, `${testCase.capabilityId} accepted an invalid input`)
    assert.deepEqual(pluginCalls, [])
    assert.deepEqual(staticCalls, [])
  }
})

test('grant table effects match the static capability governance metadata', () => {
  const definitions = staticDefinitions(scriptedService([]))
  const expectedByCapability = new Map<string, string>(
    Object.values(EXPECTED_HOST_GRANTS).map((grant) => [grant.id, grant.effect])
  )
  assert.equal(definitions.size, expectedByCapability.size)
  for (const [id, definition] of definitions) {
    assert.equal(expectedByCapability.get(id), definition.effect, `${id} effect diverged`)
    assert.equal(definition.approval, 'none')
    assert.deepEqual(definition.audiences, ['ui', 'agent', 'system'])
    assert.equal(
      definition.concurrency.idempotency,
      definition.effect === 'read' ? 'none' : 'required'
    )
  }
})
