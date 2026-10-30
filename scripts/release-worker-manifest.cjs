const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, relative, resolve, sep } = require('node:path')

const BUNDLED_FILE_FILTER = [
  '**/*',
  '**/.*',
  '!**/__pycache__/**/*',
  '!**/*.pyc',
  '!**/*.pyo'
]
const BUILT_RUNTIME_UNPACK_GLOBS = ['**/out/main/**/*']
const PROJECT_ROOT = resolve(__dirname, '..')
const SCOPED_PACKAGE_NAME_PATTERN =
  /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/

const BUILTIN_PACKAGE_DEFINITIONS = {
  fullTrace: {
    dir: 'packages/full-trace',
    bundleTo: 'node_modules/@sciforge/full-trace',
    filter: [
      'package.json',
      'dist/*.js'
    ]
  },
  modelRouter: {
    dir: 'packages/workers/model-router'
  },
  planGateway: {
    dir: 'packages/workers/plan-gateway'
  },
  schedule: {
    dir: 'packages/workers/schedule'
  },
  search: {
    dir: 'packages/workers/search'
  },
  workspaceIntel: {
    dir: 'packages/workers/workspace-intel'
  },
  workspaceEgress: {
    dir: 'packages/workers/workspace-egress',
    bundleTo: 'node_modules/@sciforge/workspace-egress'
  },
  writeAssist: {
    dir: 'packages/workers/write-assist'
  },
  sciModalityRouter: {
    dir: 'packages/workers/sci-modality-router'
  },
  runtimeInspector: {
    dir: 'packages/workers/runtime-inspector'
  },
  scientificPlotting: {
    dir: 'packages/workers/scientific-plotting'
  },
  bgcDiscovery: {
    dir: 'packages/workers/bgc-discovery'
  },
  imageGeneration: {
    dir: 'packages/workers/image-generation'
  },
  multiAgent: {
    dir: 'packages/workers/multi-agent'
  },
  pptMaster: {
    dir: 'packages/workers/ppt-master'
  },
  guiOwlComputerUse: {
    dir: 'packages/workers/gui-owl-computer-use'
  }
}

function discoverBundledDomainPackages(projectRoot = PROJECT_ROOT) {
  const domainsRoot = join(projectRoot, 'packages', 'domains')
  if (!existsSync(domainsRoot)) return Object.freeze([])

  const installed = readdirSync(domainsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageRoot = join(domainsRoot, entry.name)
      const manifestPath = join(packageRoot, 'sciforge.domain.json')
      if (!existsSync(manifestPath)) return null
      const manifest = parseJsonFile(manifestPath)
      const packageName = requiredString(
        manifest.packageName,
        `${relative(projectRoot, manifestPath)} packageName`
      )
      if (!SCOPED_PACKAGE_NAME_PATTERN.test(packageName)) {
        throw new Error(
          `${relative(projectRoot, manifestPath)} packageName must be a scoped lowercase name.`
        )
      }
      const module = requiredRecord(
        manifest.module,
        `${relative(projectRoot, manifestPath)} module`
      )
      const packaging = manifest.packaging
      if (packaging === undefined) {
        return Object.freeze({ packageName, manifest, packageRoot, packaging: null })
      }
      const packagingRecord = requiredRecord(
        packaging,
        `${relative(projectRoot, manifestPath)} packaging`
      )
      if (typeof packagingRecord.bundled !== 'boolean') {
        throw new Error(
          `${relative(projectRoot, manifestPath)} packaging.bundled must be a boolean.`
        )
      }
      if (!packagingRecord.bundled) {
        return Object.freeze({ packageName, manifest, packageRoot, packaging: null })
      }
      const runtime = packagingRecord.runtime === undefined
        ? {}
        : requiredRecord(
            packagingRecord.runtime,
            `${relative(projectRoot, manifestPath)} packaging.runtime`
          )
      const requiredPaths = readStringArray(
        runtime.requiredPaths,
        `${relative(projectRoot, manifestPath)} packaging.runtime.requiredPaths`
      )
      const dependencies = readStringArray(
        runtime.dependencies,
        `${relative(projectRoot, manifestPath)} packaging.runtime.dependencies`
      )
      for (const requiredPath of requiredPaths) {
        validatePackageRelativePath(requiredPath, packageName)
      }
      if (new Set(requiredPaths).size !== requiredPaths.length) {
        throw new Error(`Domain package ${packageName} has duplicate runtime required paths.`)
      }
      if (requiredPaths.includes('package.json') ||
          requiredPaths.includes('sciforge.domain.json')) {
        throw new Error(
          `Domain package ${packageName} runtime paths must not repeat package metadata files.`
        )
      }
      if (new Set(dependencies).size !== dependencies.length) {
        throw new Error(`Domain package ${packageName} has duplicate runtime dependencies.`)
      }
      if (dependencies.some((dependency) => !SCOPED_PACKAGE_NAME_PATTERN.test(dependency))) {
        throw new Error(`Domain package ${packageName} has an invalid runtime dependency name.`)
      }
      if (dependencies.includes(packageName)) {
        throw new Error(`Domain package ${packageName} cannot depend on itself at runtime.`)
      }
      const packageJsonPath = join(packageRoot, 'package.json')
      if (!existsSync(packageJsonPath)) {
        throw new Error(`Bundled domain package ${packageName} is missing package.json.`)
      }
      const packageJson = parseJsonFile(packageJsonPath)
      if (packageJson.name !== packageName) {
        throw new Error(`Bundled domain package ${packageName} package.json name does not match.`)
      }
      for (const requiredPath of requiredPaths) {
        if (!existsSync(join(packageRoot, ...requiredPath.split('/')))) {
          throw new Error(
            `Bundled domain package ${packageName} is missing runtime path ${requiredPath}.`
          )
        }
      }
      return Object.freeze({
        packageName,
        moduleId: requiredString(
          module.id,
          `${relative(projectRoot, manifestPath)} module.id`
        ),
        displayName: requiredString(
          module.displayName,
          `${relative(projectRoot, manifestPath)} module.displayName`
        ),
        packageRoot,
        packageDir: relative(projectRoot, packageRoot).split(sep).join('/'),
        bundleTo: `node_modules/${packageName}`,
        dependencies: Object.freeze(dependencies),
        requiredRelativePaths: Object.freeze([
          'package.json',
          'sciforge.domain.json',
          ...requiredPaths
        ]),
        packaging: packagingRecord
      })
    })
    .filter(Boolean)

  const packageByName = new Map(installed.map((candidate) => [candidate.packageName, candidate]))
  const bundled = installed.filter((candidate) => candidate.packaging !== null)
  for (const candidate of bundled) {
    for (const dependency of candidate.dependencies) {
      const resolved = packageByName.get(dependency)
      if (!resolved) {
        throw new Error(
          `Bundled domain package ${candidate.packageName} depends on uninstalled domain ${dependency}.`
        )
      }
      if (resolved.packaging === null) {
        throw new Error(
          `Bundled domain package ${candidate.packageName} depends on non-bundled domain ${dependency}.`
        )
      }
    }
  }
  return Object.freeze(sortDomainPackagesByDependencies(bundled))
}

function createDomainReleaseComposition(projectRoot = PROJECT_ROOT) {
  const packages = discoverBundledDomainPackages(projectRoot)
  const moduleIds = new Set()
  const requiredPathExports = new Set()
  for (const candidate of packages) {
    if (moduleIds.has(candidate.moduleId)) {
      throw new Error(`Duplicate bundled domain module ID: ${candidate.moduleId}`)
    }
    moduleIds.add(candidate.moduleId)
    const exportName = runtimeRequiredPathsExportName(candidate.moduleId)
    if (requiredPathExports.has(exportName)) {
      throw new Error(`Duplicate bundled domain runtime export name: ${exportName}`)
    }
    requiredPathExports.add(exportName)
  }
  const packageDefinitions = Object.freeze(Object.fromEntries(packages.map((candidate) => [
    candidate.packageName,
    Object.freeze({
      dir: candidate.packageDir,
      bundleTo: candidate.bundleTo
    })
  ])))
  const runtimeEntries = Object.freeze(packages.map((candidate) => Object.freeze({
    id: candidate.moduleId,
    label: candidate.displayName,
    packageIds: Object.freeze([candidate.packageName, ...candidate.dependencies]),
    requiredPathsExport: runtimeRequiredPathsExportName(candidate.moduleId),
    requiredPaths: Object.freeze(candidate.requiredRelativePaths.map(
      (requiredPath) => `${candidate.bundleTo}/${requiredPath}`
    ))
  })))
  const packageDirs = Object.freeze(packages.map((candidate) => candidate.packageDir))
  const bundleTargets = Object.freeze(packages.map((candidate) => candidate.bundleTo))
  return Object.freeze({
    packages,
    packageDefinitions,
    packageDirs,
    bundleTargets,
    runtimeEntries,
    bundledFileSets: Object.freeze(packages.map((candidate) => Object.freeze({
      from: candidate.packageDir,
      to: candidate.bundleTo,
      filter: Object.freeze([...BUNDLED_FILE_FILTER])
    }))),
    asarUnpackGlobs: Object.freeze([
      ...packageDirs.map((packageDirectory) => `**/${packageDirectory}/**/*`),
      ...bundleTargets.map((packageDirectory) => `**/${packageDirectory}/**/*`)
    ])
  })
}

function runtimeRequiredPathsExportName(moduleId) {
  return `${moduleId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_RUNTIME_REQUIRED_PATHS`
}

function sortDomainPackagesByDependencies(packages) {
  const packageByName = new Map(packages.map((candidate) => [candidate.packageName, candidate]))
  const visiting = new Set()
  const visited = new Set()
  const sorted = []
  const visit = (candidate) => {
    if (visited.has(candidate.packageName)) return
    if (visiting.has(candidate.packageName)) {
      throw new Error(`Bundled domain runtime dependency cycle includes ${candidate.packageName}.`)
    }
    visiting.add(candidate.packageName)
    for (const dependency of [...candidate.dependencies].sort()) {
      visit(packageByName.get(dependency))
    }
    visiting.delete(candidate.packageName)
    visited.add(candidate.packageName)
    sorted.push(candidate)
  }
  for (const candidate of [...packages].sort((left, right) =>
    left.packageName.localeCompare(right.packageName)
  )) {
    visit(candidate)
  }
  return sorted
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
  }
}

function requiredRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function readStringArray(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((candidate) =>
    typeof candidate !== 'string' || !candidate.trim()
  )) {
    throw new Error(`${label} must be an array of non-empty strings.`)
  }
  return value.map((candidate) => candidate.trim())
}

function validatePackageRelativePath(value, packageName) {
  const parts = value.split('/')
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(
      `Domain package ${packageName} runtime path must be package-relative: ${value}`
    )
  }
}

const DOMAIN_RELEASE_COMPOSITION = createDomainReleaseComposition()
const PACKAGE_DEFINITIONS = Object.freeze({
  ...BUILTIN_PACKAGE_DEFINITIONS,
  ...DOMAIN_RELEASE_COMPOSITION.packageDefinitions
})

const WORKSPACE_PACKAGE_IDS = [
  'fullTrace',
  'modelRouter',
  'planGateway',
  'schedule',
  'search',
  'workspaceEgress',
  'workspaceIntel',
  'writeAssist',
  'sciModalityRouter',
  'runtimeInspector',
  'scientificPlotting',
  'bgcDiscovery',
  'imageGeneration',
  'multiAgent',
  'pptMaster'
]

const BUNDLED_PACKAGE_IDS = [
  'fullTrace',
  'modelRouter',
  'planGateway',
  'schedule',
  'search',
  'workspaceEgress',
  'workspaceIntel',
  'writeAssist',
  'runtimeInspector',
  'scientificPlotting',
  'bgcDiscovery',
  'imageGeneration',
  'multiAgent',
  'pptMaster'
]

const NON_BUNDLED_PACKAGE_IDS = [
  'sciModalityRouter',
  'guiOwlComputerUse'
]

function packageDir(packageId) {
  const definition = PACKAGE_DEFINITIONS[packageId]
  if (!definition) {
    throw new Error(`Unknown release package id: ${packageId}`)
  }
  return definition.dir
}

function packagePaths(packageId, relativePaths) {
  const dir = packageDir(packageId)
  return relativePaths.map((relativePath) => `${dir}/${relativePath}`)
}

function packageBundleDir(packageId) {
  const definition = PACKAGE_DEFINITIONS[packageId]
  if (!definition) {
    throw new Error(`Unknown release package id: ${packageId}`)
  }
  return definition.bundleTo || definition.dir
}

function bundledPackagePaths(packageId, relativePaths) {
  const dir = packageBundleDir(packageId)
  return relativePaths.map((relativePath) => `${dir}/${relativePath}`)
}

const RUNTIME_ENTRIES = [
  {
    id: 'full-trace',
    label: 'Full Trace',
    packageIds: ['fullTrace'],
    requiredPathsExport: 'FULL_TRACE_RUNTIME_REQUIRED_PATHS',
    requiredPaths: bundledPackagePaths('fullTrace', [
      'package.json',
      'dist/index.js',
      'dist/redaction.js',
      'dist/schema.js',
      'dist/store.js'
    ])
  },
  {
    id: 'model-router',
    label: 'Model Router',
    packageIds: ['modelRouter', 'fullTrace'],
    requiredPathsExport: 'MODEL_ROUTER_RUNTIME_REQUIRED_PATHS',
    requiredPaths: [
      ...packagePaths('modelRouter', [
        'package.json',
        'src/cli-options.ts',
        'src/cli.ts',
        'src/full-trace-recorder.ts',
        'src/full-trace-worker-sink.ts',
        'src/http-body.ts',
        'src/index.ts',
        'src/router.ts',
        'src/manifest.ts',
        'src/request-hygiene.ts',
        'src/response-compat.ts',
        'src/trace-correlation.ts',
        'src/trace-correlation/codex.ts',
        'src/trace-redaction.ts',
        'src/upstream-drivers.ts'
      ])
    ],
    executableNodeEntryPaths: [
      'out/main/model-router-sidecar-node-entry.js'
    ]
  },
  {
    id: 'plan-gateway',
    label: 'Plan Gateway',
    packageIds: ['planGateway', 'fullTrace'],
    requiredPathsExport: 'PLAN_GATEWAY_RUNTIME_REQUIRED_PATHS',
    requiredPaths: [
      ...packagePaths('planGateway', [
        'package.json',
        'src/adapters/index.ts',
        'src/cli-options.ts',
        'src/cli.ts',
        'src/gateway.ts',
        'src/contract.ts',
        'src/index.ts',
        'src/registry.ts',
        'src/network-policy.ts',
        'src/adapters/codex.ts',
        'src/manifest.ts',
        'src/trace-sink.ts'
      ]),
      'node_modules/proxy-from-env/package.json'
    ],
    executableNodeEntryPaths: [
      'out/main/plan-gateway-sidecar-node-entry.js'
    ]
  },
  {
    id: 'search',
    label: 'Search',
    packageIds: ['search'],
    requiredPathsExport: 'SEARCH_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('search', [
      'package.json',
      'src/mcp-server.ts',
      'src/research-service.ts',
      'src/types.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/research-search-mcp-node-entry.js'
    ]
  },
  {
    id: 'schedule',
    label: 'Schedule',
    packageIds: ['schedule'],
    requiredPathsExport: 'SCHEDULE_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('schedule', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/schedule-mcp-node-entry.js'
    ]
  },
  {
    id: 'workspace-intel',
    label: 'Workspace Intel',
    packageIds: ['workspaceIntel'],
    requiredPathsExport: 'WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('workspaceIntel', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/workspace-intel-mcp-node-entry.js'
    ]
  },
  {
    id: 'write-assist',
    label: 'Write Assist',
    packageIds: ['writeAssist'],
    requiredPathsExport: 'WRITE_ASSIST_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('writeAssist', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/write-assist-mcp-node-entry.js'
    ]
  },
  {
    id: 'runtime-inspector',
    label: 'Runtime Inspector',
    packageIds: ['runtimeInspector'],
    requiredPathsExport: 'RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('runtimeInspector', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/runtime-inspector-mcp-node-entry.js'
    ]
  },
  {
    id: 'scientific-plotting',
    label: 'Scientific Plotting',
    packageIds: ['scientificPlotting'],
    requiredPathsExport: 'SCIENTIFIC_PLOTTING_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('scientificPlotting', [
      'package.json',
      'src/scientific-plotting-mcp-server.ts',
      'src/scientific-skills-mcp-server.ts',
      'src/scientific-plotting-engine.ts',
      'src/scientific-skills-index.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/scientific-skills-mcp-node-entry.js',
      'out/main/scientific-plotting-mcp-node-entry.js'
    ]
  },
  {
    id: 'bgc-discovery',
    label: 'BGC Discovery',
    packageIds: ['bgcDiscovery'],
    requiredPathsExport: 'BGC_DISCOVERY_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('bgcDiscovery', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/bgc-discovery-mcp-node-entry.js'
    ]
  },
  {
    id: 'image-generation',
    label: 'Image Generation',
    packageIds: ['imageGeneration'],
    requiredPathsExport: 'IMAGE_GENERATION_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('imageGeneration', [
      'package.json',
      'src/mcp-server.ts',
      'src/image-generation-engine.ts',
      'src/contract.ts'
    ]),
    executableNodeEntryPaths: [
      'out/main/image-generation-mcp-node-entry.js'
    ]
  },
  {
    id: 'multi-agent',
    label: 'Multi Agent',
    packageIds: ['multiAgent'],
    requiredPathsExport: 'MULTI_AGENT_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('multiAgent', [
      'package.json',
      'dist/index.js',
      'dist/contract.js',
      'dist/runtime.js',
      'dist/store.js',
      'dist/delegate-task.js'
    ])
  },
  {
    id: 'ppt-master',
    label: 'PPT Master',
    packageIds: ['pptMaster'],
    requiredPathsExport: 'PPT_MASTER_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('pptMaster', [
      'package.json',
      'src/server.ts',
      'src/service.ts',
      'src/contract.ts',
      'ui-kit/sciforge_research/preset.json'
    ]),
    executableNodeEntryPaths: [
      'out/main/ppt-master-mcp-node-entry.js'
    ]
  }
]

const runtimeEntries = Object.freeze([
  ...RUNTIME_ENTRIES,
  ...DOMAIN_RELEASE_COMPOSITION.runtimeEntries
])
const workspacePackageDirs = Object.freeze([
  ...WORKSPACE_PACKAGE_IDS.map(packageDir),
  ...DOMAIN_RELEASE_COMPOSITION.packageDirs
])
const bundledPackageDirs = Object.freeze([
  ...BUNDLED_PACKAGE_IDS.map(packageDir),
  ...DOMAIN_RELEASE_COMPOSITION.packageDirs
])
const bundledPackageTargets = Object.freeze([
  ...BUNDLED_PACKAGE_IDS.map(packageBundleDir),
  ...DOMAIN_RELEASE_COMPOSITION.bundleTargets
])
const nonBundledPackageDirs = NON_BUNDLED_PACKAGE_IDS.map(packageDir)
const packagedExecutableNodeEntryRequiredPaths = [
  'out/main/codex-pre-tool-use-governance-node-entry.js',
  'out/main/domain-runtime-mcp-node-entry.js',
  ...runtimeEntries.flatMap((entry) => entry.executableNodeEntryPaths || [])
]
const runtimeRequiredPathExports = Object.fromEntries(
  runtimeEntries.map((entry) => [entry.requiredPathsExport, entry.requiredPaths])
)

function createBundledFileSet(packageId) {
  const definition = PACKAGE_DEFINITIONS[packageId]
  return {
    from: packageDir(packageId),
    to: packageBundleDir(packageId),
    filter: [...(definition.filter || BUNDLED_FILE_FILTER)]
  }
}

function createBundledFileSets() {
  return [
    ...BUNDLED_PACKAGE_IDS.map(createBundledFileSet),
    ...DOMAIN_RELEASE_COMPOSITION.bundledFileSets.map((fileSet) => ({
      ...fileSet,
      filter: [...fileSet.filter]
    }))
  ]
}

function createAsarUnpackGlobs() {
  return [
    ...BUILT_RUNTIME_UNPACK_GLOBS,
    // electron-builder applies asarUnpack matching to a FileSet's source path
    // before honoring its `to` remap. Include both sides so remapped packages
    // such as packages/full-trace -> node_modules/@sciforge/full-trace are
    // physically emitted under app.asar.unpacked.
    ...bundledPackageDirs.map((packageDirectory) => `**/${packageDirectory}/**/*`),
    ...bundledPackageTargets.map((packageDirectory) => `**/${packageDirectory}/**/*`)
  ]
}

module.exports = {
  BUNDLED_FILE_FILTER,
  BUILT_RUNTIME_UNPACK_GLOBS,
  PACKAGE_DEFINITIONS,
  workspacePackageDirs,
  bundledPackageDirs,
  bundledPackageTargets,
  nonBundledPackageDirs,
  runtimeEntries,
  packagedExecutableNodeEntryRequiredPaths,
  runtimeRequiredPathExports,
  discoverBundledDomainPackages,
  createDomainReleaseComposition,
  createAsarUnpackGlobs,
  createBundledFileSets
}
