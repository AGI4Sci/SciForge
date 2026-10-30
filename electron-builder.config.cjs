const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const deploymentConfigurationPackaging = require(
  './scripts/domain-package-deployment-config.cjs'
)
const afterPackPackaging = require('./scripts/after-pack.cjs')
const publicReleaseArtifactReceipt = require(
  './scripts/public-release-artifact-receipt.cjs'
)
const stage4ArtifactReceipt = require('./scripts/stage4-artifact-receipt.cjs')
const { internalRuntimeComposition } = require('./scripts/internal-runtime-packaging.cjs')
const releaseWorkerManifest = require('./scripts/release-worker-manifest.cjs')

/**
 * The installed-plugin runner imports the official DSH runtime packages, and the
 * Host reads the runtime version from them. electron-builder prunes node_modules
 * down to the application's own dependency tree, and these packages belong to the
 * plugin SDK workspace, so they travel as explicit file sets — the same mechanism
 * the bundled worker packages use. The dependency closure is walked here so a new
 * runtime dependency cannot silently go missing from the package.
 */
function dshRuntimeFileSets() {
  const nodeModules = join(__dirname, 'node_modules')
  const scope = '@deepseek-ai'
  const alreadyPacked = new Set(['zod'])
  const packages = new Set()
  const visit = (packageName) => {
    if (packages.has(packageName) || alreadyPacked.has(packageName)) return
    const manifestPath = join(nodeModules, packageName, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`Plugin runtime dependency is missing: ${packageName}`)
    }
    packages.add(packageName)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const dependency of Object.keys(manifest.dependencies || {}).sort()) visit(dependency)
  }
  for (const entry of readdirSync(join(nodeModules, scope)).sort()) visit(`${scope}/${entry}`)
  return [...packages].sort().map((packageName) => ({
    from: join('node_modules', packageName),
    to: join('node_modules', packageName),
    filter: ['**/*', '**/.*']
  }))
}

function loadLocalReleaseEnv() {
  const candidates = [
    process.env.SCIFORGE_RELEASE_ENV,
    process.env.DEEPSEEK_GUI_RELEASE_ENV,
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const deploymentConfigurationComposition =
  deploymentConfigurationPackaging.createDomainPackageDeploymentConfigurationComposition(
    __dirname
  )
const publicReleaseArtifactHooks =
  publicReleaseArtifactReceipt.createPublicReleaseArtifactHooks({
    afterPack: afterPackPackaging.createAfterPackHook({
      deploymentConfigurationComposition
    }),
    projectRoot: __dirname,
    internalRuntimeComposition,
    deploymentConfigurationComposition
  })
const stage4BuildIdentity = stage4ArtifactReceipt.readConfiguredStage4BuildIdentity(__dirname)
const stage4ArtifactHooks = stage4ArtifactReceipt.createStage4ArtifactHooks({
  afterPack: publicReleaseArtifactHooks.afterPack,
  projectRoot: __dirname,
  internalRuntimeComposition,
  deploymentConfigurationComposition
})

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://sciforge.ai/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'sciforge')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(
  process.env.SCIFORGE_UPDATE_CHANNEL || process.env.DEEPSEEK_GUI_UPDATE_CHANNEL || 'stable'
)
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  process.env.SCIFORGE_APP_VERSION ||
  process.env.DEEPSEEK_GUI_APP_VERSION ||
  ''
).trim()
const packageMetadata = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf8')
)
const packageAppVersion = String(packageMetadata.version || '').trim()
const applicationVersion = releaseAppVersion || packageAppVersion
const officialExtensionKeysFile = (
  process.env.SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE || ''
).trim()

if (officialExtensionKeysFile && !existsSync(officialExtensionKeysFile)) {
  throw new Error(
    `SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE does not exist: ${officialExtensionKeysFile}`
  )
}

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`SCIFORGE_UPDATE_CHANNEL must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `SCIFORGE_APP_VERSION must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}
if (!/^\d+\.\d+\.\d+$/.test(applicationVersion)) {
  throw new Error(
    `Electron Builder application version must be a valid x.y.z semver, got: ${applicationVersion}`
  )
}

module.exports = {
  appId: 'com.xingyuzhong.sciforge',
  productName: 'SciForge',
  toolsets: {
    // The modern runtime also emits an AppRun that resolves its extracted root
    // from the launcher path, so APPIMAGE_EXTRACT_AND_RUN works without APPDIR.
    appimage: '1.0.2'
  },
  asar: true,
  asarUnpack: [
    ...releaseWorkerManifest.createAsarUnpackGlobs(),
    '**/node_modules/@napi-rs/canvas-*/**/*',
    '**/node_modules/node-pty/**/*',
    '**/node_modules/proxy-from-env/**/*',
    '**/node_modules/zod/**/*',
  ],
  beforePack: './scripts/before-pack.cjs',
  npmRebuild: true,
  directories: {
    output: process.env.SCIFORGE_DIST_DIR || process.env.DEEPSEEK_GUI_DIST_DIR || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    ...dshRuntimeFileSets(),
    'node_modules/playwright-core/**/*',
    'node_modules/zod/**/*',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*',
    ...releaseWorkerManifest.createBundledFileSets()
  ],
  extraResources: [
    // Optional release-owned self-contained DSH closure. Absence keeps the app
    // usable with other runtimes; DSH discovery still requires its compiled pin.
    ...(existsSync(join(__dirname, 'packages/workers/dsh-runtime/artifacts'))
      ? [{ from: 'packages/workers/dsh-runtime/artifacts', to: 'agent-runtimes/dsh' }]
      : []),
    ...internalRuntimeComposition.extraResources,
    ...deploymentConfigurationComposition.extraResources,
    { from: 'LICENSE', to: 'compliance/LICENSE' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'compliance/THIRD_PARTY_NOTICES.md' },
    // The official plugin catalog travels with the app: with no explicit index
    // configured the market reads <resources>/market/index.json and resolves the
    // artifacts next to it, so an installed build can show and install its own
    // plugins. Nothing is bundled when the catalog has not been generated.
    ...(existsSync(join(__dirname, 'market/index.json'))
      ? [{ from: 'market/index.json', to: 'market/index.json' }]
      : []),
    ...(existsSync(join(__dirname, 'market/artifacts'))
      ? [{ from: 'market/artifacts', to: 'market/artifacts' }]
      : []),
    { from: 'src/asset/img/README.md', to: 'compliance/ASSET_PROVENANCE.md' },
    {
      from: 'packages/workers/workspace-host/artifacts/workspace-host',
      to: 'workspace-host'
    },
    ...(officialExtensionKeysFile
      ? [{
          from: officialExtensionKeysFile,
          to: 'extensions/official-keys.json'
        }]
      : [])
  ],
  artifactName: `SciForge-${applicationVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: genericUpdateUrl
    }
  ],
  afterPack: stage4ArtifactHooks.afterPack,
  afterAllArtifactBuild: async (buildResult) => [
    ...await publicReleaseArtifactHooks.afterAllArtifactBuild(buildResult),
    ...await stage4ArtifactHooks.afterAllArtifactBuild(buildResult)
  ],
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    icon: './src/asset/img/sciforge.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    icon: './src/asset/img/sciforge.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'SciForge',
    uninstallDisplayName: 'SciForge',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/sciforge.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    version: applicationVersion,
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    },
    ...(stage4BuildIdentity ? { sciforgeStage4Build: stage4BuildIdentity } : {})
  }
}
