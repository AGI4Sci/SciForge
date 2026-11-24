/** Host-owned composition plugin using DSH's public permission preset service.
 * `agent/created` is awaited after restored session state and before ACP returns,
 * so resumed sessions cannot retain a different persisted filesystem policy. */
export const DSH_PERMISSION_POLICY_PLUGIN = `
import { writeFileSync } from 'node:fs'
export const inject = ['permissionPresets', 'sandboxPolicy']
export function apply(ctx, config) {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(config.preset)) {
    throw new Error('Invalid Host permission preset')
  }
  const specification = ctx.permissionPresets.resolve(config.preset)
  if (specification?.sandbox !== config.preset) {
    throw new Error('Host permission preset has an unexpected sandbox mapping')
  }
  ctx.on('tools/pre-execute', (exec, next) => {
    if (ctx.sandboxPolicy.resolve({ session: exec.agent.session }).mode !== config.preset) {
      throw new Error('Host effective sandbox policy changed before tool execution')
    }
    return next()
  }, { global: true, prepend: true })
  ctx.on('agent/created', ({ agent }) => {
    ctx.permissionPresets.set(agent.session, config.preset)
    if (ctx.permissionPresets.current(agent.session) !== config.preset) {
      throw new Error('Host permission preset was not applied')
    }
    if (ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== config.preset) {
      throw new Error('Host effective sandbox policy does not match permission preset')
    }
    if (config.ackPath) writeFileSync(config.ackPath, JSON.stringify({ sessionId: agent.session.id, preset: config.preset }), { mode: 0o600 })
  }, { global: true })
}
`
