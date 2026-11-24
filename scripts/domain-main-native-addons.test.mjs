import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { stageDomainMainNativeAddons } from './domain-main-native-addons.mjs'

test('stages a domain-declared native addon into the generated main bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-main-native-addon-'))
  const packageRoot = join(root, 'packages', 'domains', 'identity-fixture')
  const sourceRelativePath = 'src/main/private-vault/native/build/Release/identity.node'
  const bundleRelativePath = 'native/build/Release/identity.node'
  try {
    await mkdir(join(packageRoot, 'src/main/private-vault/native/build/Release'), {
      recursive: true
    })
    await writeFile(join(packageRoot, sourceRelativePath), 'native-fixture')
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@sciforge/domain-identity-fixture',
      sciforgeMainNativeAddons: {
        contractVersion: 1,
        artifacts: [{
          platforms: ['darwin'],
          sourceRelativePath,
          bundleRelativePath
        }]
      }
    }))

    const staged = await stageDomainMainNativeAddons({
      repositoryRoot: root,
      mainOutputDirectory: join(root, 'out', 'main'),
      platform: 'darwin'
    })

    assert.deepEqual(staged, [{
      packageName: '@sciforge/domain-identity-fixture',
      bundleRelativePath
    }])
    assert.equal(
      await readFile(join(root, 'out', 'main', bundleRelativePath), 'utf8'),
      'native-fixture'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Identity declares its private vault as a main-bundle native addon', async () => {
  const packageJson = JSON.parse(await readFile(new URL(
    '../packages/domains/identity-access/package.json',
    import.meta.url
  ), 'utf8'))
  assert.deepEqual(packageJson.sciforgeMainNativeAddons, {
    contractVersion: 1,
    artifacts: [{
      platforms: ['darwin'],
      sourceRelativePath:
        'src/main/private-vault/native/build/Release/identity_private_vault.node',
      bundleRelativePath: 'native/build/Release/identity_private_vault.node'
    }]
  })
})

test('reports only strict license archives, never silently skips empty or partial packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-main-native-addon-'))
  const archived = join(root, 'packages', 'domains', 'archive')
  try {
    await mkdir(archived, {recursive:true})
    await writeFile(join(archived, 'LICENSE'), 'Synthetic attribution text')
    const skipped = []
    const input = {repositoryRoot:root, mainOutputDirectory:join(root,'out/main'), platform:'darwin', onSkipPackageDirectory:name=>skipped.push(name)}
    assert.deepEqual(await stageDomainMainNativeAddons(input), [])
    assert.deepEqual(skipped, ['archive'])
    await writeFile(join(archived,'runtime.ts'),'export const unexpected = true')
    await assert.rejects(stageDomainMainNativeAddons(input), {code:'ENOENT'})
    await assert.rejects(stageDomainMainNativeAddons({...input,onSkipPackageDirectory:true}), /must be a function/)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('rejects a domain native addon path that escapes its package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-main-native-addon-'))
  const packageRoot = join(root, 'packages', 'domains', 'unsafe-fixture')
  try {
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@sciforge/domain-unsafe-fixture',
      sciforgeMainNativeAddons: {
        contractVersion: 1,
        artifacts: [{
          platforms: ['darwin'],
          sourceRelativePath: '../outside.node',
          bundleRelativePath: 'native/outside.node'
        }]
      }
    }))

    await assert.rejects(
      stageDomainMainNativeAddons({
        repositoryRoot: root,
        mainOutputDirectory: join(root, 'out', 'main'),
        platform: 'darwin'
      }),
      /canonical package-relative POSIX path/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects two domain packages that claim the same main-bundle output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-main-native-addon-'))
  const bundleRelativePath = 'native/build/Release/shared.node'
  try {
    for (const packageDirectory of ['first-fixture', 'second-fixture']) {
      const packageRoot = join(root, 'packages', 'domains', packageDirectory)
      const sourceRelativePath = 'native/source.node'
      await mkdir(join(packageRoot, 'native'), { recursive: true })
      await writeFile(join(packageRoot, sourceRelativePath), packageDirectory)
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
        name: `@sciforge/domain-${packageDirectory}`,
        sciforgeMainNativeAddons: {
          contractVersion: 1,
          artifacts: [{
            platforms: ['darwin'],
            sourceRelativePath,
            bundleRelativePath
          }]
        }
      }))
    }

    await assert.rejects(
      stageDomainMainNativeAddons({
        repositoryRoot: root,
        mainOutputDirectory: join(root, 'out', 'main'),
        platform: 'darwin'
      }),
      /is declared by both @sciforge\/domain-first-fixture and @sciforge\/domain-second-fixture/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
