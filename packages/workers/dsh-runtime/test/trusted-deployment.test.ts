import { tmpdir } from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, writeFile, rm, mkdir, chmod, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as trusted from '../src/index.ts'
import { prepareDeployment } from '../src/deployment.ts'
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const config = JSON.stringify([
  { id: 'acp', name: '@deepseek-ai/dsh-acp', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
  { id: 'approval', name: '@deepseek-ai/dsh-user-approval', config: { policy: 'ask' } },
  { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel', disabled: true }
]) + '\n'
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trust-'))
  const artifactDirectory = join(root, 'artifact'); await mkdir(artifactDirectory)
  const scriptPath = join(artifactDirectory, 'dsh.mjs')
  const executable = process.platform === 'win32' ? join(artifactDirectory, 'node.exe') : scriptPath
  const source = `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(join(root, 'executed'))}, 'run\\n'); process.stdout.write(process.argv.includes('--version') ? '0.2.0-rc.2\\n' : ${JSON.stringify(config)});\n`
  await writeFile(scriptPath, source); await chmod(scriptPath, 0o700)
  const executableArgs = process.platform === 'win32' ? [scriptPath] : []
  const files: Record<string, string> = { 'dsh.mjs': sha(source) }
  if (process.platform === 'win32') {
    await copyFile(process.execPath, executable)
    files['node.exe'] = sha(await readFile(executable))
  }
  const script = await readFile(executable)
  const pin = { version: '0.2.0-rc.2' as const, sourceCommit: '639ed015397290b3745d163aafe02ffee4aa3f84', files, configDigest: sha(config), entryIds: ['acp', 'approval', 'session-telemetry-otel'], pluginNames: ['@deepseek-ai/dsh-acp', '@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-session-telemetry-otel'] }
  const policy = () => trusted.createPinnedDshDeployment({ artifactDirectory, executable, pin })
  return { root, artifactDirectory, executable, executableArgs, script, pin, policy, cleanup: () => rm(root, { recursive: true, force: true }) }
}
test('trusted artifact and exact allowlisted composition pass; config changes are not silently enrolled', async () => {
  const s = await setup()
  try {
    const policy = s.policy()
    await policy.verifyExecutable()
    await policy.verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, configDigest: sha(config), composedConfig: config })
    const changed = config.replace('deepseek-v4-flash', 'unapproved-model')
    await assert.rejects(policy.verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, configDigest: sha(changed), composedConfig: changed }), /runtime_deployment_config_unapproved/)
    // Even an incorrectly reviewed digest cannot admit undeclared entry/plugin owners.
    s.pin.entryIds = ['acp']
    await assert.rejects(s.policy().verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, configDigest: sha(config), composedConfig: config }), /runtime_deployment_config_unapproved/)
    s.pin.entryIds = ['acp', 'approval', 'session-telemetry-otel']; s.pin.pluginNames = []
    await assert.rejects(s.policy().verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, configDigest: sha(config), composedConfig: config }), /runtime_deployment_config_unapproved/)
  } finally { await s.cleanup() }
})
test('preflight blocks modified artifacts before --version and is retryable after exact restoration', async () => {
  const s = await setup()
  try {
    const policy = s.policy()
    const options = { executable: s.executable, executableArgs: s.executableArgs, stateDirectory: join(s.root, 'state'), ...policy }
    await writeFile(s.executable, Buffer.concat([s.script, Buffer.from('// tamper\n')]))
    await assert.rejects(prepareDeployment(options), /runtime_deployment_artifact_unapproved/)
    await assert.rejects(readFile(join(s.root, 'executed')), { code: 'ENOENT' })
    await writeFile(s.executable, s.script)
    const launch = await prepareDeployment(options)
    await launch.cleanup()
    assert.equal((await readFile(join(s.root, 'executed'), 'utf8')).trim(), 'run\nrun')
    await writeFile(join(s.artifactDirectory, 'extra-plugin.js'), 'export {}')
    await assert.rejects(policy.verifyExecutable(), /runtime_deployment_artifact_unapproved/)
  } finally { await s.cleanup() }
})
test('pinned text-only composition refuses image routes before config dump or ACP boot', async () => {
  const s = await setup()
  try {
    const options = { executable: s.executable, executableArgs: s.executableArgs, stateDirectory: join(s.root, 'state'), ...s.policy(), modelRouter: { baseUrl: 'http://127.0.0.1:4893/v1', apiKey: 'local-fixture', model: 'alias', inputModalities: ['text', 'image'] as const } }
    await assert.rejects(prepareDeployment(options), /runtime_model_image_unapproved/)
    assert.equal((await readFile(join(s.root, 'executed'), 'utf8')).trim(), 'run')
  } finally { await s.cleanup() }
})
test('no pin, missing artifact, wrong version and forged digest fail closed', async () => {
  const s = await setup()
  try {
    await assert.rejects(trusted.createPinnedDshDeployment({ artifactDirectory: s.artifactDirectory, executable: s.executable }).verifyExecutable(), /runtime_deployment_pin_missing/)
    await rm(s.executable)
    await assert.rejects(s.policy().verifyExecutable(), /runtime_deployment_artifact_unapproved/)
    await assert.rejects(s.policy().verifyDeployment({ version: '0.3.0', executable: s.executable, composedConfig: config, configDigest: sha(config) }), /runtime_deployment_config_unapproved/)
    await assert.rejects(s.policy().verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, composedConfig: config + ' ', configDigest: sha(config) }), /runtime_deployment_config_unapproved/)
  } finally { await s.cleanup() }
})

test('symlink executable fails closed', async () => {
  const s = await setup()
  try {
    await rm(s.executable)
    await writeFile(join(s.root, 'foreign'), s.script)
    await symlink(join(s.root, 'foreign'), s.executable)
    await assert.rejects(s.policy().verifyExecutable(), /runtime_deployment_artifact_unapproved/)
  } finally { await s.cleanup() }
})
