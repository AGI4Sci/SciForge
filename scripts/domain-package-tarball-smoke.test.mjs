import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
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
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const targetPackageDirectories = Object.freeze([
  'packages/domain-sdk',
  'packages/domains/artifact-versions',
  'packages/domains/git-checkpoints',
  'packages/domains/research-checkpoints',
  'packages/domains/research-dossier',
  'packages/domains/visual-review'
])
const localDependencyDirectories = Object.freeze([
  'packages/workers/image-generation',
  'packages/workers/scientific-plotting'
])
const packageDirectories = Object.freeze([
  ...targetPackageDirectories,
  ...localDependencyDirectories
])

const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?)$/u
const packagePrivateSpecifierPattern = /^@sciforge\/[^/]+\/src(?:\/|$)/u

async function sourceFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (entry.isFile() && sourceExtensionPattern.test(entry.name)) files.push(path)
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
  for (const sourceFile of await sourceFiles(join(packageRoot, 'src'))) {
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
        escaped === '..' || escaped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(escaped),
        false,
        `${packageName} packed source escapes its package root: ${specifier}`
      )
    }
  }
}

function publicExportSpecifiers(packageJson) {
  assert.equal(typeof packageJson.exports, 'object', `${packageJson.name} must declare exports`)
  return Object.entries(packageJson.exports).map(([subpath, target]) => {
    assert.equal(typeof target, 'string', `${packageJson.name} ${subpath} must use one explicit export target`)
    return subpath === '.' ? packageJson.name : `${packageJson.name}${subpath.slice(1)}`
  })
}

test('research artifact domains resolve every public export from independent tarballs', {
  timeout: 120_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-domain-tarball-smoke-'))
  try {
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
    for (const relativeDirectory of packageDirectories) {
      const { stdout } = await run(npm, [
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        tarballs
      ], {
        cwd: join(repositoryRoot, relativeDirectory),
        maxBuffer: 4 * 1024 * 1024
      })
      const packed = JSON.parse(stdout)
      assert.equal(packed.length, 1, `Expected one archive for ${relativeDirectory}`)
      archives.push(join(tarballs, packed[0].filename))
    }

    await run(npm, [
      'install',
      '--offline',
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
    for (const relativeDirectory of packageDirectories) {
      const sourcePackage = JSON.parse(await readFile(
        join(repositoryRoot, relativeDirectory, 'package.json'),
        'utf8'
      ))
      const installedRoot = join(installation, 'node_modules', sourcePackage.name)
      assert.equal((await lstat(installedRoot)).isSymbolicLink(), false)
      assert.equal((await realpath(installedRoot)).startsWith(repositoryRoot), false)
      const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
      assert.equal(installedPackage.name, sourcePackage.name)
      assert.equal(installedPackage.version, sourcePackage.version)
      await assertPackedPackageBoundaries(installedRoot, installedPackage.name)
      installedPackages.set(installedPackage.name, {
        packageJson: installedPackage,
        root: installedRoot
      })
    }

    const sdkPackage = installedPackages.get('@sciforge/domain-sdk').packageJson
    const artifact = installedPackages.get('@sciforge/domain-artifact-versions')
    const artifactPackage = artifact.packageJson
    const checkpointPackage = installedPackages.get(
      '@sciforge/domain-research-checkpoints'
    ).packageJson
    const dossierPackage = installedPackages.get('@sciforge/domain-research-dossier').packageJson
    const artifactManifest = JSON.parse(await readFile(
      join(artifact.root, 'sciforge.domain.json'),
      'utf8'
    ))
    assert.equal(sdkPackage.version, '0.2.0')
    assert.equal(artifactPackage.version, '1.1.0')
    assert.equal(artifactManifest.module.version, '1.1.0')
    assert.equal(artifactPackage.dependencies['@sciforge/domain-sdk'], '^0.2.0')
    assert.equal(
      checkpointPackage.dependencies['@sciforge/domain-artifact-versions'],
      '^1.1.0'
    )
    assert.equal(checkpointPackage.dependencies['@sciforge/domain-sdk'], '^0.2.0')
    assert.equal(dossierPackage.exports['./contract'], './src/contract.ts')
    assert.equal(dossierPackage.dependencies.zod, '^4.4.3')

    const publicExports = [...installedPackages.values()].flatMap(({ packageJson }) => (
      publicExportSpecifiers(packageJson)
    ))

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
      const publicExports = ${JSON.stringify(publicExports)}
      for (const specifier of publicExports) {
        const loaded = await import(specifier)
        assert.equal(typeof loaded, 'object', \`Expected module namespace for \${specifier}\`)
      }
    `)
    await run(process.execPath, [
      '--import',
      import.meta.resolve('tsx'),
      '--experimental-loader',
      cssLoader,
      entry
    ], {
      cwd: installation,
      maxBuffer: 4 * 1024 * 1024
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
