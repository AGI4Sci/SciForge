import test from 'node:test'
import assert from 'node:assert/strict'
import { DSH_PERMISSION_POLICY_PLUGIN } from '../src/permission-policy.ts'

const plugin = await import(`data:text/javascript;base64,${Buffer.from(DSH_PERMISSION_POLICY_PLUGIN).toString('base64')}`)

test('the owned plugin applies the selected official preset after restored session state', () => {
  assert.deepEqual(plugin.inject, ['permissionPresets', 'sandboxPolicy'])
  for (const preset of ['read-only', 'workspace-write', 'danger-full-access']) {
    let hook: ((event: { agent: { session: object } }) => void) | undefined
    const session = { restoredPreset: 'read-only' }
    let current = session.restoredPreset
    plugin.apply({
      on: (event: string, callback: typeof hook, options?: { global: boolean }) => {
        // A root ACP agent is outside this plugin's local Cordis scope.
        if (event === 'agent/created' && options?.global) hook = callback
      },
      sandboxPolicy: { resolve: () => ({ mode: current }) },
      permissionPresets: {
        resolve: (name: string) => ({ sandbox: name }),
        set: (target: object, name: string) => { assert.equal(target, session); current = name },
        current: (target: object) => { assert.equal(target, session); return current }
      }
    }, { preset })
    assert.ok(hook)
    hook({ agent: { session } })
    assert.equal(current, preset)
  }
})

test('the owned plugin rejects mismatched official catalog or effective sandbox authority', () => {
  assert.throws(() => plugin.apply({ permissionPresets: { resolve: () => ({ sandbox: 'workspace-write' }) } }, { preset: 'danger-full-access' }), /unexpected sandbox mapping/)
  let hook!: (event: unknown) => void
  plugin.apply({
    on: (event: string, callback: typeof hook, options?: { global: boolean }) => {
        // A root ACP agent is outside this plugin's local Cordis scope.
        if (event === 'agent/created' && options?.global) hook = callback
      },
    permissionPresets: { resolve: () => ({ sandbox: 'danger-full-access' }), set: () => {}, current: () => 'danger-full-access' },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) }
  }, { preset: 'danger-full-access' })
  assert.throws(() => hook({ agent: { session: {} } }), /effective sandbox policy/)
})

test('the owned plugin fences every tool execution against a changed sandbox policy', () => {
  let hook!: (exec: unknown, next: () => string) => string
  let mode = 'danger-full-access'
  plugin.apply({
    on: (event: string, callback: typeof hook, options?: { prepend: boolean; global: boolean }) => {
      if (event === 'tools/pre-execute' && options?.global) { assert.equal(options.prepend, true); hook = callback }
    },
    permissionPresets: { resolve: () => ({ sandbox: 'danger-full-access' }) },
    sandboxPolicy: { resolve: () => ({ mode }) }
  }, { preset: 'danger-full-access' })
  assert.equal(hook({ agent: { session: {} } }, () => 'executed'), 'executed')
  mode = 'workspace-write'
  assert.throws(() => hook({ agent: { session: {} } }, () => { throw new Error('must not execute') }), /changed before tool execution/)
})

test('the owned plugin rejects invalid presets and refuses a failed policy update', () => {
  assert.throws(() => plugin.apply({}, { preset: 'unknown' }), /Invalid Host/)
  let hook!: (event: unknown) => void
  plugin.apply({ on: (event: string, callback: typeof hook, options?: { global: boolean }) => {
        // A root ACP agent is outside this plugin's local Cordis scope.
        if (event === 'agent/created' && options?.global) hook = callback
      }, permissionPresets: {
    resolve: (name: string) => ({ sandbox: name }), set: () => {}, current: () => 'read-only'
  } }, { preset: 'workspace-write' })
  assert.throws(() => hook({ agent: { session: {} } }), /was not applied/)
})
