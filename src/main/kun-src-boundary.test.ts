import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type KunImportHit = {
  file: string
  line: number
  column: number
  specifier: string
  text: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoots = ['src/main', 'src/shared', 'src/renderer']
const sourceExtensions = new Set(['.ts', '.tsx'])
const excludedSegments = new Set(['dist', 'node_modules', 'out'])
const directKunImportPattern =
  /\bfrom\s+['"]([^'"]*kun\/src\/[^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]*kun\/src\/[^'"]+)['"]\s*\)/g

const allowedKunBoundaryImports = new Map<string, string[]>([
  ['src/main/atomic-write-file.ts', ['kun/src/adapters/file/atomic-write.js']],
  [
    'src/main/local-runtime-package-contract.ts',
    ['kun/src/config/kun-config.js', 'kun/src/contracts/capabilities.js']
  ],
  [
    'src/main/biogym-tool-schema-contract.ts',
    ['kun/src/adapters/tool/biogym-design-tool.js']
  ],
  [
    'src/shared/gui-plan.test.ts',
    ['kun/src/shared/gui-plan']
  ]
])

const localRuntimePackageContractWrapper = 'src/main/local-runtime-package-contract.ts'

function toRepoPath(path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function isExcludedPath(path: string): boolean {
  return toRepoPath(path).split('/').some((segment) => excludedSegments.has(segment))
}

function isSourceFile(path: string): boolean {
  return sourceExtensions.has(extname(path))
}

function collectSourceFiles(root: string): string[] {
  if (!existsSync(root) || isExcludedPath(root)) return []
  const stats = statSync(root)
  if (stats.isDirectory()) {
    return readdirSync(root)
      .flatMap((entry) => collectSourceFiles(join(root, entry)))
      .sort()
  }
  return stats.isFile() && isSourceFile(root) ? [root] : []
}

function sourceLocation(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index)
  const line = before.split(/\r?\n/).length
  const lastLineBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
  return {
    line,
    column: index - lastLineBreak
  }
}

function scanDirectKunImports(): KunImportHit[] {
  return sourceRoots
    .flatMap((sourceRoot) => collectSourceFiles(join(repoRoot, sourceRoot)))
    .flatMap((path) => {
      const file = toRepoPath(path)
      const content = readFileSync(path, 'utf8')
      const lines = content.split(/\r?\n/)
      const hits: KunImportHit[] = []
      directKunImportPattern.lastIndex = 0
      for (let match = directKunImportPattern.exec(content); match; match = directKunImportPattern.exec(content)) {
        const specifier = match[1] ?? match[2] ?? ''
        const location = sourceLocation(content, match.index)
        hits.push({
          file,
          ...location,
          specifier,
          text: lines[location.line - 1]?.trim().replace(/\s+/g, ' ') ?? ''
        })
      }
      return hits
    })
    .sort((a, b) => `${a.file}:${a.line}:${a.column}`.localeCompare(`${b.file}:${b.line}:${b.column}`))
}

function isLocalRuntimeSchemaContractImport(hit: KunImportHit): boolean {
  return (
    hit.specifier.includes('kun/src/config/kun-config') ||
    hit.specifier.includes('kun/src/contracts/capabilities')
  )
}

function isAllowedKunBoundaryImport(hit: KunImportHit): boolean {
  const allowedSpecifiers = allowedKunBoundaryImports.get(hit.file) ?? []
  return allowedSpecifiers.some((specifier) => hit.specifier.includes(specifier))
}

function formatHits(hits: KunImportHit[]): string {
  return hits
    .map((hit) => `${hit.file}:${hit.line}:${hit.column} ${hit.specifier} :: ${hit.text}`)
    .join('\n')
}

describe('GUI kun/src import boundary', () => {
  it('keeps direct kun/src imports inside explicit GUI boundary wrappers', () => {
    const hits = scanDirectKunImports()
    const disallowedHits = hits.filter((hit) => !isAllowedKunBoundaryImport(hit))

    expect(formatHits(disallowedHits)).toBe('')
  })

  it('keeps local runtime config and capability schemas behind one contract wrapper', () => {
    const schemaContractFiles = new Set(
      scanDirectKunImports()
        .filter(isLocalRuntimeSchemaContractImport)
        .map((hit) => hit.file)
    )

    expect([...schemaContractFiles].sort()).toEqual([localRuntimePackageContractWrapper])
  })
})
