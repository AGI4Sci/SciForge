import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

const require = createRequire(import.meta.url)

test('approved runtime packages resolve at pinned versions with real Cordis scoped effects', async () => {
  assert.equal(require('@deepseek-ai/cordis/package.json').version, '4.0.4')
  assert.equal(require('@deepseek-ai/schemastery/package.json').version, '3.18.4')
  const root = new Context()
  const events: string[] = []
  let child: Context | undefined
  try {
    const fiber = await root.plugin((ctx: Context) => {
      child = ctx
      assert.equal(Context.is(ctx), true)
      assert.equal(ctx.root, root)
      assert.notEqual(ctx, root)
      ctx.effect(() => {
        events.push('apply')
        return () => { events.push('dispose') }
      })
    })
    assert.equal(fiber.ctx, child)
    assert.equal(typeof Service, 'function')
    assert.equal(Schema.string()('approved'), 'approved')
    assert.throws(() => Schema.string()(42 as unknown as string))
    await fiber.dispose()
    await fiber.dispose()
    assert.deepEqual(events, ['apply', 'dispose'])
  } finally {
    await root.fiber.dispose()
  }
})
