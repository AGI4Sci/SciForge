import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir, chmod, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as trusted from '../src/index.ts'
import { prepareDeployment } from '../src/deployment.ts'
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const config = JSON.stringify([
  { id: 'acp', name: '@deepseek-ai/dsh-acp', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
  { id: 'approval', name: '@deepseek-ai/dsh-user-approval', config: { policy: 'ask' } },
  { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel', disabled: true }
]) + '\n'
async function setup() {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-trust-'))
  const artifactDirectory = join(root, 'artifact'); await mkdir(artifactDirectory)
  const executable = join(artifactDirectory, 'dsh')
  const script = `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(join(root, 'executed'))}, 'run\\n'); process.stdout.write(process.argv.includes('--version') ? '0.2.0-rc.2\\n' : ${JSON.stringify(config)});\n`
  await writeFile(executable, script); await chmod(executable, 0o700)
  const pin = { version: '0.2.0-rc.2' as const, sourceCommit: '639ed015397290b3745d163aafe02ffee4aa3f84', files: { dsh: sha(script) }, configDigest: sha(config), entryIds: ['acp', 'approval', 'session-telemetry-otel'], pluginNames: ['@deepseek-ai/dsh-acp', '@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-session-telemetry-otel'] }
  const policy = () => trusted.createPinnedDshDeployment({ artifactDirectory, executable, pin })
  return { root, artifactDirectory, executable, script, pin, policy, cleanup: () => rm(root, { recursive: true, force: true }) }
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
    const options = { executable: s.executable, stateDirectory: join(s.root, 'state'), ...policy }
    await writeFile(s.executable, s.script + '// tamper\n')
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
test('no pin, missing artifact, symlink, wrong version and forged digest fail closed', async () => {
  const s = await setup()
  try {
    await assert.rejects(trusted.createPinnedDshDeployment({ artifactDirectory: s.artifactDirectory, executable: s.executable }).verifyExecutable(), /runtime_deployment_pin_missing/)
    await rm(s.executable)
    await assert.rejects(s.policy().verifyExecutable(), /runtime_deployment_artifact_unapproved/)
    await writeFile(join(s.root, 'foreign'), s.script); await symlink(join(s.root, 'foreign'), s.executable)
    await assert.rejects(s.policy().verifyExecutable(), /runtime_deployment_artifact_unapproved/)
    await assert.rejects(s.policy().verifyDeployment({ version: '0.3.0', executable: s.executable, composedConfig: config, configDigest: sha(config) }), /runtime_deployment_config_unapproved/)
    await assert.rejects(s.policy().verifyDeployment({ version: '0.2.0-rc.2', executable: s.executable, composedConfig: config + ' ', configDigest: sha(config) }), /runtime_deployment_config_unapproved/)
  } finally { await s.cleanup() }
})
