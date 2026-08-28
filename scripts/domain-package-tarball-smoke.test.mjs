import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  glob,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  discoverDomainPackages,
  domainPackageNpmInvocation
} from './domain-packages.mjs'

const run = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = domainPackageNpmInvocation()

const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?)$/u
const testSourcePattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u
const packagePrivateSpecifierPattern = /^@sciforge\/[^/]+\/src(?:\/|$)/u

test('tarball coverage follows every publishable domain manifest', async () => {
  const discovered = await discoverDomainPackages(repositoryRoot)
  const expected = discovered
    .filter(({ packageJson }) => packageJson.private !== true)
    .map(({ packageJson }) => packageJson.name)
    .sort()
  const selected = (await discoverTarballPackages(repositoryRoot))
    .filter(({ isDomain }) => isDomain)
    .map(({ packageJson }) => packageJson.name)
    .sort()

  assert.deepEqual(selected, expected)
})

async function discoverWorkspacePackages(root) {
  const rootPackagePath = join(root, 'package.json')
  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'))
  assert.ok(Array.isArray(rootPackage.workspaces), 'Root package.json must declare workspaces')

  const packages = new Map()
  for (const workspace of [...rootPackage.workspaces].sort()) {
    assert.equal(typeof workspace, 'string', 'Every workspace must be a path pattern')
    assert.equal(isAbsolute(workspace), false, `Workspace must be repository-relative: ${workspace}`)
    assert.equal(
      workspace.split(/[\\/]/u).includes('..'),
      false,
      `Workspace must not escape the repository: ${workspace}`
    )
    for await (const manifestPath of glob(`${workspace}/package.json`, { cwd: root })) {
      const packageRoot = resolve(root, dirname(manifestPath))
      const escaped = relative(root, packageRoot)
      assert.equal(
        escaped === '..' ||
          escaped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(escaped),
        false,
        `Workspace package escapes the repository: ${manifestPath}`
      )
      const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      assert.equal(typeof packageJson.name, 'string', `${manifestPath} must declare a package name`)
      assert.equal(
        packages.has(packageJson.name),
        false,
        `Duplicate workspace package: ${packageJson.name}`
      )
      packages.set(packageJson.name, Object.freeze({ packageJson, packageRoot }))
    }
  }
  return packages
}

async function discoverTarballPackages(root) {
  const [domains, workspaces] = await Promise.all([
    discoverDomainPackages(root),
    discoverWorkspacePackages(root)
  ])
  const domainNames = new Set(
    domains
      .filter(({ packageJson }) => packageJson.private !== true)
      .map(({ packageName }) => packageName)
  )
  const domainsByName = new Map(domains.map((domain) => [domain.packageName, domain]))
  assert.ok(domainNames.size > 0, 'At least one publishable domain package is required')

  const selected = new Set()
  const pending = [...domainNames]
  while (pending.length > 0) {
    const packageName = pending.pop()
    if (selected.has(packageName)) continue
    const workspacePackage = workspaces.get(packageName)
    assert.ok(workspacePackage, `Domain dependency is not a declared workspace: ${packageName}`)
    selected.add(packageName)
    const dependencies = workspacePackage.packageJson.dependencies ?? {}
    assert.ok(
      typeof dependencies === 'object' && dependencies !== null && !Array.isArray(dependencies),
      `${packageName} dependencies must be an object`
    )
    for (const dependencyName of Object.keys(dependencies)) {
      if (workspaces.has(dependencyName) && !selected.has(dependencyName)) {
        pending.push(dependencyName)
      }
    }
  }

  return Object.freeze(
    [...selected]
      .map((packageName) => Object.freeze({
        ...workspaces.get(packageName),
        isDomain: domainNames.has(packageName),
        nonNodeExportSpecifiers: Object.freeze(
          (domainsByName.get(packageName)?.definition.entrypoints ?? [])
            .filter(({ process }) => process === 'renderer')
            .map(({ export: subpath }) => publicExportSpecifier(packageName, subpath))
        )
      }))
      .sort((left, right) => left.packageJson.name.localeCompare(right.packageJson.name))
  )
}

function publicExportSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

async function sourceFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (
      entry.isFile() &&
      sourceExtensionPattern.test(entry.name) &&
      !testSourcePattern.test(entry.name)
    ) files.push(path)
  }
  return files
}

function moduleSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

async function assertPackedPackageBoundaries(packageRoot, packageName) {
  let codeRoot = packageRoot
  for (const directory of ['src', 'dist']) {
    const candidate = join(packageRoot, directory)
    try {
      if ((await lstat(candidate)).isDirectory()) {
        codeRoot = candidate
        break
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  for (const sourceFile of await sourceFiles(codeRoot)) {
    const source = await readFile(sourceFile, 'utf8')
    for (const specifier of moduleSpecifiers(source)) {
      assert.doesNotMatch(
        specifier,
        packagePrivateSpecifierPattern,
        `${packageName} packed source imports another package's private src path: ${specifier}`
      )
      if (!specifier.startsWith('.')) continue
      const target = resolve(dirname(sourceFile), specifier)
      const escaped = relative(packageRoot, target)
      assert.equal(
        escaped === '..' ||
          escaped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(escaped),
        false,
        `${packageName} packed source escapes its package root: ${specifier}`
      )
    }
  }
}

async function assertPublicExportTargets(packageRoot, packageJson) {
  assert.equal(typeof packageJson.exports, 'object', `${packageJson.name} must declare exports`)
  const importSpecifiers = []
  const requireSpecifiers = []
  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    const importTarget = typeof target === 'string' ? target : target?.import
    assert.equal(
      typeof importTarget,
      'string',
      `${packageJson.name} ${subpath} must use one explicit import target`
    )
    if (typeof target !== 'string') {
      assert.equal(
        typeof target,
        'object',
        `${packageJson.name} ${subpath} must use an explicit export target`
      )
      assert.notEqual(target, null, `${packageJson.name} ${subpath} must not be null`)
      assert.equal(
        typeof target.import,
        'string',
        `${packageJson.name} ${subpath} must declare one import target`
      )
      if ('types' in target) {
        assert.equal(
          typeof target.types,
          'string',
          `${packageJson.name} ${subpath} types target must be explicit`
        )
      }
    }
    const specifier = publicExportSpecifier(packageJson.name, subpath)
    importSpecifiers.push(specifier)
    if (typeof target !== 'string' && typeof target.require === 'string') {
      requireSpecifiers.push(specifier)
    }
    for (const [condition, exportTarget] of Object.entries(
      typeof target === 'string' ? { import: target } : target
    )) {
      if (condition !== 'import' && condition !== 'require' && condition !== 'types') continue
      assert.equal(
        typeof exportTarget,
        'string',
        `${packageJson.name} ${subpath} ${condition} target must be explicit`
      )
      assert.equal(
        exportTarget.startsWith('./'),
        true,
        `${packageJson.name} ${subpath} ${condition} target must be package-relative`
      )
      const targetPath = resolve(packageRoot, exportTarget)
      const escaped = relative(packageRoot, targetPath)
      assert.equal(
        escaped === '..' ||
          escaped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(escaped),
        false,
        `${packageJson.name} ${subpath} ${condition} target escapes its package root`
      )
      assert.equal(
        (await lstat(targetPath)).isFile(),
        true,
        `${packageJson.name} ${subpath} ${condition} target must be packed as a file`
      )
    }
  }
  return Object.freeze({
    importSpecifiers: Object.freeze(importSpecifiers),
    requireSpecifiers: Object.freeze(requireSpecifiers)
  })
}

test('publishable domain packages resolve every public export from independent tarballs', {
  timeout: 600_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-domain-tarball-smoke-'))
  try {
    const packages = await discoverTarballPackages(repositoryRoot)
    const nonNodeExportSpecifiers = new Set(
      packages.flatMap(({ nonNodeExportSpecifiers: specifiers }) => specifiers)
    )
    const tarballs = join(root, 'tarballs')
    const installation = join(root, 'installation')
    await mkdir(tarballs)
    await mkdir(installation)
    await writeFile(join(installation, 'package.json'), JSON.stringify({
      name: 'sciforge-domain-tarball-smoke',
      private: true,
      type: 'module'
    }))

    const archives = []
    for (const { packageRoot, packageJson } of packages) {
      const { stdout } = await run(npm.command, [...npm.leadingArguments,
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        tarballs
      ], {
        cwd: packageRoot,
        maxBuffer: 4 * 1024 * 1024
      })
      const packed = JSON.parse(stdout)
      assert.equal(packed.length, 1, `Expected one archive for ${packageJson.name}`)
      const deploymentConfiguration = packageJson.sciforgeDeploymentConfiguration
      if (deploymentConfiguration !== undefined) {
        assert.equal(
          typeof deploymentConfiguration.sourceRelativePath,
          'string',
          `${packageJson.name} deployment source path must be declared`
        )
        const packedPaths = new Set(packed[0].files.map(({ path }) => path))
        if (deploymentConfiguration.publicRelease === 'allowed') {
          const absoluteSource = resolve(
            repositoryRoot,
            deploymentConfiguration.sourceRelativePath
          )
          const packageRelativeSource = relative(packageRoot, absoluteSource)
            .split(process.platform === 'win32' ? '\\' : '/')
            .join('/')
          assert.equal(
            packageRelativeSource === '..' || packageRelativeSource.startsWith('../') ||
              isAbsolute(packageRelativeSource),
            false,
            `${packageJson.name} public deployment configuration must be package-owned`
          )
          assert.equal(
            packedPaths.has(packageRelativeSource),
            true,
            `${packageJson.name} tarball must include its public deployment configuration`
          )
        } else {
          assert.equal(
            packedPaths.has(deploymentConfiguration.sourceRelativePath),
            false,
            `${packageJson.name} tarball must exclude its private deployment sidecar`
          )
          assert.equal(
            [...packedPaths].some((path) =>
              path === '.sciforge' || path.startsWith('.sciforge/')),
            false,
            `${packageJson.name} tarball must exclude private deployment directories`
          )
        }
      }
      archives.push(join(tarballs, packed[0].filename))
    }

    await run(npm.command, [...npm.leadingArguments,
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--omit=peer',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      ...archives
    ], {
      cwd: installation,
      maxBuffer: 8 * 1024 * 1024
    })

    const installedPackages = new Map()
    for (const { packageJson: sourcePackage, isDomain } of packages) {
      const installedRoot = join(installation, 'node_modules', sourcePackage.name)
      assert.equal((await lstat(installedRoot)).isSymbolicLink(), false)
      assert.equal((await realpath(installedRoot)).startsWith(repositoryRoot), false)
      const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
      assert.equal(installedPackage.name, sourcePackage.name)
      assert.equal(installedPackage.version, sourcePackage.version)
      await assertPackedPackageBoundaries(installedRoot, installedPackage.name)
      installedPackages.set(installedPackage.name, {
        isDomain,
        packageJson: installedPackage,
        root: installedRoot
      })
      if (isDomain) {
        const installedManifest = JSON.parse(await readFile(
          join(installedRoot, 'sciforge.domain.json'),
          'utf8'
        ))
        assert.equal(installedManifest.packageName, installedPackage.name)
        assert.equal(installedManifest.module.version, installedPackage.version)
      }
    }

    const publicExports = []
    const requireExports = []
    for (const { packageJson, root: installedRoot } of installedPackages.values()) {
      if (packageJson.private === true) continue
      const specifiers = await assertPublicExportTargets(installedRoot, packageJson)
      publicExports.push(...specifiers.importSpecifiers)
      requireExports.push(...specifiers.requireSpecifiers)
    }
    const nodeRuntimeExports = publicExports.filter(
      (specifier) => !nonNodeExportSpecifiers.has(specifier)
    )

    const cssLoader = join(installation, 'css-loader.mjs')
    await writeFile(cssLoader, `
      export async function resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('.css')) {
          return { shortCircuit: true, url: new URL(specifier, context.parentURL).href }
        }
        return nextResolve(specifier, context)
      }
      export async function load(url, context, nextLoad) {
        if (url.endsWith('.css')) {
          return { format: 'module', shortCircuit: true, source: 'export default {}' }
        }
        return nextLoad(url, context)
      }
    `)

    const entry = join(installation, 'smoke.mts')
    await writeFile(entry, `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      const publicExports = ${JSON.stringify(publicExports)}
      const nodeRuntimeExports = ${JSON.stringify(nodeRuntimeExports)}
      const requireExports = ${JSON.stringify(requireExports)}
      for (const specifier of publicExports) {
        const resolved = import.meta.resolve(specifier)
        assert.equal(typeof resolved, 'string', \`Expected resolution for \${specifier}\`)
      }
      for (const specifier of nodeRuntimeExports) {
        const loaded = await import(specifier)
        assert.equal(typeof loaded, 'object', \`Expected module namespace for \${specifier}\`)
      }
      const require = createRequire(import.meta.url)
      for (const specifier of requireExports) {
        const loaded = require(specifier)
        assert.equal(typeof loaded, 'object', \`Expected CommonJS namespace for \${specifier}\`)
      }
    `)
    await run(process.execPath, [
      '--import',
      import.meta.resolve('tsx'),
      '--experimental-loader',
      pathToFileURL(cssLoader).href,
      entry
    ], {
      cwd: installation,
      maxBuffer: 4 * 1024 * 1024
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
