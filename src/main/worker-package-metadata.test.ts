import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type WorkerPackageJson = {
  name?: string
  private?: boolean
  type?: string
  bin?: Record<string, string>
  exports?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
  sciforge?: {
    lifecycleLayer?: string
    runtime?: string
    language?: string
    distribution?: string
    publicContract?: boolean
    runtimeAdapter?: boolean
    mcpServer?: boolean
    publicNpmPackage?: boolean
    sideEffects?: string
  }
}

type RootPackageJson = {
  workspaces?: string[]
  scripts?: Record<string, string>
}

const allowedSideEffects = new Set(['none', 'filesystem', 'network', 'host-ui', 'process'])
const workerRoot = join(process.cwd(), 'packages', 'workers')
const rootPackageJsonPath = join(process.cwd(), 'package.json')
const releaseWorkerManifestPath = join(process.cwd(), 'scripts', 'release-worker-manifest.cjs')
const workspacePreviewWorkerPackages = [
  'workspace-bioimaging',
  'workspace-deck',
  'workspace-molecular',
  'workspace-omics',
  'workspace-sequence',
  'workspace-spectra',
  'workspace-tabular'
] as const

function readWorkerPackageJson(packageDir: string): WorkerPackageJson {
  return JSON.parse(readFileSync(join(workerRoot, packageDir, 'package.json'), 'utf8')) as WorkerPackageJson
}

function readRootPackageJson(): RootPackageJson {
  return JSON.parse(readFileSync(rootPackageJsonPath, 'utf8')) as RootPackageJson
}

function parseSideEffects(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

describe('worker package metadata', () => {
  const workerPackages = readdirSync(workerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  it('keeps worker package.json declarations consistent', () => {
    expect(workerPackages.length).toBeGreaterThan(0)

    for (const packageDir of workerPackages) {
      const metadata = readWorkerPackageJson(packageDir)
      const runtime = metadata.sciforge?.runtime ?? metadata.sciforge?.language ?? 'node'

      expect(metadata.name, packageDir).toMatch(/^@sciforge\/[a-z0-9-]+$/)
      if (runtime === 'python') {
        if (metadata.files) {
          expect(metadata.files, metadata.name).toEqual(expect.arrayContaining(['package.json', 'README.md']))
        }
        expect(metadata.scripts?.start, metadata.name).toContain('python')
      } else {
        expect(metadata.type, metadata.name).toBe('module')
        expect(metadata.exports, metadata.name).toBeDefined()
        expect(metadata.files, metadata.name).toEqual(expect.arrayContaining(['src', 'package.json', 'README.md']))
        if (metadata.sciforge?.mcpServer) {
          expect(metadata.bin, metadata.name).toBeDefined()
          expect(metadata.scripts?.start, metadata.name).toContain('src/cli.ts')
        }
      }

      expect(metadata.sciforge?.lifecycleLayer, metadata.name).toBe('workers')
      expect(typeof metadata.sciforge?.publicContract, metadata.name).toBe('boolean')
      expect(typeof metadata.sciforge?.runtimeAdapter, metadata.name).toBe('boolean')
      expect(typeof metadata.sciforge?.mcpServer, metadata.name).toBe('boolean')
      expect(metadata.sciforge?.sideEffects, metadata.name).toBeTruthy()

      for (const sideEffect of parseSideEffects(metadata.sciforge?.sideEffects ?? '')) {
        expect(allowedSideEffects.has(sideEffect), `${metadata.name} sideEffects includes ${sideEffect}`).toBe(true)
      }
    }
  })

  it('keeps MCP worker public exports on the standard service boundary', () => {
    for (const packageDir of workerPackages) {
      const metadata = readWorkerPackageJson(packageDir)
      if (!metadata.sciforge?.mcpServer) continue
      if ((metadata.sciforge.runtime ?? metadata.sciforge.language) === 'python') continue

      expect(metadata.exports, metadata.name).toEqual(expect.objectContaining({
        '.': './src/index.ts',
        './contract': './src/contract.ts',
        './mcp-server': './src/mcp-server.ts',
        './service': './src/service.ts'
      }))
    }
  })

  it('keeps workspace preview workers integrated without implicit release bundling', () => {
    const rootPackage = readRootPackageJson()
    const bundledWorkerManifestSource = readFileSync(releaseWorkerManifestPath, 'utf8')

    for (const packageDir of workspacePreviewWorkerPackages) {
      const metadata = readWorkerPackageJson(packageDir)
      const workspacePath = `packages/workers/${packageDir}`

      expect(rootPackage.workspaces, metadata.name).toContain(workspacePath)
      expect(rootPackage.scripts?.[`${packageDir}:test`], metadata.name).toBe(
        `npm --workspace ${metadata.name} run test`
      )
      expect(rootPackage.scripts?.[`${packageDir}:typecheck`], metadata.name).toBe(
        `npm --workspace ${metadata.name} run typecheck`
      )
      expect(metadata.exports, metadata.name).toEqual(expect.objectContaining({
        '.': './src/index.ts',
        './contract': './src/contract.ts',
        './engine': `./src/${packageDir}-engine.ts`,
        './service': './src/service.ts'
      }))
      expect(metadata.sciforge?.distribution, metadata.name).toBeUndefined()
      expect(bundledWorkerManifestSource, metadata.name).not.toContain(`dir: '${workspacePath}'`)
    }
  })

  it('keeps Paper Radar core owned by the worker package', () => {
    const metadata = readWorkerPackageJson('paper-radar')

    expect(metadata.name).toBe('@sciforge/paper-radar')
    expect(metadata.sciforge?.publicContract).toBe(true)
    expect(metadata.sciforge?.mcpServer).toBe(true)
    expect(metadata.sciforge?.distribution).toBeUndefined()
  })
})
