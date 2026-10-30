import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDshRuntimeVersion } from './dsh-plugin-host-runtime'

describe('resolveDshRuntimeVersion', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  // 注：默认 resolver（import.meta.resolve）的"真包解析"正向路径不在
  // vitest 下断言——vite-node 的解析器在 package.json 子路径上与 Node
  // 解析器行为分歧（生产为 Electron 主进程真实 Node，已另行验证可用）。
  // 下方经注入 resolver 的用例覆盖全部逻辑路径。

  it('returns the version from a resolvable manifest', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-runtime-manifest-'))
    const manifestPath = join(tempDir, 'package.json')
    await writeFile(manifestPath, JSON.stringify({ version: '0.2.0-rc.2' }), 'utf8')
    await expect(resolveDshRuntimeVersion(() => pathToFileURL(manifestPath).href)).resolves.toBe('0.2.0-rc.2')
  })

  it('returns undefined when the manifest is not resolvable (fail-closed)', async () => {
    await expect(resolveDshRuntimeVersion(() => undefined)).resolves.toBeUndefined()
  })

  it('returns undefined when the resolver throws (fail-closed)', async () => {
    await expect(
      resolveDshRuntimeVersion(() => {
        throw new Error('not found')
      })
    ).resolves.toBeUndefined()
  })

  it('returns undefined when the manifest has no string version field', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-runtime-manifest-'))
    const manifestPath = join(tempDir, 'package.json')
    await writeFile(manifestPath, JSON.stringify({ name: '@deepseek-ai/dsh-tools' }), 'utf8')
    await expect(resolveDshRuntimeVersion(() => pathToFileURL(manifestPath).href)).resolves.toBeUndefined()
  })

  it('trims the resolved version string', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-runtime-manifest-'))
    const manifestPath = join(tempDir, 'package.json')
    await writeFile(manifestPath, JSON.stringify({ version: ' 0.2.0-rc.2 ' }), 'utf8')
    await expect(resolveDshRuntimeVersion(() => pathToFileURL(manifestPath).href)).resolves.toBe('0.2.0-rc.2')
  })
})
