import { DshRuntimeError } from './transport.js'

// Cordis waterfalls unwind from the innermost handler. Prepend makes this
// sanitizer outermost among existing handlers. Also disable working-directory
// below: a later-registered prepend handler would otherwise reinsert its required
// cwd context after this sanitizer returns.
export const MINIMAL_CONTEXT_PLUGIN = `
export const inject = ['systemPrompt']
export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    if (result.tools.length) throw new Error('Minimal context cannot expose tools')
    return { ...result, sections: [{ name: 'host:minimal', text: 'Respond only to the supplied user context. No tools or external actions are available.' }], contexts: [], tools: [], variables: {} }
  }, { global: true, prepend: true })
  ctx.on('tools/pre-execute', () => { throw new Error('Minimal context cannot execute tools') }, { global: true, prepend: true })
}
`
export const MINIMAL_PERSONA = 'Respond only to the supplied user context. No workspace, shared instructions, tools, or external actions are available.'
const disabled = /^(?:@deepseek-ai\/dsh-(?:agent-instructions|agent-preset|working-directory|harness-dev-context|time-context|tmux-context|session-reference|tool-.+|skill.*|mcp.*))$/
/** Build from the admitted deployment, never from a package-specific entry id. */
export function minimalContextRows(entries: { id?: unknown; name?: unknown; disabled?: unknown; config?: { includeHarnessIdentity?: unknown; includeRuntimeContext?: unknown; personaPrefix?: unknown; personaSuffix?: unknown } }[]): Record<string, unknown>[] {
  const prompt = entries.find(entry => entry.name === '@deepseek-ai/dsh-system-prompt')
  if (!prompt || typeof prompt.id !== 'string') throw new DshRuntimeError('runtime_minimal_context_unsupported')
  return [...entries.filter(entry => typeof entry.name === 'string' && disabled.test(entry.name)).map(entry => ({ id: entry.id, disabled: true })),
    { id: prompt.id, config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: MINIMAL_PERSONA, personaSuffix: '' } }]
}
export function validateMinimalContext(entries: { id?: unknown; name?: unknown; disabled?: unknown; config?: { includeHarnessIdentity?: unknown; includeRuntimeContext?: unknown; personaPrefix?: unknown; personaSuffix?: unknown } }[]): void {
  const prompt = entries.find(entry => entry.name === '@deepseek-ai/dsh-system-prompt')
  if (!prompt || prompt.disabled === true || prompt.config?.includeHarnessIdentity !== false || prompt.config?.includeRuntimeContext !== false || prompt.config?.personaPrefix !== MINIMAL_PERSONA || prompt.config?.personaSuffix !== '' || entries.some(entry => typeof entry.name === 'string' && disabled.test(entry.name) && entry.disabled !== true)) {
    throw new DshRuntimeError('runtime_minimal_context_unsafe')
  }
}
