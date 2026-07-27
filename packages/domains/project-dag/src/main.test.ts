import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  PROJECT_DAG_CAPABILITY_IDS
} from './contract.js'
import type { ProjectDagError } from './contract.js'
import {
  createDomainMainEntry,
  createProjectDagCapabilityFactory,
  type ProjectDagCapabilityOptions
} from './main.js'
import {
  ProjectDagRuntime,
  ProjectDagRuntimeError
} from './runtime.js'

test('main entry lazily owns one lifecycle runtime shared by capabilities and consumer', async () => {
  const calls: string[] = []
  const fakeRuntime = {
    activate: async () => {
      calls.push('activate')
      return () => {
        calls.push('deactivate')
      }
    },
    dispose: async () => {
      calls.push('dispose')
    },
    view: async () => {
      calls.push('view')
      return { marker: 'view' }
    },
    update: async () => ({ marker: 'update' }),
    saveGoal: async () => ({ marker: 'goal' }),
    resolveEvidencePreview: async () => ({ marker: 'preview' }),
    consumeTurnCompleted: async () => {
      calls.push('consume')
    }
  } as unknown as ProjectDagRuntime
  const entry = createDomainMainEntry({
    getUserDataDir: () => {
      calls.push('getUserDataDir')
      return '/host-private-user-data'
    },
    defineCapability: (definition) => definition,
    createProjectDagRuntime: (options) => {
      calls.push(`create:${options?.userDataDir}`)
      return fakeRuntime
    }
  })

  assert.deepEqual(calls, [])
  assert.equal(entry.contributions.length, 3)
  const factory = entry.contributions[0]!.value as ReturnType<
    typeof createProjectDagCapabilityFactory<ProjectDagCapabilityOptions>
  >
  const definitions = factory.createDefinitions()
  assert.deepEqual(calls, [])
  const view = definitions.find(({ id }) =>
    id === PROJECT_DAG_CAPABILITY_IDS.view
  )
  assert.ok(view)
  assert.deepEqual(
    await view.handler({}, { caller: { workspaceId: '/workspace' } }),
    {
      output: {
        ok: false,
        error: {
          code: 'upstream_unavailable',
          message: 'Project DAG runtime lifecycle is not active.',
          retryable: true
        }
      }
    }
  )
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: DomainMainRuntimeLifecycleContext): Promise<unknown>
  }
  const consumer = entry.contributions[2]!.value as {
    consume(event: unknown): Promise<void>
  }
  await assert.rejects(consumer.consume({}), /lifecycle is not active/u)
  const deactivate = await lifecycle.activate({
    userDataDir: '/lifecycle-user-data'
  } as DomainMainRuntimeLifecycleContext) as () => Promise<void>
  const result = await view.handler(
    {},
    { caller: { workspaceId: '/workspace' } }
  )
  assert.deepEqual(result.output, {
    ok: true,
    data: { marker: 'view' }
  })
  assert.deepEqual(calls, [
    'create:/lifecycle-user-data',
    'activate',
    'view'
  ])

  await consumer.consume({})
  assert.deepEqual(calls, [
    'create:/lifecycle-user-data',
    'activate',
    'view',
    'consume'
  ])

  await deactivate()
  await entry.contributions[1]!.onDispose?.()
  assert.deepEqual(calls, [
    'create:/lifecycle-user-data',
    'activate',
    'view',
    'consume',
    'deactivate'
  ])
  await assert.rejects(consumer.consume({}), /lifecycle is not active/u)
})

test('Project capabilities use canonical contracts and governed effects', () => {
  const runtime = {
    view: async () => ({}),
    update: async () => ({}),
    saveGoal: async () => ({}),
    resolveEvidencePreview: async () => ({})
  } as unknown as ProjectDagRuntime
  const factory = createProjectDagCapabilityFactory<ProjectDagCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  })
  const definitions = new Map(
    factory.createDefinitions().map((definition) => [definition.id, definition])
  )

  assert.equal(definitions.get(PROJECT_DAG_CAPABILITY_IDS.view)?.effect, 'read')
  assert.equal(definitions.get(PROJECT_DAG_CAPABILITY_IDS.resolveEvidencePreview)?.effect, 'read')
  for (const id of [
    PROJECT_DAG_CAPABILITY_IDS.update,
    PROJECT_DAG_CAPABILITY_IDS.saveGoal
  ]) {
    const definition = definitions.get(id)
    assert.equal(definition?.effect, 'compute')
    assert.equal(definition?.approval, 'none')
    assert.equal(definition?.concurrency.idempotency, 'required')
  }
})

test('capability failures preserve stable typed Project errors', async () => {
  const expected: ProjectDagError = {
    code: 'evidence_vector_regression',
    message: 'Evidence vector would roll back a committed version.',
    retryable: false
  }
  const runtime = {
    view: async () => ({}),
    update: async () => {
      throw new ProjectDagRuntimeError(expected)
    },
    saveGoal: async () => ({}),
    resolveEvidencePreview: async () => ({})
  } as unknown as ProjectDagRuntime
  const definition = createProjectDagCapabilityFactory<ProjectDagCapabilityOptions>({
    defineCapability: (value) => value,
    getRuntime: () => runtime
  }).createDefinitions().find(({ id }) => id === PROJECT_DAG_CAPABILITY_IDS.update)
  assert.ok(definition)

  const result = await definition.handler(
    { workspaceRoot: '/workspace' },
    { caller: { workspaceId: '/workspace' } }
  )
  assert.deepEqual(result.output, { ok: false, error: expected })
})
