/**
 * Parity with the in-tree static module. The plugin core must reproduce the
 * static module's outputs exactly; this is the baseline the DSH entrypoint is
 * compared against too. It imports the static module by relative path, which
 * is allowed in tests only.
 */
import assert from 'node:assert/strict'
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createGitCheckpointsCapabilityFactory
} from '../../../packages/domains/git-checkpoints/src/main.js'
import { GitCheckpointService as StaticGitCheckpointService } from '../../../packages/domains/git-checkpoints/src/service.js'
import { GIT_CHECKPOINTS_CAPABILITY_IDS as STATIC_IDS } from '../../../packages/domains/git-checkpoints/src/contract.js'
import { GIT_CHECKPOINTS_CAPABILITY_IDS } from '../src/contract.js'
import {
  happyPathSteps,
  rejectionSteps,
  scriptedClock,
  scriptedIds,
  scriptedVcs,
  WORKSPACE,
  type ScenarioStep
} from './cases.js'
import { runPluginScenario } from './runner.js'
import type { GitCheckpointVcsPort } from '../src/ports/vcs.js'

type StaticDefinition = {
  id: string
  effect: string
  approval: string
  audiences: readonly string[]
  concurrency: { idempotency: string }
  handler: (
    input: unknown,
    context: Readonly<{ caller: Readonly<{ workspaceId?: string }> }>
  ) => Promise<Readonly<{ output: unknown }>>
}

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

async function runStaticScenario(
  steps: readonly ScenarioStep[],
  options: Readonly<{
    vcs: GitCheckpointVcsPort
    userDataDir: string
    now: () => Date
    createId: () => string
  }>
): Promise<readonly unknown[]> {
  const service = new StaticGitCheckpointService({
    userDataDir: options.userDataDir,
    vcs: options.vcs,
    now: options.now,
    createId: options.createId
  })
  const factory = createGitCheckpointsCapabilityFactory<StaticDefinition>({
    defineCapability: (options) => options as unknown as StaticDefinition,
    getService: () => service
  })
  const definitions = factory.createDefinitions()
  const handlerFor = (id: string): StaticDefinition => {
    const found = definitions.find((definition) => definition.id === id)
    assert.ok(found, `static capability ${id} missing`)
    return found
  }
  const results: unknown[] = []
  for (const step of steps) {
    const caller = step.caller ?? WORKSPACE
    const definition = handlerFor(STATIC_IDS[step.op])
    try {
      const result = await definition.handler(step.input, { caller: { workspaceId: caller } })
      results.push({ value: result.output })
    } catch (error) {
      results.push({ threw: error instanceof Error ? error.message : String(error) })
    }
  }
  return Object.freeze(results)
}

async function readMetadataTree(userDataDir: string): Promise<Record<string, string>> {
  const root = join(userDataDir, 'domain-data', 'git-checkpoints')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    files[entry.name] = await readFile(join(root, entry.name, 'metadata.json'), 'utf8')
  }
  return files
}

test('capability ids and policies match the static module', () => {
  assert.deepEqual(GIT_CHECKPOINTS_CAPABILITY_IDS, STATIC_IDS)
  assert.equal(STATIC_IDS.list, 'git-checkpoints.list')
  assert.equal(STATIC_IDS.create, 'git-checkpoints.create')
  assert.equal(STATIC_IDS.preview, 'git-checkpoints.preview')
  assert.equal(STATIC_IDS.restore, 'git-checkpoints.restore')
})

test('happy path: static handlers and plugin operations produce identical outputs and on-disk state', async () => {
  // The checkpoint id is derived from the scripted clock and id sequence, so
  // it is identical on both sides; run once to learn it is stable.
  const probeSteps = happyPathSteps('unused')
  const probe = await runPluginScenario(probeSteps, {
    vcs: scriptedVcs().vcs,
    userDataDir: await tempRoot('parity-probe-'),
    now: scriptedClock(),
    createId: scriptedIds()
  })
  const createdId = (probe[0] as { value: { ok: true; value: { checkpointId: string } } })
    .value.value.checkpointId
  assert.match(createdId, /^manual_\d+_id-1$/u)

  const steps = happyPathSteps(createdId)
  const pluginDir = await tempRoot('parity-plugin-')
  const staticDir = await tempRoot('parity-static-')
  const pluginResults = await runPluginScenario(steps, {
    vcs: scriptedVcs().vcs,
    userDataDir: pluginDir,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  const staticResults = await runStaticScenario(steps, {
    vcs: scriptedVcs().vcs,
    userDataDir: staticDir,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  assert.deepEqual(pluginResults, staticResults)
  assert.equal(pluginResults.length, steps.length)
  for (const result of pluginResults) {
    assert.ok(!('threw' in (result as Record<string, unknown>)), `happy path step threw: ${JSON.stringify(result)}`)
  }
  assert.deepEqual(await readMetadataTree(pluginDir), await readMetadataTree(staticDir))
})

test('rejections: invalid inputs and policy violations behave identically', async () => {
  const probe = await runPluginScenario(happyPathSteps('unused').slice(0, 1), {
    vcs: scriptedVcs().vcs,
    userDataDir: await tempRoot('parity-probe-'),
    now: scriptedClock(),
    createId: scriptedIds()
  })
  const createdId = (probe[0] as { value: { ok: true; value: { checkpointId: string } } })
    .value.value.checkpointId

  const steps = rejectionSteps(createdId)
  const pluginDir = await tempRoot('parity-plugin-')
  const staticDir = await tempRoot('parity-static-')
  const pluginResults = await runPluginScenario(steps, {
    vcs: scriptedVcs().vcs,
    userDataDir: pluginDir,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  const staticResults = await runStaticScenario(steps, {
    vcs: scriptedVcs().vcs,
    userDataDir: staticDir,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  assert.deepEqual(pluginResults, staticResults)
  // The scenario deliberately mixes thrown validation errors and ok:false
  // results; make sure both kinds actually occurred on both sides.
  const threwCount = pluginResults.filter((entry) => 'threw' in (entry as object)).length
  const failedCount = pluginResults.filter(
    (entry) => (entry as { value?: { ok?: boolean } }).value?.ok === false
  ).length
  assert.ok(threwCount > 0 && failedCount > 0)
  assert.deepEqual(await readMetadataTree(pluginDir), await readMetadataTree(staticDir))
})

test('failure mapping: dirty restore and rescue failure are identical', async () => {
  for (const variant of ['dirty', 'rescue-failure'] as const) {
    const vcsOptions = variant === 'dirty'
      ? { dirtyOnRestore: ['snapshot-1'] }
      : { failCaptureOnCall: 2 }
    const probe = await runPluginScenario(happyPathSteps('unused').slice(0, 1), {
      vcs: scriptedVcs(vcsOptions).vcs,
      userDataDir: await tempRoot('parity-probe-'),
      now: scriptedClock(),
      createId: scriptedIds()
    })
    const createdId = (probe[0] as { value: { ok: true; value: { checkpointId: string } } })
      .value.value.checkpointId
    const steps: readonly ScenarioStep[] = [
      { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: WORKSPACE } },
      { op: 'restore', input: { checkpointId: createdId } },
      { op: 'list', input: {} }
    ]
    const pluginDir = await tempRoot('parity-plugin-')
    const staticDir = await tempRoot('parity-static-')
    const pluginResults = await runPluginScenario(steps, {
      vcs: scriptedVcs(vcsOptions).vcs,
      userDataDir: pluginDir,
      now: scriptedClock(),
      createId: scriptedIds()
    })
    const staticResults = await runStaticScenario(steps, {
      vcs: scriptedVcs(vcsOptions).vcs,
      userDataDir: staticDir,
      now: scriptedClock(),
      createId: scriptedIds()
    })
    assert.deepEqual(pluginResults, staticResults, `variant ${variant} diverged`)
    assert.deepEqual(await readMetadataTree(pluginDir), await readMetadataTree(staticDir), `variant ${variant} metadata diverged`)
  }
})
