import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type BoundaryViolation = Readonly<{
  file: string
  location: string
  specifier: string
}>

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packageLockPath = join(repositoryRoot, 'package-lock.json')
const privatePackagePrefix = ['@sciforge', 'internal'].join('-') + '/'
const openContentAttachmentPackage = `${privatePackagePrefix}opencontent-skill-assets`
const openContentAttachmentPath = 'internal/opencontent'
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
] as const
const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx'
])
const excludedDirectoryNames = new Set([
  '.cache',
  '.codex-runtime',
  '.e2e-runtime',
  '.git',
  '.vite',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'output',
  'release',
  'tmp'
])

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/')
}

function publicFiles(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        const privateOverlayRoot = root === repositoryRoot && entry.name === 'internal'
        return privateOverlayRoot || excludedDirectoryNames.has(entry.name)
          ? []
          : publicFiles(path)
      }
      return entry.isFile() ? [path] : []
    })
    .sort()
}

function packageManifestViolations(paths: readonly string[]): BoundaryViolation[] {
  return paths
    .filter((path) => basename(path) === 'package.json')
    .flatMap((path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      return dependencySections.flatMap((section) => {
        const dependencies = manifest[section]
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
          return []
        }
        return Object.keys(dependencies)
          .filter((packageName) => packageName.startsWith(privatePackagePrefix))
          .map((packageName) => ({
            file: repositoryPath(path),
            location: section,
            specifier: packageName
          }))
      })
    })
}

function literalModuleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression
  }
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require')
    )
  ) {
    return node.arguments[0]
  }
  return undefined
}

function sourceImportViolations(paths: readonly string[]): BoundaryViolation[] {
  return paths
    .filter((path) => sourceExtensions.has(extname(path)))
    .flatMap((path) => {
      const sourceText = readFileSync(path, 'utf8')
      const sourceFile = ts.createSourceFile(
        path,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
      const violations: BoundaryViolation[] = []
      const visit = (node: ts.Node): void => {
        const specifier = literalModuleSpecifier(node)
        if (specifier?.text.startsWith(privatePackagePrefix)) {
          const position = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile))
          violations.push({
            file: repositoryPath(path),
            location: `${position.line + 1}:${position.character + 1}`,
            specifier: specifier.text
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
      return violations
    })
}

function packageLockViolations(path: string): BoundaryViolation[] {
  if (!existsSync(path)) return []

  const packageLock = JSON.parse(readFileSync(path, 'utf8')) as {
    packages?: Record<string, {
      name?: unknown
      resolved?: unknown
    }>
  }
  const packages = packageLock.packages
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    return []
  }

  return Object.entries(packages).flatMap(([packagePath, packageRecord]) => {
    const normalizedPackagePath = packagePath.replaceAll('\\', '/')
    const resolved = typeof packageRecord.resolved === 'string'
      ? packageRecord.resolved.replaceAll('\\', '/')
      : undefined
    const locations: BoundaryViolation[] = []

    if (normalizedPackagePath.includes(openContentAttachmentPath)) {
      locations.push({
        file: repositoryPath(path),
        location: `packages[${JSON.stringify(packagePath)}]`,
        specifier: packagePath
      })
    }
    if (packageRecord.name === openContentAttachmentPackage) {
      locations.push({
        file: repositoryPath(path),
        location: `packages[${JSON.stringify(packagePath)}].name`,
        specifier: openContentAttachmentPackage
      })
    }
    if (
      normalizedPackagePath.includes(openContentAttachmentPackage) ||
      resolved?.includes(openContentAttachmentPath) ||
      resolved?.includes(openContentAttachmentPackage)
    ) {
      locations.push({
        file: repositoryPath(path),
        location: resolved === undefined
          ? `packages[${JSON.stringify(packagePath)}]`
          : `packages[${JSON.stringify(packagePath)}].resolved`,
        specifier: resolved ?? packagePath
      })
    }

    return locations
  })
}

function formatViolations(violations: readonly BoundaryViolation[]): string {
  return [...violations]
    .sort((left, right) => (
      `${left.file}:${left.location}:${left.specifier}`
        .localeCompare(`${right.file}:${right.location}:${right.specifier}`)
    ))
    .map(({ file, location, specifier }) => `${file}:${location} -> ${specifier}`)
    .join('\n')
}

describe('public source boundary', () => {
  it('keeps private internal packages out of public manifests and static imports', () => {
    const paths = publicFiles(repositoryRoot)
    const violations = [
      ...packageManifestViolations(paths),
      ...sourceImportViolations(paths)
    ]

    expect(formatViolations(violations)).toBe('')
  }, 15_000)

  it('keeps the group-only OpenContent attachment overlay out of the public package lock', () => {
    expect(formatViolations(packageLockViolations(packageLockPath))).toBe('')
  })
})
