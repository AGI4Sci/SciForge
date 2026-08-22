import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  OPENCONTENT_CLI_ADMITTED_COMMANDS,
  OPENCONTENT_CLI_COMMANDS
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import {
  materializeVerifiedOpenContentRuntimeSnapshot,
  readVerifiedOpenContentRuntimeSnapshot
} from '../packages/opencontent-skill-runtime/src/verified-runtime-snapshot.internal.ts'

import {
  parseOpenContentPackagedSmokeCli,
  resolvePackagedResourcesPath,
  runOpenContentPackagedRuntimeCallabilitySmoke,
  runOpenContentCliInventorySmoke
} from './opencontent-runtime-callability-smoke.mjs'

test('resolves an explicit packaged acceptance target without a build hook', () => {
  assert.deepEqual(
    parseOpenContentPackagedSmokeCli([
      '--repository-root', '/workspace/sciforge',
      '--dist-dir', '/workspace/sciforge/fresh-dist',
      '--executable', '/workspace/sciforge/fresh-dist/SciForge'
    ]),
    {
      repositoryRoot: '/workspace/sciforge',
      distDirectory: '/workspace/sciforge/fresh-dist',
      executablePath: '/workspace/sciforge/fresh-dist/SciForge'
    }
  )
  assert.equal(
    resolvePackagedResourcesPath('/Applications/SciForge.app/Contents/MacOS/SciForge', 'darwin'),
    '/Applications/SciForge.app/Contents/Resources'
  )
  assert.equal(
    resolvePackagedResourcesPath('/opt/SciForge/sciforge', 'linux'),
    '/opt/SciForge/resources'
  )
})

test('executes verified private-copy bytes without passing provider credentials', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-callability-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'source')
  const privateRoot = join(root, 'private')
  const entrypoint = join(sourceRoot, 'cli/bin/oc.js')
  await writeRuntimeFiles(sourceRoot, fixtureCli(OPENCONTENT_CLI_COMMANDS))
  const trustedRuntimeFiles = await fixtureRuntimeIntegrity(sourceRoot)
  const verifiedSnapshot = await readVerifiedOpenContentRuntimeSnapshot({
    root: sourceRoot,
    trustedRuntimeFiles
  })
  await writeFile(entrypoint, 'throw new Error("unverified source executed")\n', 'utf8')
  const privateRuntime = await materializeVerifiedOpenContentRuntimeSnapshot({
    destinationRoot: privateRoot,
    snapshot: verifiedSnapshot
  })

  const result = await runOpenContentCliInventorySmoke({
    executablePath: process.execPath,
    entrypoint: privateRuntime.entrypoint,
    electronRunAsNode: false,
    expectedVersion: '1.0.0',
    expectedCommands: OPENCONTENT_CLI_COMMANDS,
    admittedCommands: OPENCONTENT_CLI_ADMITTED_COMMANDS
  })

  assert.deepEqual(result, {
    cliVersion: '1.0.0',
    snapshotCommandCount: 86,
    admittedCommandCount: 61
  })
  await assert.rejects(readVerifiedOpenContentRuntimeSnapshot({
    root: sourceRoot,
    trustedRuntimeFiles
  }))
})

test('does not expose the parent environment to the attachment CLI', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-callability-env-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const entrypoint = join(root, 'cli/bin/oc.js')
  await mkdir(dirname(entrypoint), { recursive: true })
  await writeFile(
    entrypoint,
    `
if (process.env.SCIFORGE_CALLABILITY_SMOKE_SENTINEL) {
  process.stderr.write('parent environment leaked')
  process.exit(9)
}
${fixtureCli(OPENCONTENT_CLI_COMMANDS)}
`,
    'utf8'
  )
  process.env.SCIFORGE_CALLABILITY_SMOKE_SENTINEL = 'not-a-secret'
  context.after(() => {
    delete process.env.SCIFORGE_CALLABILITY_SMOKE_SENTINEL
  })

  await assert.doesNotReject(runOpenContentCliInventorySmoke({
    executablePath: process.execPath,
    entrypoint,
    electronRunAsNode: false,
    expectedVersion: '1.0.0',
    expectedCommands: OPENCONTENT_CLI_COMMANDS,
    admittedCommands: OPENCONTENT_CLI_ADMITTED_COMMANDS
  }))
})

test('sanitizes attachment CLI failure diagnostics', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-callability-failure-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const entrypoint = join(root, 'cli/bin/oc.js')
  await mkdir(dirname(entrypoint), { recursive: true })
  await writeFile(
    entrypoint,
    "process.stderr.write('fixture-sensitive-diagnostic'); process.exit(9)\n",
    'utf8'
  )

  await assert.rejects(
    runOpenContentCliInventorySmoke({
      executablePath: process.execPath,
      entrypoint,
      electronRunAsNode: false,
      expectedVersion: '1.0.0',
      expectedCommands: OPENCONTENT_CLI_COMMANDS,
      admittedCommands: OPENCONTENT_CLI_ADMITTED_COMMANDS
    }),
    (error) => {
      assert.equal(error.message, 'The packaged OpenContent CLI --version check failed.')
      assert.doesNotMatch(error.message, /fixture-sensitive-diagnostic/u)
      return true
    }
  )
})

test('does not admit a caller-supplied packaging composition or execute forged bytes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-opencontent-packaged-callability-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const repositoryRoot = join(root, 'repository')
  const resourcesPath = join(root, 'resources')
  const assetRoot = join(resourcesPath, 'opencontent/opencontent-base-1.0.1')
  const entrypoint = join(assetRoot, 'cli/bin/oc.js')
  await writeRuntimeFiles(assetRoot, fixtureCli(OPENCONTENT_CLI_COMMANDS))
  const executionMarker = join(root, 'forged-runtime-executed')
  await writeFile(
    entrypoint,
    `require('node:fs').writeFileSync(${JSON.stringify(executionMarker)}, 'executed')\n`,
    'utf8'
  )
  await assert.rejects(
    runOpenContentPackagedRuntimeCallabilitySmoke({
      repositoryRoot,
      resourcesPath,
      executablePath: process.execPath,
      internalRuntimePackaging: {
        createInternalRuntimeComposition() {
          throw new Error('caller-supplied packaging must not be used')
        },
        verifyPackagedInternalRuntimes() {
          throw new Error('caller-supplied verifier must not be used')
        }
      }
    }),
    { message: 'The packaged OpenContent acceptance requires exactly one installed runtime.' }
  )
  await assert.rejects(readFile(executionMarker, 'utf8'), { code: 'ENOENT' })
})

function fixtureCli(commands) {
  const help = [
    'OpenContent CLI v1.0.0',
    '',
    '可用命令:',
    ...commands.map((command) => `  ${command}  fixture command`),
    '',
    '原生 API 透传:'
  ].join('\n')
  return `
if (process.argv.includes('--version')) process.stdout.write('1.0.0\\n')
else if (process.argv.includes('--help')) process.stdout.write(${JSON.stringify(help)} + '\\n')
else process.exitCode = 2
`
}

async function writeRuntimeFiles(assetRoot, cliSource) {
  const files = new Map([
    ['package.json', '{}\n'],
    ['cli/bin/oc.js', cliSource],
    ['cli/docflow/docflow-node.cjs', 'module.exports = {}\n'],
    ['scripts/docflow-probe-compact.cjs', 'module.exports = {}\n'],
    ['runtime-patches/cli-auth-retry-single-attempt.v1.json', '{}\n']
  ])
  for (const [relativePath, contents] of files) {
    const target = join(assetRoot, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
}

async function fixtureRuntimeIntegrity(assetRoot) {
  const roles = new Map([
    ['package.json', 'package-manifest'],
    ['cli/bin/oc.js', 'cli-entrypoint'],
    ['cli/docflow/docflow-node.cjs', 'docflow-entrypoint'],
    ['scripts/docflow-probe-compact.cjs', 'docflow-probe-helper'],
    ['runtime-patches/cli-auth-retry-single-attempt.v1.json', 'cli-single-attempt-patch']
  ])
  return Promise.all([...roles].map(async ([relativePath, role]) => {
    const bytes = await readFile(join(assetRoot, ...relativePath.split('/')))
    return {
      role,
      relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength
    }
  }))
}
