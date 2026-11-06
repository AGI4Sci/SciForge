/** Architecture checks for the canonical, independently owned plugin package. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOT = join(PLUGIN_ROOT, 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : []
  })
}

function moduleSpecifiers(source: string, filename = 'source.ts'): string[] {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)) {
      specifiers.push(node.argument.literal.text)
    }
    if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0]
      assert.ok(argument && ts.isStringLiteralLike(argument), 'Module loads must use explicit specifiers.')
      specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return specifiers
}

function boundaryProblems(path: string, source: string): string[] {
  return moduleSpecifiers(source, path).flatMap(specifier => {
    if (isAbsolute(specifier) || /^(?:@shared|@renderer)(?:\/|$)/u.test(specifier) ||
        /(?:^|\/)src\/(?:main|renderer|shared)(?:\/|$)/u.test(specifier)) {
      return [`Host-private import: ${specifier}`]
    }
    if (!specifier.startsWith('.')) return []
    const target = resolve(dirname(path), specifier)
    const location = relative(SOURCE_ROOT, target)
    if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
      return [`Import leaves production source boundary: ${specifier}`]
    }
    return []
  })
}

test('every production module stays within package source and public dependency boundaries', () => {
  const paths = sourceFiles(SOURCE_ROOT)
  assert.ok(paths.length > 0)
  for (const path of paths) {
    assert.deepEqual(boundaryProblems(path, readFileSync(path, 'utf8')), [], relative(PLUGIN_ROOT, path))
  }
})

test('production contains no fixture or test modules and cannot load recorded-session providers', () => {
  for (const path of sourceFiles(SOURCE_ROOT)) {
    assert.doesNotMatch(relative(SOURCE_ROOT, path), /(?:^|[/\\])(?:fixtures?|tests?)(?:[/\\]|$)|\.test\./u)
    const source = readFileSync(path, 'utf8')
    assert.doesNotMatch(source, /createConfigAgentThreads|changeInspectorFixtureConfigSchema|dshConfig\.sessions/u)
    for (const specifier of moduleSpecifiers(source, path)) {
      assert.doesNotMatch(specifier, /(?:^|\/)fixtures?(?:\/|$)|(?:^|\/)tests?(?:\/|$)|\.test\./u)
    }
  }
})

test('the projection core depends only on local contracts, ports, zod and Node crypto', () => {
  const paths = sourceFiles(join(SOURCE_ROOT, 'core'))
  assert.ok(paths.length > 0)
  for (const path of paths) {
    for (const specifier of moduleSpecifiers(readFileSync(path, 'utf8'), path)) {
      assert.ok(specifier.startsWith('.') || specifier === 'zod' || specifier === 'node:crypto', specifier)
      assert.doesNotMatch(specifier, /(?:^|\/)dsh-adapter(?:\/|$)/u)
    }
  }
})

test('package exports and build entry resolve inside the independently owned package', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')) as {
    name: string
    exports: Record<string, { import: string }>
    dependencies: Record<string, string>
  }
  assert.equal(manifest.name, '@sciforge/plugin-change-inspector')
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@sciforge/domain-sdk', 'zod'])
  const contract = readFileSync(join(SOURCE_ROOT, 'contract.ts'), 'utf8')
  assert.match(contract, /@sciforge\/domain-sdk\/research-audit/u)
  assert.doesNotMatch(contract, /packages\/domains\/change-inspector/u)
  assert.deepEqual(manifest.exports, { '.': { import: './dist/main.js' } })
  const build = readFileSync(join(PLUGIN_ROOT, 'build.mjs'), 'utf8')
  assert.match(build, /new URL\('\.\/src\/dsh-adapter\/index\.ts', import\.meta\.url\)/u)
  assert.ok(existsSync(join(SOURCE_ROOT, 'dsh-adapter', 'index.ts')))
})

test('boundary checker catches imports, reexports, dynamic imports and import types', () => {
  const path = join(SOURCE_ROOT, 'core', 'boundary-probe.ts')
  for (const source of [
    "import { host } from '../../../../src/main/host.js'",
    'export { host } from "@shared/host"',
    'void import("../../tests/fixtures/provider.js")',
    'type Host = import("/host/private.js").Host',
    'const host = require("@renderer/host")'
  ]) {
    assert.notDeepEqual(boundaryProblems(path, source), [], source)
  }
  assert.deepEqual(boundaryProblems(path, "import { contract } from '../contract.js'"), [])
  assert.throws(() => moduleSpecifiers('void import(moduleName)'), /explicit specifiers/u)
})
