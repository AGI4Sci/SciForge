import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MINIMAL_CONTEXT_PLUGIN, minimalContextRows, validateMinimalContext } from '../src/minimal-context.js'

describe('minimal DSH composition', () => {
  it('disables workspace/shared instructions and shell by public plugin identity', () => {
    const entries = [{ id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'arbitrary', name: '@deepseek-ai/dsh-agent-instructions' }, { id: 'shell', name: '@deepseek-ai/dsh-tool-bash' }]
    const rows = minimalContextRows(entries)
    assert.deepEqual(rows.slice(0, 2), [{ id: 'arbitrary', disabled: true }, { id: 'shell', disabled: true }])
    const composed = entries.map(entry => ({ ...entry, ...rows.find(row => row.id === entry.id) }))
    assert.doesNotThrow(() => validateMinimalContext(composed))
    assert.throws(() => validateMinimalContext(entries), /runtime_minimal_context_unsafe/)
  })
  it('disables working-directory regardless of its deployment entry id and rejects re-enabling it', () => {
    const entries = [{ id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'renamed-cwd-owner', name: '@deepseek-ai/dsh-working-directory' }]
    const rows = minimalContextRows(entries)
    assert.deepEqual(rows.find(row => row.id === 'renamed-cwd-owner'), { id: 'renamed-cwd-owner', disabled: true })
    const composed = entries.map(entry => ({ ...entry, ...rows.find(row => row.id === entry.id) }))
    assert.doesNotThrow(() => validateMinimalContext(composed))
    assert.throws(() => validateMinimalContext(composed.map(entry => entry.id === 'renamed-cwd-owner' ? { ...entry, disabled: false } : entry)), /runtime_minimal_context_unsafe/)
  })
  it('fails closed without the official prompt owner', () => assert.throws(() => minimalContextRows([]), /runtime_minimal_context_unsupported/))
  it('sanitizes the final real SystemPrompt/WorkingDirectory/Cordis assembly and rendered prompt', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SystemPrompt, renderPrompt, renderContextSnapshot } = await import('@deepseek-ai/dsh-system-prompt')
    const { WorkingDirectoryService } = await import('@deepseek-ai/dsh-working-directory')
    const minimal = await import(`data:text/javascript,${encodeURIComponent(MINIMAL_CONTEXT_PLUGIN)}`)
    const ctx = new Context()
    const privateCwd = '/private/isolated-minimal-workspace'
    ctx.provide('fs', { resolve: async (path: string) => path, stat: async () => ({ type: 'directory' }) })
    ctx.provide('sessionProjections', { register() {}, stateOf: () => privateCwd })
    const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
    const context = { agent: { session: { header: { cwd: privateCwd } }, ctx: { fiber: { assertActive() {} } } } }
    try {
      new WorkingDirectoryService(ctx, { defaultDirectory: privateCwd })
      // This is a real required context and a real prepend middleware, not a
      // mock next(): suppression alone retains it in the final service result.
      assert.match(renderContextSnapshot(await prompt.assemble(context)), /isolated-minimal-workspace/)
      prompt.section({ name: 'private-section', order: 0, text: 'PRIVATE SECTION' })
      prompt.context({ name: 'private-context', order: 0, required: true, text: 'PRIVATE CONTEXT' })
      minimal.apply(ctx)
      const assembly = await prompt.assemble(context)
      assert.equal(renderPrompt(assembly), 'Respond only to the supplied user context. No tools or external actions are available.')
      assert.equal(renderContextSnapshot(assembly), '')
      assert.deepEqual(assembly.contexts, [])
      assert.deepEqual(assembly.tools, [])
      assert.deepEqual(assembly.variables, {})
      assert(!JSON.stringify(assembly).includes(privateCwd))
      assert(!JSON.stringify(assembly).includes('PRIVATE'))
      prompt.tools(() => ({ schemas: [{ name: 'unexpected', description: 'must not reach the model', parameters: { type: 'object' } }] }))
      await assert.rejects(prompt.assemble(context), /Minimal context cannot expose tools/)
    } finally { await ctx.fiber.dispose() }
  })
  it('keeps both registration orders safe when the disabled working-directory owner is applied to real services', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SystemPrompt, renderContextSnapshot } = await import('@deepseek-ai/dsh-system-prompt')
    const { WorkingDirectoryService } = await import('@deepseek-ai/dsh-working-directory')
    const minimal = await import(`data:text/javascript,${encodeURIComponent(MINIMAL_CONTEXT_PLUGIN)}`)
    const entries = [{ id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'cwd', name: '@deepseek-ai/dsh-working-directory' }]
    const rows = minimalContextRows(entries)
    for (const guardFirst of [true, false]) {
      const ctx = new Context()
      const prompt = new SystemPrompt(ctx, rows.find(row => row.id === 'prompt')!.config)
      const installDirectory = () => {
        if (rows.find(row => row.id === 'cwd')?.disabled !== true) new WorkingDirectoryService(ctx, { defaultDirectory: '/private/SHOULD-NOT-LOAD' })
      }
      try {
        if (guardFirst) minimal.apply(ctx)
        installDirectory()
        if (!guardFirst) minimal.apply(ctx)
        assert.equal(ctx.get('workingDirectory'), undefined)
        const assembly = await prompt.assemble()
        assert.equal(renderContextSnapshot(assembly), '')
        assert.deepEqual(assembly.contexts, [])
        assert.deepEqual(assembly.tools, [])
        assert(!JSON.stringify(assembly).includes('SHOULD-NOT-LOAD'))
      } finally { await ctx.fiber.dispose() }
    }
  })
  it('strips actual shared/context assembly and denies unadvertised tools', async () => {
    type Hook = (...args: unknown[]) => unknown
    const hooks = new Map<string, Hook>()
    const module = await import(`data:text/javascript,${encodeURIComponent(MINIMAL_CONTEXT_PLUGIN)}`)
    module.apply({ on: (name: string, fn: Hook) => hooks.set(name, fn) })
    const assemble = hooks.get('system-prompt/assemble')!
    const result = await assemble({}, {}, async () => ({ sections: [{ text: 'SHARED SECRET' }], contexts: [{ name: 'required', text: 'WORKSPACE SECRET' }], tools: [], variables: { secret: 'SECRET' } }))
    assert(!JSON.stringify(result).includes('SECRET'))
    await assert.rejects(Promise.resolve().then(() => assemble({}, {}, async () => ({ tools: [{ name: 'unexpected' }] }))), /cannot expose tools/)
    assert.throws(() => hooks.get('tools/pre-execute')!(), /cannot execute tools/)
  })
})
