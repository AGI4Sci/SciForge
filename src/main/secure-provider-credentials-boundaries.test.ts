import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(process.cwd())
const sourceRoots = ['src', 'packages/domains', 'packages/domain-sdk/src']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function productionSources(): ReadonlyArray<Readonly<{ path: string; source: string }>> {
  return sourceRoots.flatMap((root) => walk(resolve(projectRoot, root)))
    .filter((path) => sourceExtensions.has(extname(path)))
    .filter((path) => !/\.(?:test|spec)\.[^.]+$/u.test(path))
    .filter((path) => !/\.test-helper\.[^.]+$/u.test(path))
    .map((path) => ({
      path: relative(projectRoot, path).replaceAll('\\', '/'),
      source: readFileSync(path, 'utf8')
    }))
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return entry.isFile() ? [path] : []
  })
}

describe('secure provider credential architecture', () => {
  it('keeps the platform backend and storage root behind one canonical Host file', () => {
    const sources = productionSources()
    const platformUsers = sources
      .filter(({ source }) => /\bsafeStorage\b/u.test(source))
      .map(({ path }) => path)
    expect(platformUsers).toEqual([
      'src/main/domain-package-storage.ts',
      'src/main/index.ts'
    ])

    const providerStorageRoots = sources.flatMap(({ path, source }) => (
      /['"]domain-package-storage['"]|['"]secrets\.enc\.json['"]/u.test(source)
        ? [path]
        : []
    ))
    expect(providerStorageRoots).toEqual(['src/main/domain-package-storage.ts'])
  })

  it('does not expose provider credential access to renderer, Agent, or provider IPC', () => {
    const forbidden = productionSources().filter(({ path, source }) => {
      const untrustedSurface = path.startsWith('src/renderer/') ||
        path.startsWith('src/preload/') ||
        path.includes('/agent/') ||
        path.includes('/agent-runtime/')
      return untrustedSurface && /providerCredentials|DomainMainProviderCredential/u.test(source)
    })
    expect(forbidden.map(({ path }) => path)).toEqual([])

    const providerIpc = productionSources().filter(({ source }) => (
      /providerCredentials|DomainMainProviderCredential/u.test(source) &&
      /ipcMain|ipcRenderer|contextBridge/u.test(source)
    ))
    expect(providerIpc.map(({ path }) => path)).toEqual([])
  })

  it('limits Host provider credential access to the canonical Host and Connector main paths', () => {
    const users = productionSources()
      .filter(({ source }) => /providerCredentials|DomainMainProviderCredential/u.test(source))
      .map(({ path }) => path)
    expect(users).toEqual([
      'src/main/domain-package-storage.ts',
      'src/main/provider-credential-acceptance.ts',
      'packages/domain-sdk/src/package-storage.ts'
    ])
  })

  it('keeps Collaboration outside every Host secret lifecycle', () => {
    const collaboration = productionSources()
      .filter(({ path }) => path.startsWith('packages/domains/collaboration/src/'))
      .map(({ source }) => source)
      .join('\n')
    expect(collaboration).not.toContain('packageSecrets')
    expect(collaboration).not.toContain('providerCredentials')
    expect(collaboration).not.toContain('safeStorage')
  })

  it('keeps Tokens out of query strings and out of public URL and serialization surfaces', () => {
    const sources = productionSources()
    const queryTokenUsers = sources
      .filter(({ source }) => /query:\s*\{[^}]*\btoken\b/su.test(source))
      .map(({ path }) => path)
    // The one historical exception (the OpenContent Connector client) retired with
    // its package; no production source may put a Token in a query string now.
    expect(queryTokenUsers).toEqual([])

    const forbiddenSurfaceUsers = sources.filter(({ path, source }) => {
      const forbiddenSurface = path.startsWith('src/preload/') ||
        path.startsWith('src/renderer/') ||
        path.includes('/agent-runtime/') ||
        path.includes('/portable-resource') ||
        path.includes('/workspace-host')
      return forbiddenSurface && (
        /openContentAuthenticatedSession|providerCredentials/u.test(source) ||
        /query:\s*\{[^}]*\btoken\b/su.test(source)
      )
    })
    expect(forbiddenSurfaceUsers.map(({ path }) => path)).toEqual([])
  })
})
