/**
 * 市场索引一致性检查（只读，不改 market/index.json）。
 *
 * 严格模式：**没有任何豁免**。已删除插件仍被索引、新插件未被索引，都算失败。
 *
 * 检查项：
 *   1. 索引条目字段完整：name / plugin / version；
 *   2. name 与 plugin 目录名一致（`@sciforge/plugin-<dir>`），目录真实存在；
 *   3. version 与该目录 package.json 的 version 一致；
 *   4. 索引内无重复（同名、同目录各算一次）；
 *   5. plugins/ 下每个插件目录都在索引里（plugins 或 blocked 均可）；
 *   6. 索引里没有指向已删除目录的条目。
 *
 * 用法：node --import tsx scripts/market-consistency.mjs
 * 退出码：0 = 一致；1 = 有差异（明细见输出）
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLUGINS = join(REPO, 'plugins')
const INDEX = join(REPO, 'market', 'index.json')

const index = JSON.parse(await readFile(INDEX, 'utf8'))
const indexed = [...(index.plugins ?? []), ...(index.blocked ?? [])]

const directories = []
for (const entry of await readdir(PLUGINS, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'templates') continue
  try {
    const manifest = JSON.parse(await readFile(join(PLUGINS, entry.name, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string') continue
    directories.push({ directory: entry.name, packageName: manifest.name, version: manifest.version })
  } catch {
    // 不是插件目录
  }
}

const byName = new Map()
const byDirectory = new Map()
const duplicates = []
for (const entry of indexed) {
  if (byName.has(entry.name)) duplicates.push(`duplicate name: ${entry.name}`)
  else byName.set(entry.name, entry)
  const key = entry.plugin ?? '(none)'
  if (byDirectory.has(key)) duplicates.push(`duplicate plugin directory: ${key}`)
  else byDirectory.set(key, entry)
}

const missingFields = indexed
  .filter((entry) => typeof entry.name !== 'string' || typeof entry.plugin !== 'string' || typeof entry.version !== 'string')
  .map((entry) => entry.name ?? '(unnamed)')

const nameDirectoryMismatch = []
const versionMismatch = []
const installedButMissingDirectory = []
for (const entry of indexed) {
  const target = directories.find((candidate) => candidate.directory === entry.plugin)
  if (!target) {
    installedButMissingDirectory.push(`${entry.name} -> plugins/${entry.plugin}`)
    continue
  }
  if (entry.name !== `@sciforge/plugin-${entry.plugin}`) {
    nameDirectoryMismatch.push(`${entry.name} != @sciforge/plugin-${entry.plugin}`)
  }
  if (entry.version !== target.version) {
    versionMismatch.push(`${entry.name}: index ${entry.version} != package.json ${target.version}`)
  }
}

const directoryButNotIndexed = directories
  .filter((entry) => !byName.has(entry.packageName))
  .map((entry) => `${entry.packageName} (plugins/${entry.directory})`)

const unexpectedDirectoryName = directories
  .filter((entry) => entry.packageName !== `@sciforge/plugin-${entry.directory}`)
  .map((entry) => `${entry.packageName} != @sciforge/plugin-${entry.directory}`)

const problems = {
  missingFields,
  duplicates,
  nameDirectoryMismatch,
  versionMismatch,
  indexedButMissingDirectory: installedButMissingDirectory,
  directoryButNotIndexed,
  unexpectedDirectoryName
}
const failures = Object.values(problems).reduce((total, list) => total + list.length, 0)

const result = {
  indexGeneratedAt: index.generatedAt ?? null,
  indexedCount: indexed.length,
  publishedCount: (index.plugins ?? []).length,
  blockedCount: (index.blocked ?? []).length,
  directoryCount: directories.length,
  problems,
  verdict: failures === 0 ? 'consistent' : 'inconsistent'
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exitCode = failures === 0 ? 0 : 1