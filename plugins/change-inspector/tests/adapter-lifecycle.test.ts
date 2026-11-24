import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { apply } from '../src/dsh-adapter/index.js'

test('artifact explicitly declares its session service and read-only port', () => {
  const declaration = JSON.parse(readFileSync(new URL('../sciforge.dsh.json', import.meta.url), 'utf8'))
  assert.deepEqual(declaration.hostServices, ['agentThreads'])
  assert.deepEqual(declaration.ports, ['agent-threads.read'])
  assert.ok(Object.values(declaration.tools).every(tool => (tool as { effect: string }).effect === 'read'))
})

function harness(failAt?: number) {
  const active = new Set<unknown>()
  let registrations = 0
  let cleanup: (() => void) | undefined
  const ctx = {
    agentThreads: { invoke: async () => ({}) },
    tools: { register(tool: unknown) {
      if (++registrations === failAt) throw new Error('Registration failed')
      active.add(tool)
      return () => { active.delete(tool) }
    } },
    effect(factory: () => () => void) { cleanup = factory() }
  }
  return { ctx, active, dispose: () => cleanup?.() }
}

test('adapter owns all tool registrations across unload and repeated cleanup', () => {
  const h = harness()
  apply(h.ctx as never)
  assert.equal(h.active.size, 2)
  h.dispose()
  h.dispose()
  assert.equal(h.active.size, 0)
})

test('partial activation rolls back previously registered tools', () => {
  const h = harness(2)
  assert.throws(() => apply(h.ctx as never), /Registration failed/)
  assert.equal(h.active.size, 0)
})

test('missing authorized session port fails before registering tools', () => {
  const h = harness()
  assert.throws(() => apply({ ...h.ctx, agentThreads: undefined } as never), /authorized agentThreads/)
  assert.equal(h.active.size, 0)
})
