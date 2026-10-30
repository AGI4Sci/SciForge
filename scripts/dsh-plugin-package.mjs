#!/usr/bin/env node
/**
 * Packs a DSH-form SciForge plugin into a distributable `.sciforge-dsh-plugin`
 * artifact and emits the market catalog entry for it.
 *
 * Why a separate format: `.sciforge-plugin` is the sandboxed-runtime domain
 * package format (Ed25519-signed ZIP whose manifest must declare
 * `kind: "sandboxed-runtime"`). A DSH runtime plugin is a directory whose
 * manifest is its own `package.json` (`dsh.bundle.patch` / `client` /
 * `profile`) with a built `dist/main.js` entry, loaded by ProcessExtensionHost.
 * The two are different contracts and must not be merged; this packer produces
 * the DSH one.
 *
 * Artifact layout (deterministic ZIP):
 *   <payload: package.json, dist/**, declared patch files, sciforge.adapter.json, README.md>
 *   META-INF/sciforge-dsh-plugin.json   canonical JSON, per-file SHA-256, tool declaration
 *
 * Host-provided dependencies (`@deepseek-ai/*`, native addons) stay external and
 * are NOT carried in the artifact; the manifest records them as
 * `hostDependencies` so install can reject an artifact whose host requirements
 * the running host cannot satisfy.
 *
 * Usage:
 *   node scripts/dsh-plugin-package.mjs pack --source <plugin-dir> --output <artifact>
 *        [--out-dir <dir>] [--catalog <catalog.json>] [--json]
 *   node scripts/dsh-plugin-package.mjs verify --artifact <artifact> [--json]
 *
 * `verify` delegates to the canonical installer-side validator
 * (src/main/extensions/dsh-plugin-artifact.ts) so packaging and installation
 * cannot drift apart.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { canonicalJson } from './extension-package.mjs'

/** Fixed timestamp so identical input bytes produce identical artifact bytes. */
export const ARTIFACT_FIXED_DATE = new Date('2000-01-01T00:00:00.000Z')

export const DSH_ARTIFACT_MANIFEST_PATH = 'META-INF/sciforge-dsh-plugin.json'
export const DSH_ARTIFACT_SIGNATURE_PATH = 'META-INF/sciforge-signature.json'

export const DSH_ARTIFACT_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxFiles: 4096,
  maxPathLength: 1024
})

const FORBIDDEN_PACKAGE_HOOKS = Object.freeze([
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublish', 'prepublishOnly', 'postpublish'
])

const ALLOWED_TOOL_EFFECTS = Object.freeze([
  'read', 'compute', 'workspace-write', 'external-write', 'destructive'
])

/** Canonical artifact path rules: identical in spirit to the domain packer. */
export function assertCanonicalArtifactPath(input, label = 'artifact path') {
  if (typeof input !== 'string' || !input) throw new Error(`${label} must be a non-empty string.`)
  if (input.length > DSH_ARTIFACT_LIMITS.maxPathLength) throw new Error(`${label} is too long: ${input}`)
  if (input.includes('\0')) throw new Error(`${label} contains a NUL byte.`)
  if (input.includes('\\')) throw new Error(`${label} must use POSIX separators: ${input}`)
  if (input.startsWith('/') || isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new Error(`${label} must be relative: ${input}`)
  }
  const segments = input.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} has a non-canonical segment: ${input}`)
  }
  if (input.normalize('NFC') !== input) throw new Error(`${label} must be Unicode NFC: ${input}`)
  return input
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function listPayloadFiles(root, collected = []) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Payload must not contain symlinks: ${absolute}`)
    if (entry.isDirectory()) await listPayloadFiles(absolute, collected)
    else if (entry.isFile()) collected.push(absolute)
    else throw new Error(`Payload contains a non-regular entry: ${absolute}`)
  }
  return collected
}

async function readJson(path, label) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`${label} is missing at ${path}.`, { cause: error })
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} at ${path} is not valid JSON.`, { cause: error })
  }
}

function manifestEntryPath(packageJson) {
  const exportsField = packageJson.exports
  const fromExports = typeof exportsField === 'string'
    ? exportsField
    : (exportsField?.['.'] && typeof exportsField['.'] === 'object'
      ? exportsField['.'].import ?? exportsField['.'].default
      : exportsField?.['.'])
  const entry = fromExports ?? packageJson.main
  if (typeof entry !== 'string' || !entry) {
    throw new Error('package.json must declare an importable entry (exports["."] or main).')
  }
  return assertCanonicalArtifactPath(entry.replace(/^\.\//, ''), 'package.json entry')
}

function declaredPatchPaths(packageJson) {
  const patch = packageJson.dsh?.bundle?.patch
  const list = patch === undefined ? [] : Array.isArray(patch) ? patch : [patch]
  return list.map((item) => assertCanonicalArtifactPath(String(item).replace(/^\.\//, ''), 'dsh.bundle.patch'))
}

/** Validates the plugin's own declaration file and returns the tool grant table. */
export function normalizeDeclaration(declaration, { packageName, entry }) {
  if (declaration === undefined) return { tools: {}, hostDependencies: [], categories: [], title: undefined, summary: undefined }
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    throw new Error('sciforge.dsh.json must contain an object.')
  }
  if (declaration.schemaVersion !== 1) throw new Error('sciforge.dsh.json schemaVersion must be 1.')
  if (declaration.packageName !== packageName) {
    throw new Error(`sciforge.dsh.json packageName must match package.json name (${packageName}).`)
  }
  if (declaration.entry !== undefined && declaration.entry !== entry) {
    throw new Error(`sciforge.dsh.json entry must match package.json entry (${entry}).`)
  }
  const tools = {}
  for (const [name, grant] of Object.entries(declaration.tools ?? {})) {
    // The DSH tool name is only a grant lookup key for the runner (it must match
    // the tool the plugin registers); `status` and `map_data` are both valid.
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name)) {
      throw new Error(`Tool name ${name} must be a lowercase DSH tool name.`)
    }
    if (!grant || typeof grant !== 'object') throw new Error(`Tool ${name} grant must be an object.`)
    // The grant id, unlike the tool name, is pattern-checked by the runner.
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(String(grant.id))) {
      throw new Error(`Tool ${name} id must be a canonical capability id.`)
    }
    if (!ALLOWED_TOOL_EFFECTS.includes(grant.effect)) {
      throw new Error(`Tool ${name} effect ${String(grant.effect)} is not an approved effect.`)
    }
    if (grant.readResource !== undefined && (grant.readResource !== 'workspace' || grant.effect !== 'read')) {
      throw new Error(`Tool ${name} readResource must be "workspace" on a read grant.`)
    }
    tools[name] = {
      id: grant.id,
      effect: grant.effect,
      ...(grant.readResource !== undefined ? { readResource: grant.readResource } : {})
    }
  }
  const hostDependencies = [...new Set((declaration.hostDependencies ?? []).map((dep) => {
    if (typeof dep !== 'string' || !dep.trim()) throw new Error('hostDependencies entries must be non-empty strings.')
    return dep.trim()
  }))].sort()
  const categories = [...new Set((declaration.categories ?? []).map((category) => {
    if (!/^[a-z][a-z0-9-]*$/.test(String(category))) throw new Error(`Category ${String(category)} must be a lowercase slug.`)
    return category
  }))].sort()
  return { tools, hostDependencies, categories, title: declaration.title, summary: declaration.summary }
}

export async function packDshPlugin(options) {
  const sourceDir = resolve(options.source)
  const packageJsonPath = join(sourceDir, 'package.json')
  const packageJson = await readJson(packageJsonPath, 'package.json')

  if (typeof packageJson.name !== 'string' || !packageJson.name) throw new Error('package.json name is required.')
  if (typeof packageJson.version !== 'string' || !packageJson.version) throw new Error('package.json version is required.')
  for (const hook of FORBIDDEN_PACKAGE_HOOKS) {
    if (packageJson.scripts?.[hook]) throw new Error(`package.json declares a forbidden lifecycle script: ${hook}`)
  }
  const dsh = packageJson.dsh
  if (!dsh || (!dsh.bundle && !dsh.client && !dsh.profile)) {
    throw new Error('package.json must declare dsh.bundle, dsh.client or dsh.profile (DSH plugin manifest contract).')
  }
  const entry = manifestEntryPath(packageJson)

  const payloadPaths = new Set(['package.json', entry])
  for (const patch of declaredPatchPaths(packageJson)) payloadPaths.add(patch)
  for (const optional of ['sciforge.adapter.json', 'README.md']) {
    try {
      const info = await stat(join(sourceDir, optional))
      if (info.isFile()) payloadPaths.add(optional)
    } catch {
      // optional file absent
    }
  }
  // Everything under the built dist directory travels with the artifact.
  const distRoot = join(sourceDir, dirname(entry))
  try {
    if ((await stat(distRoot)).isDirectory()) {
      for (const absolute of await listPayloadFiles(distRoot)) {
        payloadPaths.add(relative(sourceDir, absolute).split(sep).join('/'))
      }
    }
  } catch {
    throw new Error(`The plugin is not built: ${dirname(entry)} does not exist. Run the plugin build first.`)
  }

  const declaration = await (async () => {
    try {
      return await readJson(join(sourceDir, 'sciforge.dsh.json'), 'sciforge.dsh.json')
    } catch (error) {
      if (/is missing at/.test(String(error.message))) return undefined
      throw error
    }
  })()
  const normalized = normalizeDeclaration(declaration, { packageName: packageJson.name, entry })

  const files = {}
  let totalBytes = 0
  const sortedPaths = [...payloadPaths].sort()
  if (sortedPaths.length > DSH_ARTIFACT_LIMITS.maxFiles) throw new Error('Payload exceeds the file-count limit.')
  for (const path of sortedPaths) {
    assertCanonicalArtifactPath(path)
    const absolute = join(sourceDir, path)
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error(`Payload entry is not a regular file: ${path}`)
    if (info.size > DSH_ARTIFACT_LIMITS.maxFileBytes) throw new Error(`Payload file exceeds the size limit: ${path}`)
    totalBytes += info.size
    if (totalBytes > DSH_ARTIFACT_LIMITS.maxTotalBytes) throw new Error('Payload exceeds the total size limit.')
    const contents = await readFile(absolute)
    files[path] = sha256(contents)
  }

  const manifest = {
    schemaVersion: 1,
    packageName: packageJson.name,
    version: packageJson.version,
    entry,
    dsh: Object.fromEntries(Object.entries(dsh).filter(([, value]) => value !== undefined)),
    ...(packageJson.engines?.dsh ? { engines: { dsh: packageJson.engines.dsh } } : {}),
    hostDependencies: normalized.hostDependencies,
    tools: normalized.tools,
    files
  }
  const manifestBytes = Buffer.from(canonicalJson(manifest))

  // Publisher signature over the manifest bytes. The signature file is written
  // into the artifact but excluded from the manifest's own file list (a signature
  // cannot cover itself), so signing never changes the digests it signs.
  let signatureBytes
  let signature
  if (options.signingKeyPath) {
    if (!options.keyId || !options.publisherId) {
      throw new Error('Signing requires --key-id and --publisher-id.')
    }
    const privateKey = createPrivateKey(await readFile(resolve(options.signingKeyPath), 'utf8'))
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('The signing key must be an Ed25519 private key.')
    }
    signature = {
      version: 1,
      algorithm: 'ed25519',
      keyId: options.keyId,
      publisherId: options.publisherId,
      signature: signEd25519(null, manifestBytes, privateKey).toString('base64')
    }
    signatureBytes = Buffer.from(canonicalJson(signature))
  }

  const zip = new JSZip()
  for (const path of sortedPaths) {
    zip.file(path, await readFile(join(sourceDir, path)), {
      date: ARTIFACT_FIXED_DATE,
      unixPermissions: '644',
      createFolders: false
    })
  }
  zip.file(DSH_ARTIFACT_MANIFEST_PATH, manifestBytes, {
    date: ARTIFACT_FIXED_DATE,
    unixPermissions: '644',
    createFolders: false
  })
  if (signatureBytes) {
    zip.file(DSH_ARTIFACT_SIGNATURE_PATH, signatureBytes, {
      date: ARTIFACT_FIXED_DATE,
      unixPermissions: '644',
      createFolders: false
    })
  }
  const archiveBytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false
  })
  if (archiveBytes.byteLength > DSH_ARTIFACT_LIMITS.maxArchiveBytes) {
    throw new Error('Artifact exceeds the archive size limit.')
  }

  const defaultName = `${packageJson.name.replace(/^@/, '').replace(/\//g, '-')}-${packageJson.version}.sciforge-dsh-plugin`
  const outDir = resolve(options.outDir ?? join(sourceDir, 'dist-artifacts'))
  const output = resolve(options.output ?? join(outDir, defaultName))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, archiveBytes)

  return {
    ok: true,
    artifact: output,
    packageName: packageJson.name,
    version: packageJson.version,
    entry,
    sizeBytes: archiveBytes.byteLength,
    sha256: sha256(archiveBytes),
    fileCount: sortedPaths.length,
    tools: normalized.tools,
    hostDependencies: normalized.hostDependencies,
    ...(signature
      ? { signature: { keyId: signature.keyId, publisherId: signature.publisherId, algorithm: signature.algorithm } }
      : { signature: null }),
    catalogEntry: {
      name: packageJson.name,
      title: normalized.title ?? packageJson.name,
      ...(normalized.summary ? { summary: normalized.summary } : {}),
      categories: normalized.categories,
      form: 'dsh-runtime',
      version: packageJson.version,
      entry,
      ...(packageJson.engines?.dsh ? { dshRange: packageJson.engines.dsh } : {}),
      hostDependencies: normalized.hostDependencies,
      tools: normalized.tools,
      artifact: {
        file: defaultName,
        sizeBytes: archiveBytes.byteLength,
        sha256: sha256(archiveBytes)
      },
      source: relative(resolve('.'), sourceDir).split(sep).join('/')
    }
  }
}

async function mergeCatalog(catalogPath, entry) {
  const absolute = resolve(catalogPath)
  let catalog
  try {
    catalog = JSON.parse(await readFile(absolute, 'utf8'))
  } catch {
    catalog = { format: 1, plugins: [] }
  }
  if (!Array.isArray(catalog.plugins)) throw new Error(`${catalogPath} must contain a plugins array.`)
  const index = catalog.plugins.findIndex((item) => item?.name === entry.name)
  if (index < 0) catalog.plugins.push(entry)
  else catalog.plugins[index] = entry
  catalog.plugins.sort((left, right) => String(left.name).localeCompare(String(right.name)))
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(catalog, null, 2)}\n`)
  return absolute
}

async function verifyArtifact(artifactPath, keyringPath) {
  const validator = await import(pathToFileURL(resolve('src/main/extensions/dsh-plugin-artifact.ts')).href)
  const result = await validator.readDshPluginArtifact(artifactPath)
  const summary = {
    ok: true,
    packageName: result.manifest.packageName,
    version: result.manifest.version,
    entry: result.manifest.entry,
    fileCount: Object.keys(result.manifest.files).length,
    tools: result.manifest.tools,
    hostDependencies: result.manifest.hostDependencies,
    signed: result.signatureBytes !== undefined
  }
  if (!keyringPath) return summary
  const trust = await import(pathToFileURL(resolve('src/main/extensions/dsh-plugin-signature.ts')).href)
  const keyring = await trust.loadDshPublisherKeyring(resolve(keyringPath))
  summary.trust = trust.verifyDshPluginSignature({
    manifestBytes: result.manifestBytes,
    signatureBytes: result.signatureBytes,
    keyring
  })
  return summary
}

/**
 * Generates an Ed25519 publisher keypair and a host keyring containing only the
 * public half. The private key is written where the caller asked for it — test
 * keys belong outside the repository, and production keys are never generated
 * here.
 */
export async function generatePublisherKeypair({ outDir, keyId, publisherId }) {
  if (!outDir || !keyId || !publisherId) {
    throw new Error('keygen requires --out, --key-id and --publisher-id.')
  }
  const directory = resolve(outDir)
  await mkdir(directory, { recursive: true })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPath = join(directory, `${keyId}.private.pem`)
  const keyringPath = join(directory, 'dsh-publisher-keys.json')
  await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  await writeFile(keyringPath, `${JSON.stringify({
    version: 1,
    keys: [{ keyId, publisherId, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }]
  }, null, 2)}\n`)
  return { ok: true, keyId, publisherId, privateKeyPath, keyringPath }
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv
  const options = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--json') { options.json = true; continue }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}.`)
    const key = token.slice(2)
    const value = tokens[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value.`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/dsh-plugin-package.mjs pack --source <plugin-dir> --output <artifact>',
    '       [--out-dir <dir>] [--catalog <catalog.json>] [--json]',
    '       [--key <private-key.pem> --key-id <id> --publisher-id <id>]',
    '  node scripts/dsh-plugin-package.mjs verify --artifact <artifact> [--keyring <keys.json>] [--json]',
    '  node scripts/dsh-plugin-package.mjs keygen --out <dir> --key-id <id> --publisher-id <id> [--json]'
  ].join('\n')
}

async function runCli(argv) {
  const { command, options } = parseCliArguments(argv)
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (command === 'pack') {
    if (!options.source) throw new Error(`pack requires --source.\n${usage()}`)
    const result = await packDshPlugin({
      source: options.source,
      output: options.output,
      outDir: options['out-dir'],
      signingKeyPath: options.key,
      keyId: options['key-id'],
      publisherId: options['publisher-id']
    })
    if (options.catalog) {
      result.catalogPath = await mergeCatalog(options.catalog, result.catalogEntry)
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'verify') {
    if (!options.artifact) throw new Error(`verify requires --artifact.\n${usage()}`)
    const result = await verifyArtifact(options.artifact, options.keyring)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'keygen') {
    const result = await generatePublisherKeypair({
      outDir: options.out,
      keyId: options['key-id'],
      publisherId: options['publisher-id']
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error(`Unknown command ${command}.\n${usage()}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}