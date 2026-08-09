import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const sourceRoot = resolve(projectRoot, 'src')
const packagesRoot = resolve(projectRoot, 'packages')
const knownModuleRoots = [
  'src/main/modules',
  'src/main/services/workspace-preview',
  'src/renderer/src/workspace-preview'
] as const
const ownerDirectoryNames = new Set(['app-contributions', 'domain-modules'])
const privateWorkerSourceImportPattern = /['"][^'"]*packages\/workers\/[^/'"]+\/src(?:\/[^'"]*)?['"]/
const generatedDomainCompositionPaths = new Set([
  'src/shared/installed-domain-packages.ts',
  'src/main/modules/installed-domain-main.ts',
  'src/renderer/src/domain-modules/installed-domain-renderer.ts',
  'packages/workers/workspace-host/src/generated/installed-domain-workspace-server.ts'
])
const dagDomainPackages = [
  {
    directory: 'evidence-dag',
    packageName: '@sciforge/domain-evidence-dag',
    moduleId: 'sciforge.evidence-dag',
    directTransportPrefix: 'evidenceDag:',
    contributionKinds: {
      main: [
        'main.capability-factory',
        'main.runtime-lifecycle',
        'main.artifact-consumer'
      ],
      renderer: ['renderer.workbench-right-panel', 'renderer.i18n-resource']
    }
  },
  {
    directory: 'project-dag',
    packageName: '@sciforge/domain-project-dag',
    moduleId: 'sciforge.project-dag',
    directTransportPrefix: 'projectDag:',
    contributionKinds: {
      main: [
        'main.capability-factory',
        'main.runtime-lifecycle',
        'main.artifact-consumer'
      ],
      renderer: ['renderer.workbench-right-panel', 'renderer.i18n-resource']
    }
  }
] as const
const forbiddenDagHostApiSymbols = [
  'getEvidenceDagView',
  'updateEvidenceDag',
  'setEvidenceDagPriority',
  'resolveEvidenceDagEvidencePreview',
  'evidenceDagViewPayloadSchema',
  'evidenceDagUpdatePayloadSchema',
  'evidenceDagPriorityPayloadSchema',
  'evidenceDagEvidencePreviewResolvePayloadSchema',
  'ensureEvidenceDagSidecar',
  'stopEvidenceDagSidecar',
  'configureEvidenceDagUpdateQueue',
  'syncEvidenceDagUpdateQueue',
  'enqueueEvidenceDagUpdate',
  'ensureEvidenceDagFresh',
  'evidenceDagQueueStatus',
  'prioritizeEvidenceDagUpdate',
  'acknowledgeEvidenceDagSnapshot',
  'getProjectDagView',
  'updateProjectDag',
  'saveProjectDagGoal',
  'resolveProjectDagEvidencePreview',
  'projectDagViewPayloadSchema',
  'projectDagUpdatePayloadSchema',
  'projectDagGoalSavePayloadSchema',
  'projectDagEvidencePreviewResolvePayloadSchema',
  'ensureProjectDagSidecar',
  'stopProjectDagSidecar'
] as const
const forbiddenDagWorkbenchPattern =
  /(?:EvidenceDag|ProjectDag|evidenceDag|projectDag|['"](?:evidence|project-dag)['"])/u
const importSpecifierPattern =
  /(?:\bfrom\s*|\b(?:import|tsImport)\s*\()\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/gu

function sourceFiles(root: string): string[] {
  const absoluteRoot = resolve(projectRoot, root)
  if (!existsSync(absoluteRoot)) return []
  return readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absoluteRoot, entry.name)
    if (entry.isDirectory()) return sourceFiles(projectRelative(path))
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(entry.name))
      ? [path]
      : []
  })
}

function projectRelative(path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}

function isTestSource(path: string): boolean {
  return /(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u
    .test(projectRelative(path))
}

function productionSourceFiles(...roots: string[]): string[] {
  return roots.flatMap(sourceFiles).filter((path) => !isTestSource(path))
}

function importSpecifiers(source: string): string[] {
  importSpecifierPattern.lastIndex = 0
  return [...source.matchAll(importSpecifierPattern)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => typeof value === 'string')
}

function isWithin(path: string, root: string): boolean {
  const candidate = relative(root, path)
  return candidate === '' || (!candidate.startsWith('..') && !candidate.startsWith('/'))
}

function directoriesNamed(root: string, names: ReadonlySet<string>): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const path = join(root, entry.name)
    if (names.has(entry.name)) return [path]
    return directoriesNamed(path, names)
  })
}

function filesNamed(root: string, name: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return filesNamed(path, name)
    return entry.name === name ? [path] : []
  })
}

function migratedModuleSourceFiles(): string[] {
  const discoveredOwnerRoots = directoriesNamed(sourceRoot, ownerDirectoryNames)
  const installedDomainRoots = filesNamed(packagesRoot, 'sciforge.domain.json').map(dirname)
  const workerServices = sourceFiles('src/main/services').filter((path) =>
    /worker-service\.tsx?$/u.test(path)
  )
  return [...new Set([
    ...knownModuleRoots.flatMap(sourceFiles),
    ...discoveredOwnerRoots.flatMap((root) => sourceFiles(projectRelative(root))),
    ...installedDomainRoots.flatMap((root) => sourceFiles(projectRelative(root))),
    ...workerServices
  ])].sort()
}

describe('domain module boundaries', () => {
  it('discovers owner roots, worker service adapters, and installed domain packages', () => {
    const relativeFiles = migratedModuleSourceFiles().map(projectRelative)

    expect(relativeFiles).toEqual(expect.arrayContaining([
      'src/main/capabilities/app-contributions/composition.ts',
      'packages/domains/paper-radar/src/main.ts',
      'src/main/services/write-assist-worker-service.ts',
      'src/renderer/src/domain-modules/renderer-slot-registry.ts'
    ]))
  })

  it('recognizes private worker package root and deep source imports', () => {
    expect(privateWorkerSourceImportPattern.test(
      "from '../../../packages/workers/paper-radar/src'"
    )).toBe(true)
    expect(privateWorkerSourceImportPattern.test(
      "from '../../../packages/workers/write-assist/src/service'"
    )).toBe(true)
    expect(privateWorkerSourceImportPattern.test(
      "from '@sciforge/paper-radar/service'"
    )).toBe(false)
  })

  it('consumes worker packages through public exports', () => {
    const privateImports = migratedModuleSourceFiles().flatMap((path) =>
      readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line, index) =>
        privateWorkerSourceImportPattern.test(line)
          ? [`${projectRelative(path)}:${index + 1}`]
          : []
      )
    )

    expect(privateImports).toEqual([])
  })

  it('keeps repository scripts on installed domain package public exports', () => {
    const domainSourceRoots = filesNamed(packagesRoot, 'sciforge.domain.json')
      .map((manifestPath) => resolve(dirname(manifestPath), 'src'))
    const violations = productionSourceFiles('scripts').flatMap((path) =>
      importSpecifiers(readFileSync(path, 'utf8')).flatMap((specifier) => {
        if (/^@sciforge\/domain-[^/]+\/src(?:\/|$)/u.test(specifier)) {
          return [`${projectRelative(path)} -> ${specifier}`]
        }
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) return []
        const importedPath = resolve(dirname(path), specifier)
        return domainSourceRoots.some((root) => isWithin(importedPath, root))
          ? [`${projectRelative(path)} -> ${specifier}`]
          : []
      })
    )

    expect(violations).toEqual([])
  })

  it('keeps renderer domain modules off main-process and domain-specific bridge paths', () => {
    const rendererFiles = migratedModuleSourceFiles().filter((path) =>
      projectRelative(path).startsWith('src/renderer/') &&
      !path.includes('.test.')
    )
    const violations = rendererFiles.flatMap((path) =>
      readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line, index) =>
        /(?:from\s+['"][^'"]*\/main\/|window\.sciforge(?:\?\.)?\.paperRadar)/.test(line)
          ? [`${projectRelative(path)}:${index + 1}`]
          : []
      )
    )

    expect(violations).toEqual([])
  })

  it('loads only pure definitions from shared and only process-local package entrypoints', () => {
    const sharedInstallation = readFileSync(
      resolve(projectRoot, 'src/shared/installed-domain-packages.ts'),
      'utf8'
    )
    const mainInstallation = readFileSync(
      resolve(projectRoot, 'src/main/modules/installed-domain-main.ts'),
      'utf8'
    )
    const rendererInstallation = readFileSync(
      resolve(projectRoot, 'src/renderer/src/domain-modules/installed-domain-renderer.ts'),
      'utf8'
    )
    const workspaceServerInstallation = readFileSync(
      resolve(
        projectRoot,
        'packages/workers/workspace-host/src/generated/installed-domain-workspace-server.ts'
      ),
      'utf8'
    )

    const generatedHeader = 'Generated by scripts/domain-packages.mjs. Do not edit.'
    expect(sharedInstallation).toContain(generatedHeader)
    expect(mainInstallation).toContain(generatedHeader)
    expect(rendererInstallation).toContain(generatedHeader)
    expect(workspaceServerInstallation).toContain(generatedHeader)
    expect(sharedInstallation)
      .not.toMatch(/@sciforge\/domain-[^'"/]+\/(?:main|renderer|workspace-server)/)
    expect(mainInstallation)
      .not.toMatch(/@sciforge\/domain-[^'"/]+\/(?:renderer|workspace-server)/)
    expect(rendererInstallation)
      .not.toMatch(/@sciforge\/domain-[^'"/]+\/(?:main|workspace-server)/)
    expect(workspaceServerInstallation)
      .not.toMatch(/@sciforge\/domain-[^'"/]+\/(?:main|renderer)/)
    expect(workspaceServerInstallation).not.toMatch(/@shared|@renderer|src\/main|src\/shared/)

    for (const manifestPath of filesNamed(packagesRoot, 'sciforge.domain.json')) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        packageName: string
        entrypoints: Array<{ process: 'main' | 'renderer' | 'workspace-server' }>
      }
      expect(sharedInstallation).toContain(`${manifest.packageName}/definition`)
      expect(mainInstallation.includes(`${manifest.packageName}/main`)).toBe(
        manifest.entrypoints.some(({ process }) => process === 'main')
      )
      expect(rendererInstallation.includes(`${manifest.packageName}/renderer`)).toBe(
        manifest.entrypoints.some(({ process }) => process === 'renderer')
      )
      expect(
        workspaceServerInstallation.includes(`${manifest.packageName}/workspace-server`)
      ).toBe(
        manifest.entrypoints.some(({ process }) => process === 'workspace-server')
      )
    }
  })

  it('keeps migrated domain implementations out of legacy host feature paths', () => {
    const retiredPaths = [
      'src/shared/paper-radar.ts',
      'src/main/services/paper-radar-worker-service.ts',
      'src/main/capabilities/app-contributions/paper-radar-contribution.ts',
      'src/renderer/src/components/paper',
      'src/shared/biology-room.ts',
      'src/main/services/biology-room-service.ts'
    ].map((path) => resolve(projectRoot, path))

    expect(retiredPaths.filter(existsSync)).toEqual([])
  })

  it('forces exact domain subpath imports and keeps package implementations process-local', () => {
    const packageRoots = filesNamed(packagesRoot, 'sciforge.domain.json').map(dirname)
    expect(packageRoots.length).toBeGreaterThan(0)

    for (const packageRoot of packageRoots) {
      const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
        exports: Record<string, string | undefined>
      }
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'sciforge.domain.json'), 'utf8')) as {
        entrypoints: Array<{
          process: 'main' | 'renderer' | 'workspace-server'
          export: string
        }>
      }
      const processSource = (
        process: 'main' | 'renderer' | 'workspace-server'
      ): string => {
        const entrypoint = manifest.entrypoints.find((candidate) => candidate.process === process)
        if (!entrypoint) return ''
        const exportedPath = packageJson.exports[entrypoint.export]
        expect(typeof exportedPath).toBe('string')
        const sourcePath = resolve(packageRoot, (exportedPath as string).replace(/^\.\//u, ''))
        expect(existsSync(sourcePath)).toBe(true)
        return readFileSync(sourcePath, 'utf8')
      }
      const mainSource = processSource('main')
      const rendererSource = processSource('renderer')
      const workspaceServerSource = processSource('workspace-server')

      expect(packageJson.exports['.']).toBeUndefined()
      expect(packageJson.exports['./definition']).toBeDefined()
      for (const entrypoint of manifest.entrypoints) {
        expect(packageJson.exports[entrypoint.export]).toBeDefined()
      }
      expect(mainSource).not.toMatch(/from\s+['"][^'"]*renderer/)
      expect(rendererSource).not.toMatch(/from\s+['"][^'"]*\/main(?:['"/])/)
      expect(rendererSource).not.toMatch(/@shared|@renderer|src\/main|src\/shared/)
      expect(workspaceServerSource)
        .not.toMatch(/@shared|@renderer|src\/main|src\/renderer|src\/shared/)
      expect(workspaceServerSource)
        .not.toMatch(/from\s+['"]@sciforge\/domain-[^'"]+\/(?:main|renderer)(?:['"/])/)
    }
  })

  it('installs Evidence DAG and Project DAG only through manifests and generated composition', () => {
    const generatedSources = Object.fromEntries(
      [...generatedDomainCompositionPaths].map((path) => [
        path,
        readFileSync(resolve(projectRoot, path), 'utf8')
      ])
    )
    const hostProductionFiles = productionSourceFiles(
      'src/main',
      'src/renderer/src',
      'src/shared',
      'src/preload'
    )

    for (const domain of dagDomainPackages) {
      const packageRoot = resolve(packagesRoot, 'domains', domain.directory)
      const manifestPath = join(packageRoot, 'sciforge.domain.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        packageName: string
        module: { id: string }
        entrypoints: Array<{
          process: 'main' | 'renderer'
          export: string
          contributions: Array<{ id: string; kind: string }>
        }>
      }
      const entrypoint = (process: 'main' | 'renderer') =>
        manifest.entrypoints.find((candidate) => candidate.process === process)

      expect(manifest.packageName).toBe(domain.packageName)
      expect(manifest.module.id).toBe(domain.moduleId)
      expect(entrypoint('main')?.export).toBe('./main')
      expect(entrypoint('renderer')?.export).toBe('./renderer')
      expect(entrypoint('main')?.contributions.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining([...domain.contributionKinds.main])
      )
      expect(entrypoint('renderer')?.contributions.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining([...domain.contributionKinds.renderer])
      )

      expect(generatedSources['src/shared/installed-domain-packages.ts'])
        .toContain(`${domain.packageName}/definition`)
      expect(generatedSources['src/main/modules/installed-domain-main.ts'])
        .toContain(`${domain.packageName}/main`)
      expect(generatedSources['src/renderer/src/domain-modules/installed-domain-renderer.ts'])
        .toContain(`${domain.packageName}/renderer`)

      const reservedRegistrationIds = [
        domain.packageName,
        domain.moduleId,
        domain.directory.replaceAll('-', '_'),
        ...manifest.entrypoints.flatMap(({ contributions }) =>
          contributions.map(({ id }) => id)
        )
      ]
      const hardCodedHostRegistrations = hostProductionFiles.flatMap((path) => {
        const relativePath = projectRelative(path)
        if (generatedDomainCompositionPaths.has(relativePath)) return []
        const source = readFileSync(path, 'utf8')
        return reservedRegistrationIds.some((id) => source.includes(id))
          ? [relativePath]
          : []
      })
      expect(hardCodedHostRegistrations).toEqual([])
    }
  })

  it('keeps every domain package implementation off host-private and cross-process imports', () => {
    const hostPrivateRoots = [
      resolve(projectRoot, 'src/main'),
      resolve(projectRoot, 'src/renderer'),
      resolve(projectRoot, 'src/shared')
    ]

    for (const packageRoot of filesNamed(packagesRoot, 'sciforge.domain.json').map(dirname)) {
      const packageFiles = productionSourceFiles(projectRelative(join(packageRoot, 'src')))
      const violations = packageFiles.flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return importSpecifiers(source).flatMap((specifier) => {
          if (/^(?:@shared|@renderer|@main)(?:\/|$)/u.test(specifier)) {
            return [`${projectRelative(path)} -> ${specifier}`]
          }
          if (/^(?:src\/(?:main|renderer|shared))(?:\/|$)/u.test(specifier) ||
            /@sciforge\/sciforge\/src\/(?:main|renderer|shared)(?:\/|$)/u.test(specifier)) {
            return [`${projectRelative(path)} -> ${specifier}`]
          }
          if (!specifier.startsWith('.') && !specifier.startsWith('/')) return []
          const importedPath = resolve(dirname(path), specifier)
          if (hostPrivateRoots.some((root) => isWithin(importedPath, root))) {
            return [`${projectRelative(path)} -> ${specifier}`]
          }
          const relativePackagePath = relative(packageRoot, path)
          if (relativePackagePath.startsWith('src/main') &&
            isWithin(importedPath, resolve(packageRoot, 'src/renderer'))) {
            return [`${projectRelative(path)} -> ${specifier}`]
          }
          if (relativePackagePath.startsWith('src/renderer') &&
            isWithin(importedPath, resolve(packageRoot, 'src/main'))) {
            return [`${projectRelative(path)} -> ${specifier}`]
          }
          return []
        })
      })

      expect(violations).toEqual([])
    }
  })

  it('keeps the runtime installer on public SDK contracts and out of extension execution', () => {
    const installerFiles = productionSourceFiles('src/main/extensions')
    expect(installerFiles.length).toBeGreaterThan(0)

    const sdkPackageName = '@sciforge/domain-sdk'
    const sdkPackage = JSON.parse(
      readFileSync(resolve(packagesRoot, 'domain-sdk/package.json'), 'utf8')
    ) as { exports: Record<string, unknown> }
    const publicSdkSpecifiers = new Set(Object.keys(sdkPackage.exports).map((subpath) =>
      subpath === '.' ? sdkPackageName : `${sdkPackageName}/${subpath.replace(/^\.\//u, '')}`
    ))
    const violations = installerFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const relativePath = projectRelative(path)
      const importViolations = importSpecifiers(source).flatMap((specifier) => {
        if (
          specifier === sdkPackageName ||
          specifier.startsWith(`${sdkPackageName}/`)
        ) {
          return publicSdkSpecifiers.has(specifier)
            ? []
            : [`${relativePath} -> non-public SDK import ${specifier}`]
        }
        if (/^@sciforge\/domain-(?!sdk(?:\/|$))/u.test(specifier)) {
          return [`${relativePath} -> runtime domain import ${specifier}`]
        }
        if (/(?:^|\/)src\/renderer(?:\/|$)|^@renderer(?:\/|$)/u.test(specifier)) {
          return [`${relativePath} -> privileged renderer import ${specifier}`]
        }
        return []
      })
      const codeLoadingViolations =
        /\b(?:import|require)\s*\(/u.test(source) ||
        /\b(?:createRequire|runInNewContext|runInThisContext|SourceTextModule)\b/u.test(source)
          ? [`${relativePath} -> dynamic code loading`]
          : []
      return [...importViolations, ...codeLoadingViolations]
    })

    expect(violations).toEqual([])
  })

  it('declares legacy DAG transport prefixes as broker-migrated with no exceptions', () => {
    for (const domain of dagDomainPackages) {
      const packageRoot = resolve(packagesRoot, 'domains', domain.directory)
      const source = productionSourceFiles(projectRelative(join(packageRoot, 'src')))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')

      expect(
        source.includes('directTransportPrefixes'),
        `${domain.directory} must publish a capability-governance transport policy`
      ).toBe(true)
      expect(
        source.includes(domain.directTransportPrefix),
        `${domain.directory} must declare ${domain.directTransportPrefix} as a retired direct transport`
      ).toBe(true)
      expect(
        /allowedDirectTransports\s*:\s*(?:readonly\s*)?\[\]/u.test(source),
        `${domain.directory} must not allow a direct DAG transport exception`
      ).toBe(true)
    }
  })

  it('routes legacy DAG transports through capability governance with no host DAG IPC', () => {
    const hostProductionFiles = productionSourceFiles(
      'src/main',
      'src/renderer/src',
      'src/shared',
      'src/preload'
    )
    const violations = hostProductionFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const lines = source.split(/\r?\n/u)
      return lines.flatMap((line, index) => {
        const directTransport = dagDomainPackages.some(({ directTransportPrefix }) =>
          line.includes(`'${directTransportPrefix}`) ||
          line.includes(`"${directTransportPrefix}`) ||
          line.includes(`\`${directTransportPrefix}`)
        )
        const directWorkerDesktopImport =
          /packages\/workers\/(?:evidence-dag|project-dag)\/desktop(?:\/|['"])/u.test(line)
        const retiredApi = forbiddenDagHostApiSymbols.some((symbol) => line.includes(symbol))
        return directTransport || directWorkerDesktopImport || retiredApi
          ? [`${projectRelative(path)}:${index + 1}`]
          : []
      })
    })

    expect(violations).toEqual([])
  })

  it('keeps Evidence and Project DAG branches out of the host Workbench', () => {
    const workbenchPaths = [
      'src/renderer/src/components/Workbench.tsx',
      'src/renderer/src/components/chat/WorkbenchTopBar.tsx',
      'src/renderer/src/components/session-right-panel-workspaces.ts',
      'src/renderer/src/components/workbench-layout.ts'
    ]
    const violations = workbenchPaths.flatMap((path) => {
      const absolutePath = resolve(projectRoot, path)
      if (!existsSync(absolutePath)) return []
      return readFileSync(absolutePath, 'utf8').split(/\r?\n/u).flatMap((line, index) =>
        forbiddenDagWorkbenchPattern.test(line) ? [`${path}:${index + 1}`] : []
      )
    })

    expect(violations).toEqual([])
  })

  it('removes retired DAG host modules and worker desktop entrypoints', () => {
    const retiredHostPaths = [
      'src/main/runtime/evidence-dag-feed.ts',
      'src/main/runtime/evidence-artifact-lifecycle.ts',
      'src/main/services/evidence-dag-evidence-preview.ts',
      'src/main/services/project-dag-evidence-preview.ts',
      'src/main/services/trusted-evidence-preview.ts',
      'src/renderer/src/components/dag-progressive-view.tsx',
      'src/renderer/src/components/evidence',
      'src/renderer/src/components/project-dag',
      'src/renderer/src/lib/project-dag-setup.ts',
      'src/shared/evidence-dag-gate.ts'
    ].map((path) => resolve(projectRoot, path))
    expect(retiredHostPaths.filter(existsSync)).toEqual([])

    for (const domain of dagDomainPackages) {
      const workerRoot = resolve(packagesRoot, 'workers', domain.directory)
      if (!existsSync(workerRoot)) continue
      const desktopEntrypoints = [
        join(workerRoot, 'desktop'),
        join(workerRoot, 'src', 'desktop.ts'),
        join(workerRoot, 'src', 'desktop.tsx'),
        join(workerRoot, 'src', 'main.ts'),
        join(workerRoot, 'src', 'renderer.ts'),
        join(workerRoot, 'src', 'renderer.tsx')
      ]
      expect(desktopEntrypoints.filter(existsSync)).toEqual([])

      const packageJson = JSON.parse(readFileSync(join(workerRoot, 'package.json'), 'utf8')) as {
        exports?: Record<string, unknown>
        main?: unknown
        browser?: unknown
      }
      expect(packageJson.main).toBeUndefined()
      expect(packageJson.browser).toBeUndefined()
      expect(Object.keys(packageJson.exports ?? {}).filter((name) =>
        /(?:desktop|main|renderer)/u.test(name)
      )).toEqual([])
    }
  })

  it('keeps in-app Paper Radar agents off the retired domain MCP business path', () => {
    const retiredMainFiles = [
      ['paper', 'radar', 'mcp', 'config.ts'].join('-'),
      ['paper', 'radar', 'mcp', 'server.ts'].join('-'),
      ['paper', 'radar', 'mcp', 'node', 'entry.ts'].join('-')
    ].map((name) => resolve(projectRoot, 'src/main', name))
    expect(retiredMainFiles.filter(existsSync)).toEqual([])

    const sources = [
      'src/main/index.ts',
      'src/main/gui-mcp-registry.ts',
      'electron.vite.config.ts',
      'scripts/release-worker-manifest.cjs'
    ].map((path) => readFileSync(resolve(projectRoot, path), 'utf8'))
    const retiredServerId = ['gui', 'paper', 'radar'].join('_')
    const retiredNodeEntry = ['paper', 'radar', 'mcp', 'node', 'entry'].join('-')
    expect(sources.some((source) => source.includes(retiredServerId))).toBe(false)
    expect(sources.some((source) => source.includes(retiredNodeEntry))).toBe(false)

    const workerRoot = resolve(projectRoot, 'packages/workers/paper-radar')
    const retiredWorkerFiles = [
      ['mcp', 'server.ts'].join('-'),
      ['mcp', 'server.test.ts'].join('-'),
      'cli.ts',
      'write-action.ts',
      'write-safety.ts'
    ].map((name) => join(workerRoot, 'src', name))
    expect(retiredWorkerFiles.filter(existsSync)).toEqual([])

    const workerPackage = JSON.parse(readFileSync(join(workerRoot, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>
      exports: Record<string, string>
      scripts: Record<string, string>
      sciforge?: { mcpServer?: boolean }
    }
    expect(workerPackage.bin).toBeUndefined()
    expect(workerPackage.exports).not.toHaveProperty('./mcp-server')
    expect(workerPackage.scripts).not.toHaveProperty('start')
    expect(workerPackage.sciforge?.mcpServer).toBe(false)

    const workerSources = sourceFiles(projectRelative(join(workerRoot, 'src')))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const retiredToolPrefix = ['gui', 'paper'].join('_')
    const retiredPackageProtocol = ['paper', 'radar', 'mcp'].join('-')
    expect(workerSources).not.toContain(retiredToolPrefix)
    expect(workerSources).not.toContain(retiredPackageProtocol)

    const workerServiceContract = [
      'packages/workers/paper-radar/src/contract.ts',
      'packages/workers/paper-radar/src/service.ts'
    ].map((path) => readFileSync(resolve(projectRoot, path), 'utf8')).join('\n')
    const domainMainSource = readFileSync(
      resolve(projectRoot, 'packages/domains/paper-radar/src/main.ts'),
      'utf8'
    )
    const retiredConfirmationFields = ['confirmed', 'confirmation_id', 'dry_run']
    for (const field of retiredConfirmationFields) {
      expect(workerServiceContract).not.toContain(field)
      expect(domainMainSource).not.toContain(field)
    }
  })
})
