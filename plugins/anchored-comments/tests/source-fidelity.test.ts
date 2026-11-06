/** The installed plugin is the only source of its backend implementation. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function* pluginSources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* pluginSources(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

function imports(source: string): string[] {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

function assertPluginImport(specifier: string, path: string): void {
  assert.doesNotMatch(specifier, /(?:@shared|@renderer|@sciforge\/domain-anchored-comments|packages\/domains\/anchored-comments|src\/(?:main|renderer|shared)\/)/)
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const target = resolve(dirname(path), specifier)
    const local = relative(PLUGIN_ROOT, target)
    assert.ok(local !== '..' && !local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(local), `${path} imports outside the plugin: ${specifier}`)
  }
}

test('backend sources import only plugin-local files and public dependencies', () => {
  for (const path of pluginSources(join(PLUGIN_ROOT, 'src'))) {
    for (const specifier of imports(readFileSync(path, 'utf8'))) {
      assertPluginImport(specifier, path)
    }
  }
})

test('boundary checker rejects legacy domains, host-private imports and package escapes', () => {
  const path = join(PLUGIN_ROOT, 'src', 'core', 'example.ts')
  for (const specifier of [
    '@sciforge/domain-anchored-comments/contract',
    '@shared/visible-context',
    '@renderer/private-store',
    '../../../packages/domains/anchored-comments/src/contract',
    '../../../src/main/index'
  ]) assert.throws(() => assertPluginImport(specifier, path))
  assert.deepEqual(imports("import type { X } from './contract'; export { Y } from './operations'; import('../ports/files'); type Z = import('./definition').Z"), [
    './contract', './operations', '../ports/files', './definition'
  ])
})

test('plugin owns a single backend factory without static registration or old UI metadata', () => {
  assert.equal(existsSync(join(PLUGIN_ROOT, 'src', 'sciforge.domain.json')), false)
  const factory = readFileSync(join(PLUGIN_ROOT, 'src', 'core', 'main', 'index.ts'), 'utf8')
  const identity = readFileSync(join(PLUGIN_ROOT, 'src', 'core', 'definition.ts'), 'utf8')
  const operations = readFileSync(join(PLUGIN_ROOT, 'src', 'core', 'operations.ts'), 'utf8')
  assert.doesNotMatch(factory, /createDomainMainEntry|defineTrustedDomainPackage|domainPackageDefinition|anchoredComments:|getUserDataDir/)
  assert.doesNotMatch(identity, /renderer\.|global-overlay|composer-context|sciforge\.domain\.json|defineTrustedDomainPackage/)
  assert.match(operations, /createAnchoredCommentsCapabilityFactory<AnchoredCapabilityDefinition>/)
})

test('DSH entry bundles independently without old-domain or host-private runtime imports', async () => {
  const result = await build({
    absWorkingDir: PLUGIN_ROOT,
    entryPoints: ['src/dsh-adapter/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['@deepseek-ai/*'],
    write: false,
    metafile: true,
    logLevel: 'silent'
  })
  const forbidden = /(?:packages\/domains\/anchored-comments|(?:^|\/)src\/(?:main|renderer|shared)\/|sciforge\.domain\.json)/
  for (const input of Object.keys(result.metafile!.inputs)) {
    assert.doesNotMatch(input.replaceAll('\\', '/'), forbidden)
  }
  for (const output of Object.values(result.metafile!.outputs)) {
    for (const dependency of output.imports) {
      assert.ok(dependency.path.startsWith('node:') || dependency.path.startsWith('@deepseek-ai/'), `unexpected runtime dependency: ${dependency.path}`)
    }
  }
  assert.ok(result.outputFiles.length > 0)
})
