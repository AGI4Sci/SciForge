/**
 * DSH tool wiring tested without the official runtime packages: a fake
 * `defineTool`/register pair verifies the tool names, grant mapping,
 * delegation to the core operations, the workspaceRoot argument split and
 * error behaviour. This is not evidence of compatibility with the official
 * runtime; host-loading.test.ts covers that.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCIENTIFIC_PLOTTING_CAPABILITY_IDS } from '../src/contract.js'
import type { ScientificPlottingOperationResult } from '../src/core/operations.js'
import type { ScientificPlottingServiceFactory } from '../src/core/service-factory.js'
import {
  EXPECTED_HOST_GRANTS,
  registerScientificPlottingTools,
  scientificPlottingTools
} from '../src/dsh-adapter/tools.js'

const WORKSPACE = '/workspace/dsh-tools'

/** Factory double: records serviceFor workspaces; operations never reach a service. */
function recordingFactory(): ScientificPlottingServiceFactory {
  const never = async (): Promise<never> => {
    throw new Error('scripted service must not run in wiring tests')
  }
  const service = {
    status: never,
    mapData: never,
    render: never,
    rerun: never,
    compare: never
  } as never
  return Object.freeze({ statusService: service, serviceFor: () => service })
}

test('registers exactly the five granted tools with matching capability ids', () => {
  const registered: unknown[] = []
  registerScientificPlottingTools(
    (tool) => { registered.push(tool) },
    (definition) => definition,
    () => recordingFactory()
  )
  assert.equal(registered.length, 5)

  const tools = scientificPlottingTools(() => recordingFactory())
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['status', 'map_data', 'render', 'rerun', 'compare']
  )
  assert.deepEqual(
    Object.fromEntries(Object.entries(EXPECTED_HOST_GRANTS).map(([name, grant]) => [name, grant.id])),
    {
      status: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
      map_data: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
      render: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
      rerun: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
      compare: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare
    }
  )
  for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
    assert.match(grant.id, /^[a-z][a-z0-9]*([._-][a-z0-9]+)+$/)
  }
  assert.equal(EXPECTED_HOST_GRANTS.status.effect, 'read')
  assert.equal(EXPECTED_HOST_GRANTS.map_data.effect, 'compute')
  assert.equal(EXPECTED_HOST_GRANTS.render.effect, 'workspace-write')
})

test('workspace-scoped tools declare workspaceRoot; status stays global', () => {
  const tools = scientificPlottingTools(() => recordingFactory())
  for (const tool of tools) {
    if (tool.name === 'status') {
      assert.equal(tool.parameters.workspaceRoot, undefined)
    } else {
      assert.deepEqual(tool.parameters.workspaceRoot, { type: 'string', required: true })
    }
    assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true })
    const rendered = tool.output.render({}, { ok: true })
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0]?.type, 'text')
  }
})

test('tool execution splits workspaceRoot out before strict contract parsing', async () => {
  const seen: string[] = []
  const factory: ScientificPlottingServiceFactory = Object.freeze({
    statusService: { status: async () => ({ ok: true, sentinel: 'status' }) } as never,
    serviceFor: (workspaceRoot: string) => {
      seen.push(workspaceRoot)
      return {
        compare: async (input: unknown) => ({ ok: false, status: 'manifest_read_failed', input })
      } as never
    }
  })
  const tools = scientificPlottingTools(() => factory)
  const status = tools.find((tool) => tool.name === 'status')
  assert.ok(status)
  const statusResult = await status.execute({}) as { ok: boolean }
  assert.equal(statusResult.ok, true)

  const compare = tools.find((tool) => tool.name === 'compare')
  assert.ok(compare)
  const ref = {
    artifactId: 'artifact:m',
    versionId: 'artifact-version:m',
    contentDigest: 'a'.repeat(64),
    byteLength: 1,
    mediaType: 'application/json',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const result = await compare.execute({
    baselineManifestVersionRef: ref,
    candidateManifestVersionRef: { ...ref, versionId: 'artifact-version:m2' },
    workspaceRoot: WORKSPACE
  }) as { ok: boolean }
  assert.equal(result.ok, false)
  assert.deepEqual(seen, [WORKSPACE])
})

test('tool execution rejects a missing workspaceRoot and invalid contract input', async () => {
  const tools = scientificPlottingTools(() => recordingFactory())
  const compare = tools.find((tool) => tool.name === 'compare')
  assert.ok(compare)
  await assert.rejects(
    compare.execute({ baselineManifestVersionRef: {}, candidateManifestVersionRef: {} }),
    /workspaceRoot|invalid|required/i
  )
  // Strict contract parsing rejects unknown keys that survive the DSL boundary.
  await assert.rejects(
    compare.execute({
      baselineManifestVersionRef: {},
      candidateManifestVersionRef: {},
      workspaceRoot: WORKSPACE,
      extra: 1
    }),
    /unrecognized|extra|invalid/i
  )
})

test('operation errors propagate through the tool boundary exactly like the static host path', async () => {
  const factory: ScientificPlottingServiceFactory = Object.freeze({
    statusService: {
      status: async () => { throw new Error('scripted status outage') }
    } as never,
    serviceFor: () => { throw new Error('unreachable') }
  })
  const tools = scientificPlottingTools(() => factory)
  const status = tools.find((tool) => tool.name === 'status')
  assert.ok(status)
  await assert.rejects(status.execute({}), /scripted status outage/u)
})
