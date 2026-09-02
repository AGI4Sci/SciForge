import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowSource = await readFile(
  new URL('../.github/workflows/collaboration-ci.yml', import.meta.url),
  'utf8'
)
const packageJson = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8'
))
const vitestConfigSource = await readFile(
  new URL('../vitest.config.ts', import.meta.url),
  'utf8'
)
const deploymentGuideSource = await readFile(
  new URL('../docs/operations/zulip-aliyun-deployment.zh-CN.md', import.meta.url),
  'utf8'
)

function workflowEventSource(eventName) {
  const startMarker = `  ${eventName}:\n`
  const start = workflowSource.indexOf(startMarker)
  assert.notEqual(start, -1, `${eventName} trigger must exist`)
  const endMarker = eventName === 'pull_request' ? '  push:\n' : '\npermissions:\n'
  const end = workflowSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `${eventName} trigger must be bounded`)
  return workflowSource.slice(start, end)
}

test('routes every domain package and the Host Content Space integration into CI', () => {
  for (const eventName of ['pull_request', 'push']) {
    const source = workflowEventSource(eventName)
    assert.match(source, /^\s+- "packages\/domains\/\*\*"$/m)
    assert.match(
      source,
      /^\s+- "src\/main\/capabilities\/content-space-discovery\.test\.ts"$/m
    )
  }
})

test('runs the full regression suite and every installed domain package through pretest', () => {
  assert.match(workflowSource, /^\s+run: npm test$/m)
  assert.match(workflowSource, /^\s+run: npm run typecheck$/m)
  assert.match(packageJson.scripts.pretest, /npm run domain-packages:test/)
  assert.match(
    packageJson.scripts['domain-packages:test'],
    /domain-packages\.mjs --run test/
  )
  assert.match(
    packageJson.scripts.typecheck,
    /npm run domain-packages:typecheck/
  )
  assert.equal(
    packageJson.scripts['domain-packages:typecheck'],
    'node ./scripts/domain-packages.mjs --run typecheck'
  )
})

test('sizes root Vitest workers to the available runner capacity', () => {
  assert.equal(packageJson.scripts.test, 'vitest run')
  assert.match(vitestConfigSource, /availableParallelism/u)
  assert.match(vitestConfigSource, /maxWorkers/u)
})

test('enforces architecture and both canonical Electron application paths', () => {
  assert.match(workflowSource, /^\s+run: npm run architecture-principles:test$/m)
  assert.match(workflowSource, /^\s+run: npm run smoke:electron:source$/m)
  assert.match(workflowSource, /^\s+run: npm run smoke:electron:packaged:build$/m)
  assert.match(
    workflowSource,
    /- name: Verify packaged Electron application path\n\s+if: matrix\.platform == 'macOS'\n\s+env:\n\s+NODE_OPTIONS: "--max-old-space-size=6144"/u
  )
  assert.equal(packageJson.scripts['smoke:electron:source'] !== undefined, true)
  assert.equal(packageJson.scripts['smoke:electron:packaged:build'] !== undefined, true)
})

test('runs the Host Content Space Broker integration and this routing contract', () => {
  assert.match(
    workflowSource,
    /^\s+src\/main\/capabilities\/content-space-discovery\.test\.ts \\$/m
  )
  assert.match(
    workflowSource,
    /^\s+run: node --test scripts\/collaboration-ci\.test\.mjs$/m
  )
})

test('builds the Desktop Agent vault path on Linux, macOS, and Windows', () => {
  assert.match(workflowSource, /^ {2}desktop-agent-platform-contract:$/m)
  for (const [platform, runner] of [
    ['Linux', 'ubuntu-latest'],
    ['macOS', 'macos-latest'],
    ['Windows', 'windows-latest']
  ]) {
    assert.match(
      workflowSource,
      new RegExp(`^ {10}- platform: ${platform}\\n {12}os: ${runner}$`, 'm')
    )
  }
  assert.match(
    workflowSource,
    /^ {10}npm --workspace @sciforge\/domain-identity-access test$/m
  )
  assert.match(
    workflowSource,
    /^ {10}npx vitest run src\/main\/domain-package-storage\.test\.ts$/m
  )
  assert.match(workflowSource, /^ {8}run: npm run build$/m)
})

test('does not retain the parallel collaboration identity Token package', async () => {
  assert.equal(
    packageJson.workspaces.includes('packages/collaboration-identity'),
    false
  )
  assert.equal(
    Object.hasOwn(packageJson.dependencies, '@sciforge/collaboration-identity'),
    false
  )
  assert.doesNotMatch(
    packageJson.scripts['build:collaboration-dependencies'],
    /collaboration-identity/u
  )
  assert.doesNotMatch(workflowSource, /collaboration-identity/u)
  await assert.rejects(
    access(new URL('../packages/collaboration-identity', import.meta.url)),
    { code: 'ENOENT' }
  )
})

test('does not retain the retired Collaboration migration service entrypoint', async () => {
  assert.doesNotMatch(workflowSource, /sciforge-collaboration-migrate\.service/u)
  assert.doesNotMatch(deploymentGuideSource, /sciforge-collaboration-migrate\.service/u)
  await assert.rejects(
    access(new URL(
      '../packages/collaboration-server/deploy/sciforge-collaboration-migrate.service',
      import.meta.url
    )),
    { code: 'ENOENT' }
  )
})
