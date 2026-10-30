import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  PLUGIN_RUNTIME_RUNNER_FILES,
  clearPluginRuntimeRunner,
  relativeModuleImports,
  resolvePluginRuntimeFiles,
  stagePluginRuntimeRunner
} from './plugin-runtime-runner-staging.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceDirectory = join(repositoryRoot, 'packages/plugin-sdk/src')

test('the installed-plugin runner and its transitive imports are staged next to the bundled Host', async () => {
  // The real source tree, not a fixture: this is the check that would have caught a
  // packaged plugin child dying with ERR_MODULE_NOT_FOUND for a third file.
  const files = await resolvePluginRuntimeFiles(sourceDirectory)
  assert.ok(files.includes('process-extension-runner.mjs'))
  assert.ok(files.includes('dsh-storage-root.mjs'))
  assert.ok(files.includes('plugin-package-identity.mjs'), 'the chain runner -> storage-root -> identity must be staged')

  for (const file of files) {
    for (const specifier of relativeModuleImports(await readFile(join(sourceDirectory, file), 'utf8'))) {
      const imported = specifier.replace(/^\.\//, '')
      assert.ok(files.includes(imported), `${file} imports ${specifier}, so it has to be staged too`)
    }
  }

  const root = await mkdtemp(join(tmpdir(), 'sciforge-plugin-runtime-'))
  try {
    // A repository-shaped fixture: the runner chain is copied for real from source.
    await mkdir(join(root, 'packages/plugin-sdk/src'), { recursive: true })
    for (const file of files) {
      await writeFile(join(root, 'packages/plugin-sdk/src', file), await readFile(join(sourceDirectory, file)))
    }
    const staged = await stagePluginRuntimeRunner({ repositoryRoot: root, mainOutputDirectory: join(root, 'out/main') })
    assert.deepEqual([...staged], files)
    for (const file of files) {
      assert.equal(existsSync(join(root, 'out/main', file)), true, `${file} must be staged next to the Host bundle`)
    }
    await clearPluginRuntimeRunner({ mainOutputDirectory: join(root, 'out/main') })
    for (const file of PLUGIN_RUNTIME_RUNNER_FILES) {
      assert.equal(existsSync(join(root, 'out/main', file)), false, `${file} must be removable`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a dangling relative import fails the build instead of shipping a broken runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-plugin-runtime-dangling-'))
  try {
    await mkdir(join(root, 'packages/plugin-sdk/src'), { recursive: true })
    await writeFile(join(root, 'packages/plugin-sdk/src/process-extension-runner.mjs'),
      "import './not-in-the-tree.mjs'\n")
    await assert.rejects(
      stagePluginRuntimeRunner({ repositoryRoot: root, mainOutputDirectory: join(root, 'out/main') }),
      /Plugin runtime file is missing/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('staging fails loudly when the entry file is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-plugin-runtime-missing-'))
  try {
    await mkdir(join(root, 'packages/plugin-sdk/src'), { recursive: true })
    await assert.rejects(
      stagePluginRuntimeRunner({ repositoryRoot: root, mainOutputDirectory: join(root, 'out/main') }),
      /Plugin runtime file is missing/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('relativeModuleImports reads static, dynamic and bare forms without following packages', () => {
  const source = [
    "import { a } from './a.mjs'",
    "export { b } from './b.mjs'",
    "const c = await import('./c.mjs')",
    "import './side-effect.mjs'",
    "import { d } from '@deepseek-ai/dsh-tools'",
    "import { e } from '../outside.mjs'",
    "// import { f } from './commented-out.mjs'"
  ].join('\n')
  // '../outside.mjs' is not a sibling and '@deepseek-ai/...' is a package: neither is staged.
  assert.deepEqual(relativeModuleImports(source).sort(), ['./a.mjs', './b.mjs', './c.mjs', './side-effect.mjs'])
})