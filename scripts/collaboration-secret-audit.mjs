import { execFileSync } from 'node:child_process'
import {
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const TEST_PATH =
  /(?:^|\/)(?:__tests__|tests?|test-fixtures)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|^packages\/collaboration-contracts\/src\/testing\.ts$/iu
const OWN_AUDIT_PATH = /^scripts\/collaboration-secret-audit(?:\.test)?\.mjs$/u
const MEETING_LOOP_PATH =
  /^(?:packages\/(?:collaboration-(?:contracts|server|provider-zulip)|domains\/(?:identity-access|collaboration|project-coordinator|content-space|opencontent-connector|opencontent-content-space-provider))\/|scripts\/(?:collaboration|run0-meeting)|docs\/operations\/full-collaboration|openspec\/changes\/add-full-multi-user-collaboration-loop\/)/u
const RELEVANT_HOST_FILES = new Set([
  'src/main/modules/installed-domain-main.ts',
  'src/main/modules/installed-main-source-packages.ts',
  'src/preload/index.ts',
  'src/renderer/src/domain-modules/installed-domain-renderer.ts',
  'src/shared/installed-domain-packages.ts'
])
const PRIVATE_SECRET_AUTHORITY_PATH =
  /^(?:packages\/collaboration-server\/src\/|packages\/collaboration-provider-zulip\/src\/|packages\/domains\/identity-access\/src\/main\/|packages\/domains\/opencontent-connector\/src\/main\/|scripts\/collaboration-zulip-acceptance-driver\.mjs$)/u
const PUBLIC_BOUNDARY_PATH =
  /^(?:packages\/collaboration-contracts\/src\/(?!testing\.ts$)|packages\/domains\/(?:collaboration|project-coordinator|content-space)\/src\/(?:[^/]*(?:contract|ports|provider-features)[^/]*|renderer\/[^/]+)\.(?:ts|tsx)$|packages\/domains\/identity-access\/src\/(?:contract|authenticated-cloud-transport|agent-cloud-runtime|device-fact-attestation-signing)\.ts$|packages\/domains\/opencontent-connector\/src\/(?:contract|main-contract|team-administration-contract)\.ts$|packages\/domains\/opencontent-connector\/src\/renderer\/[^/]+\.(?:ts|tsx)$|packages\/domains\/opencontent-content-space-provider\/src\/renderer\/[^/]+\.(?:ts|tsx)$)/u
const RENDERER_OR_IPC_BOUNDARY_PATH =
  /(?:^|\/)(?:preload|renderer|shared)(?:\/|$)/u
const RECEIPT_NAME = /receipt|evidence/iu
const LOG_SINK =
  /^(?:console\.)?(?:debug|error|info|log|table|trace|warn)$|^process\.(?:stderr|stdout)\.write$|(?:^|\.)(?:audit|logger|telemetry)\.(?:debug|error|info|log|trace|warn)$/u
const IPC_SINK =
  /(?:^|\.)(?:ipcRenderer|ipcMain|webContents)\.(?:invoke|send|sendSync|postMessage)$|(?:^|\.)(?:invoke|postMessage)$/u
const RECEIPT_SINK =
  /(?:^|\.)(?:append|emit|insert|publish|save|store|write)(?:[A-Za-z0-9_]*(?:Receipt|Evidence)|(?:Receipt|Evidence)[A-Za-z0-9_]*)$/u
const SENSITIVE_FILE_NAME =
  /(?:^|\/)(?:\.env|id_rsa|id_ed25519|credentials\.json|secrets\.json|tokens?\.json)$|\.(?:key|pem|p12|pfx)$/iu

const fragments = Object.freeze({
  privateKey: ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  aws: ['(?:AK', 'IA|AS', 'IA)'].join(''),
  github: ['gh', '[pousr]_'].join(''),
  slack: ['xo', 'x[baprs]-'].join(''),
  model: ['s', 'k-'].join('')
})

const STRONG_MATERIAL_DETECTORS = Object.freeze([
  ['private-key-material', new RegExp(
    fragments.privateKey.replace('PRIVATE', '(?:[A-Z ]+ )?PRIVATE'),
    'u'
  )],
  ['aws-credential-shaped-value', new RegExp(`${fragments.aws}[0-9A-Z]{16}`, 'u')],
  ['github-credential-shaped-value', new RegExp(
    `${fragments.github}[A-Za-z0-9]{20,}`,
    'u'
  )],
  ['slack-credential-shaped-value', new RegExp(
    `${fragments.slack}[A-Za-z0-9-]{10,}`,
    'u'
  )],
  ['model-credential-shaped-value', new RegExp(
    `${fragments.model}[A-Za-z0-9_-]{20,}`,
    'u'
  )]
])

const SAFE_AUTHORITY_SUFFIXES = Object.freeze([
  'at',
  'code',
  'count',
  'digest',
  'envelope',
  'expiresat',
  'fingerprint',
  'hash',
  'id',
  'kind',
  'metadata',
  'publickey',
  'ref',
  'reference',
  'revision',
  'schema',
  'status',
  'type',
  'version'
])

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '')
}

function normalizeName(value) {
  return value.replace(/[^A-Za-z0-9]/gu, '').toLowerCase()
}

function secretCategory(rawName, { includeGeneric = true } = {}) {
  const name = normalizeName(rawName)
  if (!name) return undefined
  if (SAFE_AUTHORITY_SUFFIXES.some((suffix) => name.endsWith(suffix))) return undefined
  if (name === 'password' || name.endsWith('password') ||
      name === 'passphrase' || name.endsWith('passphrase')) return 'provider-credential'
  if (name === 'apikey' || name.endsWith('apikey') ||
      name === 'clientsecret' || name.endsWith('clientsecret') ||
      name === 'privatekey' || name.endsWith('privatekey')) return 'secret'
  if ((includeGeneric && name === 'token') ||
      /(?:access|refresh|id|oidc|provider|device|agent|user|bot)token$/u.test(name)) {
    return 'token'
  }
  if ((includeGeneric && name === 'credential') ||
      /(?:provider|device|agent|user)credential$/u.test(name)) return 'credential'
  if ((includeGeneric && (name === 'secret' || name === 'secrets'))) return 'secret'
  return undefined
}

function isAllowedBoundaryAuthority(file, rawName, node) {
  if (
    file === 'packages/domains/identity-access/src/contract.ts' &&
    normalizeName(rawName) === 'token' &&
    enclosingVariableName(node) === 'identityCapabilityResourceHandleSchema'
  ) return true
  return false
}

function enclosingVariableName(node) {
  let current = node
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

function nodeName(node) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) ||
      ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  if (ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression)) {
    return node.expression.text
  }
  return undefined
}

function calleeName(expression, sourceFile) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    return `${calleeName(expression.expression, sourceFile)}.${expression.name.text}`
  }
  if (ts.isElementAccessExpression(expression) &&
      expression.argumentExpression &&
      ts.isStringLiteral(expression.argumentExpression)) {
    return `${calleeName(expression.expression, sourceFile)}.${expression.argumentExpression.text}`
  }
  return expression.getText(sourceFile)
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function parseSource(file, source) {
  const extension = extname(file).toLowerCase()
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : extension === '.js' || extension === '.mjs' || extension === '.cjs'
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
}

function isSecretNamedDeclaration(node) {
  return ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node)
}

function collectTaintedNames(sourceFile) {
  const tainted = new Set()
  const declarations = []
  const visit = (node) => {
    if (isSecretNamedDeclaration(node)) {
      const name = nodeName(node.name)
      if (name && secretCategory(name)) tainted.add(name)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      if (tainted.has(declaration.name.text)) continue
      if (expressionContainsSecret(declaration.initializer, tainted)) {
        tainted.add(declaration.name.text)
        changed = true
      }
    }
  }
  return tainted
}

function expressionContainsSecret(node, taintedNames) {
  let found = false
  const visit = (current) => {
    if (found) return
    if (ts.isIdentifier(current)) {
      if (secretCategory(current.text) || taintedNames.has(current.text)) found = true
      return
    }
    if (ts.isStringLiteral(current) && secretCategory(current.text)) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function scanSecretDeclarations(file, sourceFile, addFinding, { includeGeneric }) {
  const visit = (node) => {
    if (isSecretNamedDeclaration(node)) {
      const name = nodeName(node.name)
      const category = name && secretCategory(name, { includeGeneric })
      if (category && !isAllowedBoundaryAuthority(file, name, node)) {
        addFinding(file, lineOf(sourceFile, node.name ?? node), `public-secret-authority-${category}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function scanSinks(file, sourceFile, addFinding) {
  const taintedNames = collectTaintedNames(sourceFile)
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const name = nodeName(node.name)
      if (name && RECEIPT_NAME.test(name) &&
          expressionDirectlyContainsSecret(node.initializer, taintedNames)) {
        addFinding(file, lineOf(sourceFile, node), 'secret-receipt')
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression, sourceFile)
      const sensitive = node.arguments.some((argument) =>
        expressionContainsSecret(argument, taintedNames))
      if (sensitive && LOG_SINK.test(name)) {
        addFinding(file, lineOf(sourceFile, node), 'secret-log')
      }
      if (sensitive && RENDERER_OR_IPC_BOUNDARY_PATH.test(file) && IPC_SINK.test(name)) {
        addFinding(file, lineOf(sourceFile, node), 'secret-ipc')
      }
      if (sensitive && RECEIPT_SINK.test(name)) {
        addFinding(file, lineOf(sourceFile, node), 'secret-receipt')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function expressionDirectlyContainsSecret(node, taintedNames) {
  let found = false
  const visit = (current) => {
    if (found || ts.isCallExpression(current) || ts.isFunctionLike(current)) return
    if (ts.isIdentifier(current)) {
      if (secretCategory(current.text) || taintedNames.has(current.text)) found = true
      return
    }
    if (ts.isStringLiteral(current) && secretCategory(current.text)) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isPlaceholder(value) {
  return /(?:canary|example|fixture|invalid|must[-_ ]?not|placeholder|redacted|synthetic|test|unused)/iu
    .test(value) || value.length < 8
}

function scanLiteralAssignments(file, sourceFile, addFinding) {
  const visit = (node) => {
    if (isSecretNamedDeclaration(node) && 'initializer' in node && node.initializer &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      const name = nodeName(node.name)
      if (name && secretCategory(name) && !isPlaceholder(node.initializer.text)) {
        addFinding(file, lineOf(sourceFile, node), 'literal-secret-assignment')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function scanStrongMaterial(file, source, addFinding) {
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    for (const [kind, detector] of STRONG_MATERIAL_DETECTORS) {
      if (detector.test(lines[index])) addFinding(file, index + 1, kind)
    }
  }
}

function readSource(root, file) {
  const path = join(root, file)
  let metadata
  try {
    metadata = statSync(path)
  } catch {
    return undefined
  }
  if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) return undefined
  try {
    const source = readFileSync(path, 'utf8')
    return source.includes('\0') ? undefined : source
  } catch {
    return undefined
  }
}

function gitFiles(root) {
  return execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  ).split('\0').filter(Boolean).map(normalizePath)
}

export function walkFiles(root) {
  const result = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' ||
          entry.name === 'dist' || entry.name === 'build') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) result.push(normalizePath(relative(root, path)))
    }
  }
  visit(root)
  return result
}

function enforceCanonicalBoundaries(root, files, sources, addFinding) {
  const fileSet = new Set(files)
  const rootPackage = sources.get('package.json') ?? readSource(root, 'package.json') ?? ''
  if (
    files.some((file) => file.startsWith('packages/collaboration-identity/')) ||
    rootPackage.includes('@sciforge/collaboration-identity')
  ) {
    addFinding('package.json', 0, 'parallel-collaboration-token-package')
  }

  const connectorContract =
    sources.get('packages/domains/opencontent-connector/src/contract.ts')
  if (connectorContract !== undefined &&
      !/openContentBindInputSchema\s*=\s*openContentConnectionTargetInputSchema/u
        .test(connectorContract)) {
    addFinding(
      'packages/domains/opencontent-connector/src/contract.ts',
      0,
      'provider-public-enrollment-not-secret-free'
    )
  }

  const connectorMain = sources.get(
    'packages/domains/opencontent-connector/src/main/index.ts'
  )
  if (connectorMain !== undefined) {
    if (/packageSecrets\??\.providerCredentials|credentials\s*:/u.test(connectorMain)) {
      addFinding(
        'packages/domains/opencontent-connector/src/main/index.ts',
        0,
        'provider-host-credential-path'
      )
    }
    if (!connectorMain.includes('createNativeOpenContentPrivateAccountRuntime')) {
      addFinding(
        'packages/domains/opencontent-connector/src/main/index.ts',
        0,
        'provider-native-enrollment-not-composed'
      )
    }
  }

  const connectorManifest = sources.get(
    'packages/domains/opencontent-connector/package.json'
  )
  if (connectorManifest !== undefined) {
    let exported = ''
    try {
      exported = JSON.stringify(JSON.parse(connectorManifest).exports ?? {})
    } catch {
      addFinding(
        'packages/domains/opencontent-connector/package.json',
        0,
        'provider-package-manifest-invalid'
      )
    }
    if (/private-account|native-enrollment|opencontent-client/iu.test(exported)) {
      addFinding(
        'packages/domains/opencontent-connector/package.json',
        0,
        'provider-private-authority-exported'
      )
    }
  }

  const nativeSourcePath =
    'packages/domains/opencontent-connector/src/main/native-enrollment/native/opencontent_native_enrollment.mm'
  if (fileSet.has(nativeSourcePath)) {
    const nativeSource = sources.get(nativeSourcePath) ?? ''
    for (const requirement of [
      '#include <node_api.h>',
      '#import <AppKit/AppKit.h>',
      'kSecClassGenericPassword',
      'kSecAttrAccessibleWhenUnlockedThisDeviceOnly',
      'kSecAttrSynchronizable: @NO'
    ]) {
      if (!nativeSource.includes(requirement)) {
        addFinding(nativeSourcePath, 0, 'provider-native-boundary-incomplete')
        break
      }
    }
  }

  const nativeLoaderPath =
    'packages/domains/opencontent-connector/src/main/native-enrollment/native-binding.ts'
  if (fileSet.has(nativeLoaderPath)) {
    const loader = sources.get(nativeLoaderPath) ?? ''
    if (/ipcMain|ipcRenderer|@renderer|@shared|process\.env|console\./u.test(loader)) {
      addFinding(nativeLoaderPath, 0, 'provider-native-boundary-escape')
    }
  }
}

export function auditRoot({
  root = process.cwd(),
  scanAll = false,
  files: providedFiles
} = {}) {
  const resolvedRoot = resolve(root)
  const files = [...new Set((providedFiles ?? gitFiles(resolvedRoot)).map(normalizePath))].sort()
  const candidates = files.filter((file) =>
    file !== 'package-lock.json' &&
    !file.startsWith('vendor/') &&
    !OWN_AUDIT_PATH.test(file) &&
    (scanAll || MEETING_LOOP_PATH.test(file) || RELEVANT_HOST_FILES.has(file) ||
      file === 'package.json')
  )
  const findings = []
  const findingKeys = new Set()
  const sources = new Map()
  const addFinding = (file, line, kind) => {
    const key = `${file}:${line}:${kind}`
    if (findingKeys.has(key)) return
    findingKeys.add(key)
    findings.push(Object.freeze({ file, line, kind }))
  }

  for (const file of candidates) {
    if (SENSITIVE_FILE_NAME.test(file)) addFinding(file, 0, 'sensitive-file-name')
    const source = readSource(resolvedRoot, file)
    if (source === undefined) continue
    sources.set(file, source)
    scanStrongMaterial(file, source, addFinding)
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase()) || TEST_PATH.test(file)) continue
    const sourceFile = parseSource(file, source)
    const meetingLoopSource = MEETING_LOOP_PATH.test(file) || RELEVANT_HOST_FILES.has(file)
    const publicBoundary = PUBLIC_BOUNDARY_PATH.test(file)
    if (meetingLoopSource && publicBoundary) {
      scanSecretDeclarations(file, sourceFile, addFinding, { includeGeneric: true })
    } else if (
      meetingLoopSource &&
      !PRIVATE_SECRET_AUTHORITY_PATH.test(file) &&
      !file.startsWith('docs/')
    ) {
      scanSecretDeclarations(file, sourceFile, addFinding, { includeGeneric: false })
    }
    if (meetingLoopSource) scanSinks(file, sourceFile, addFinding)
    scanLiteralAssignments(file, sourceFile, addFinding)
  }

  // Load canonical files that are intentionally outside the default path
  // selection (root package metadata) before enforcing exact ownership.
  if (!sources.has('package.json')) {
    const rootPackage = readSource(resolvedRoot, 'package.json')
    if (rootPackage !== undefined) sources.set('package.json', rootPackage)
  }
  enforceCanonicalBoundaries(resolvedRoot, candidates, sources, addFinding)

  findings.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind)
  )
  return Object.freeze({
    scope: scanAll ? 'repository-material-plus-meeting-loop-boundaries' : 'meeting-loop-security-boundary',
    scannedFiles: candidates.length,
    findings: Object.freeze(findings)
  })
}

function parseArgs(argv) {
  const allowed = new Set(['--all'])
  for (const argument of argv) {
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`)
  }
  return Object.freeze({ scanAll: argv.includes('--all') })
}

function main() {
  const result = auditRoot(parseArgs(process.argv.slice(2)))
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      process.stderr.write(`${finding.file}:${finding.line}:${finding.kind}\n`)
    }
    process.stderr.write(
      `collaboration-secret-audit: ${result.findings.length} redacted finding(s)\n`
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `collaboration-secret-audit: pass (${result.scope}, ${result.scannedFiles} file(s))\n`
  )
}

const invokedAsScript = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedAsScript) main()
