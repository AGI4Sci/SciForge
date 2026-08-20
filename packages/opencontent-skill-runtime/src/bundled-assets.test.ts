import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR,
  assertOpenContentSkillBundledAssetsPresent,
  resolveOpenContentSkillBundledAssetPaths
} from './bundled-assets.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('OpenContent bundled assets', () => {
  it('resolves every fixed CommonJS runtime file inside an explicit private asset root', () => {
    const fixture = createAssetFixture()
    try {
      const paths = assertOpenContentSkillBundledAssetsPresent({
        mode: 'source',
        assetRoot: fixture.assetRoot
      })
      const canonicalRoot = `${realpathSync(paths.root)}/`
      for (const runtimeFile of [
        paths.cliEntrypoint,
        paths.docflowEntrypoint,
        paths.docflowProbeHelper,
        paths.cliSingleAttemptPatch
      ]) {
        expect(`${realpathSync(runtimeFile)}`.startsWith(canonicalRoot)).toBe(true)
        expect(statSync(runtimeFile).mode & 0o111).toBe(0)
      }
      expect(OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.moduleFormat).toBe('commonjs')
      expect(OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.docflowProbeHelperRelativePath)
        .toBe('scripts/docflow-probe-compact.cjs')
      expect(OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.cliSingleAttemptPatchRelativePath)
        .toBe('runtime-patches/cli-auth-retry-single-attempt.v1.json')
    } finally {
      fixture.dispose()
    }
  })

  it('keeps the publishable runtime package free of the supplied attachment', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      private?: unknown
      license?: unknown
      files?: string[]
      sciforgeInternal?: unknown
    }
    expect(packageJson).toMatchObject({ private: false, license: 'MIT' })
    expect(packageJson.files).not.toContain('assets')
    expect(packageJson.sciforgeInternal).toBeUndefined()
  })

  it('resolves packaged paths and rejects relative roots', () => {
    const resourcesPath = resolve(packageRoot, '.packaged-resources')
    const paths = resolveOpenContentSkillBundledAssetPaths({
      mode: 'packaged',
      resourcesPath
    })
    expect(paths.root).toBe(resolve(
      resourcesPath,
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath
    ))
    expect(() => resolveOpenContentSkillBundledAssetPaths({
      mode: 'packaged',
      resourcesPath: 'relative/resources'
    })).toThrow()
    expect(() => resolveOpenContentSkillBundledAssetPaths({
      mode: 'source',
      assetRoot: 'relative/assets'
    })).toThrow()
  })

  it('fails closed when packaged assets are absent', () => {
    expect(() => assertOpenContentSkillBundledAssetsPresent({
      mode: 'packaged',
      resourcesPath: resolve(packageRoot, '.missing-packaged-resources')
    })).toThrow('Bundled OpenContent assets are unavailable or invalid.')
  })

  it('admits a complete packaged copy and fails closed when its helper is absent', () => {
    const fixture = createAssetFixture()
    const resourcesPath = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-assets-'))
    try {
      const packagedRoot = resolve(
        resourcesPath,
        OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath
      )
      mkdirSync(dirname(packagedRoot), { recursive: true })
      cpSync(fixture.assetRoot, packagedRoot, { recursive: true })
      const packagedPaths = assertOpenContentSkillBundledAssetsPresent({
        mode: 'packaged',
        resourcesPath
      })
      const canonicalRoot = `${realpathSync(packagedPaths.root)}/`
      expect(realpathSync(packagedPaths.cliEntrypoint).startsWith(canonicalRoot)).toBe(true)
      expect(realpathSync(packagedPaths.docflowEntrypoint).startsWith(canonicalRoot)).toBe(true)
      expect(realpathSync(packagedPaths.docflowProbeHelper).startsWith(canonicalRoot)).toBe(true)
      expect(realpathSync(packagedPaths.cliSingleAttemptPatch).startsWith(canonicalRoot)).toBe(true)
      expect(relative(packagedPaths.root, packagedPaths.cliEntrypoint)).toBe('cli/bin/oc.js')

      rmSync(packagedPaths.docflowProbeHelper)
      expect(() => assertOpenContentSkillBundledAssetsPresent({
        mode: 'packaged',
        resourcesPath
      })).toThrow('Bundled OpenContent assets are unavailable or invalid.')

      writeFileSync(packagedPaths.docflowProbeHelper, 'module.exports = {}\n')
      rmSync(packagedPaths.cliSingleAttemptPatch)
      expect(() => assertOpenContentSkillBundledAssetsPresent({
        mode: 'packaged',
        resourcesPath
      })).toThrow('Bundled OpenContent assets are unavailable or invalid.')
    } finally {
      fixture.dispose()
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })
})

function createAssetFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-source-assets-'))
  const assetRoot = resolve(root, 'opencontent-base-1.0.1')
  for (const relativePath of [
    'cli/bin/oc.js',
    'cli/docflow/docflow-node.cjs',
    'scripts/docflow-probe-compact.cjs',
    'runtime-patches/cli-auth-retry-single-attempt.v1.json'
  ]) {
    const target = resolve(assetRoot, ...relativePath.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, relativePath.endsWith('.json') ? '{}\n' : 'module.exports = {}\n', {
      mode: 0o644
    })
  }
  return {
    assetRoot,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}
