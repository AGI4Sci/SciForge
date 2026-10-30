/**
 * Host-mediated network gate for plugin/extension processes.
 *
 * Node has no native `--permission` flag for network access (confirmed against
 * v22.23.2's `node --help`), so network restriction cannot be enforced the same
 * way as filesystem restriction. Instead, the plugin process is never given the
 * ambient `fetch`/`node:net` directly — it only receives a domain-allow-listed
 * fetch function created here, which the host injects into the plugin's API
 * surface (see `runtime-host.ts`).
 *
 * This performs a REAL `fetch()` for an allowed domain (not a mock) — verified in
 * `eval-cases/spike-plugin-permissions/` against a real local loopback HTTP
 * server (P5/P6 of `汇报_权限治理spike.md`, both passed).
 *
 * Known limitation (documented, not solved here): this only restricts requests
 * that go through this function. A plugin that reaches for `node:net` or a child
 * process directly bypasses it entirely. Closing that gap needs a stronger
 * sandbox (e.g. `node:vm`) and is explicitly out of scope — see the "non-goals"
 * section of `openspec/changes/add-plugin-runtime-isolation/design.md`.
 */

export type PluginFetchResult = Readonly<{
  status: number
  body: string
}>

export type PluginFetchGate = (url: string) => Promise<PluginFetchResult>

export function createPluginFetchGate(allowedDomains: Iterable<string>): PluginFetchGate {
  const allowed = new Set(allowedDomains)
  return async (url: string): Promise<PluginFetchResult> => {
    const hostname = new URL(url).hostname
    if (!allowed.has(hostname)) {
      throw new Error(`domain not allow-listed: ${hostname}`)
    }
    const response = await fetch(url)
    const body = await response.text()
    return { status: response.status, body }
  }
}
