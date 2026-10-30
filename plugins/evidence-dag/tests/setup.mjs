import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export default async function setup() {
  const release = await mkdtemp(join(tmpdir(), 'evidence-suite-release-'))
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url)), release], {
      env: process.env, stdio: 'pipe', windowsHide: true
    })
    const artifacts = JSON.parse(await readFile(join(release, 'artifacts.json'), 'utf8'))
    process.env.EVIDENCE_TEST_RELEASE = release
    process.env.EVIDENCE_TEST_WHEEL = join(release, artifacts.wheel.file)
  } catch (error) {
    await rm(release, { recursive: true, force: true })
    throw error
  }
  return async () => {
    delete process.env.EVIDENCE_TEST_RELEASE
    delete process.env.EVIDENCE_TEST_WHEEL
    await rm(release, { recursive: true, force: true })
  }
}
