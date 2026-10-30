/**
 * The child-local ordinary Agent resolver a plugin tool call needs.
 *
 * The plugin runner refuses a tool invocation when the host has not provided one
 * ("Host did not provide a child-local ordinary Agent resolver"), because a tool
 * that wants an agent scope must get one from the host rather than invent it.
 *
 * The module is written into the host's own profile so the same content serves a
 * development run and a packaged build: no build-step resource, no repository
 * path. It exports `resolveAgent({ identity, rootContext })`, which builds a
 * Cordis scope for the ordinary session's agent — the minimal shape the SDK
 * documents, and the same shape the SDK's own host-loading test uses.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const DSH_AGENT_RESOLVER_SOURCE = `import { createScope } from '@deepseek-ai/dsh-scope'

export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`

export type DshAgentResolverModule = Readonly<{ path: string }>

/** Writes (or refreshes) the resolver module inside the host profile. */
export async function ensureDshAgentResolverModule(userDataPath: string): Promise<DshAgentResolverModule> {
  const path = resolve(userDataPath, 'extensions', 'dsh-agent-resolver.mjs')
  await mkdir(dirname(path), { recursive: true })
  const existing = await readFile(path, 'utf8').catch(() => undefined)
  if (existing !== DSH_AGENT_RESOLVER_SOURCE) {
    await writeFile(path, DSH_AGENT_RESOLVER_SOURCE, { mode: 0o600 })
  }
  return Object.freeze({ path })
}