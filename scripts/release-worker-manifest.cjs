const BUNDLED_FILE_FILTER = [
  '**/*',
  '**/.*'
]
const BUILT_RUNTIME_UNPACK_GLOBS = ['**/out/main/**/*']

const PACKAGE_DEFINITIONS = {
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
  workflow: {
    dir: 'packages/workers/workflow'
  },
  workspaceIntel: {
    dir: 'packages/workers/workspace-intel'
  },
  writeAssist: {
    dir: 'packages/workers/write-assist'
  },
  paperRadar: {
    dir: 'packages/workers/paper-radar'
  },
  sciModalityRouter: {
    dir: 'packages/workers/sci-modality-router'
  },
  evidenceDag: {
    dir: 'packages/workers/evidence-dag'
  },
  projectDag: {
    dir: 'packages/workers/project-dag'
  },
  runtimeInspector: {
    dir: 'packages/workers/runtime-inspector'
  },
  remoteExecutor: {
    dir: 'packages/workers/remote-executor'
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
  visualDocument: {
    dir: 'packages/workers/visual-document'
  },
  guiOwlComputerUse: {
    dir: 'packages/workers/gui-owl-computer-use'
  }
}

const WORKSPACE_PACKAGE_IDS = [
  'fullTrace',
  'modelRouter',
  'planGateway',
  'schedule',
  'search',
  'workflow',
  'workspaceIntel',
  'writeAssist',
  'paperRadar',
  'sciModalityRouter',
  'evidenceDag',
  'projectDag',
  'runtimeInspector',
  'remoteExecutor',
  'scientificPlotting',
  'bgcDiscovery',
  'imageGeneration',
  'multiAgent',
  'pptMaster',
  'visualDocument'
]

const BUNDLED_PACKAGE_IDS = [
  'fullTrace',
  'modelRouter',
  'planGateway',
  'schedule',
  'search',
  'workflow',
  'workspaceIntel',
  'remoteExecutor',
  'writeAssist',
  'paperRadar',
  'runtimeInspector',
  'scientificPlotting',
  'bgcDiscovery',
  'imageGeneration',
  'multiAgent',
  'pptMaster',
  'visualDocument'
]

const NON_BUNDLED_PACKAGE_IDS = [
  'sciModalityRouter',
  'evidenceDag',
  'projectDag',
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
      ]),
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
      'node_modules/proxy-from-env/package.json',
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
    mcpNodeEntryPaths: [
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
    mcpNodeEntryPaths: [
      'out/main/schedule-mcp-node-entry.js'
    ]
  },
  {
    id: 'workflow',
    label: 'Workflow',
    packageIds: ['workflow'],
    requiredPathsExport: 'WORKFLOW_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('workflow', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts'
    ]),
    mcpNodeEntryPaths: [
      'out/main/workflow-mcp-node-entry.js'
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
    mcpNodeEntryPaths: [
      'out/main/workspace-intel-mcp-node-entry.js'
    ]
  },
  {
    id: 'remote-executor',
    label: 'Remote Executor',
    packageIds: ['remoteExecutor'],
    requiredPathsExport: 'REMOTE_EXECUTOR_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('remoteExecutor', [
      'package.json',
      'src/mcp-server.ts',
      'src/service.ts',
      'src/contract.ts',
      'remote_worker.py'
    ]),
    mcpNodeEntryPaths: [
      'out/main/remote-executor-mcp-node-entry.js'
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
    mcpNodeEntryPaths: [
      'out/main/write-assist-mcp-node-entry.js'
    ]
  },
  {
    id: 'paper-radar',
    label: 'Paper Radar',
    packageIds: ['paperRadar'],
    requiredPathsExport: 'PAPER_RADAR_RUNTIME_REQUIRED_PATHS',
    requiredPaths: [
      ...packagePaths('paperRadar', [
        'package.json',
        'src/mcp-server.ts',
        'src/service.ts',
        'src/contract.ts',
        'src/core/service.ts',
        'src/core/storage.ts',
        'src/core/profiles.ts',
        'src/core/ranker.ts',
        'src/core/sources.ts',
        'src/core/types.ts'
      ])
    ],
    mcpNodeEntryPaths: [
      'out/main/paper-radar-mcp-node-entry.js'
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
    mcpNodeEntryPaths: [
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
    mcpNodeEntryPaths: [
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
    mcpNodeEntryPaths: [
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
    mcpNodeEntryPaths: [
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
    mcpNodeEntryPaths: [
      'out/main/ppt-master-mcp-node-entry.js'
    ]
  },
  {
    id: 'visual-document',
    label: 'VisualDocument',
    packageIds: ['visualDocument'],
    requiredPathsExport: 'VISUAL_DOCUMENT_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('visualDocument', [
      'package.json',
      'src/visual-document-mcp-server.ts',
      'src/visual-document-engine.ts',
      'src/contract.ts'
    ]),
    mcpNodeEntryPaths: [
      'out/main/visual-document-mcp-node-entry.js'
    ]
  }
]

const workspacePackageDirs = WORKSPACE_PACKAGE_IDS.map(packageDir)
const bundledPackageDirs = BUNDLED_PACKAGE_IDS.map(packageDir)
const bundledPackageTargets = BUNDLED_PACKAGE_IDS.map(packageBundleDir)
const nonBundledPackageDirs = NON_BUNDLED_PACKAGE_IDS.map(packageDir)
const mcpNodeEntryRequiredPaths = RUNTIME_ENTRIES.flatMap((entry) => entry.mcpNodeEntryPaths || [])
const runtimeRequiredPathExports = Object.fromEntries(
  RUNTIME_ENTRIES.map((entry) => [entry.requiredPathsExport, entry.requiredPaths])
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
  return BUNDLED_PACKAGE_IDS.map(createBundledFileSet)
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
  runtimeEntries: RUNTIME_ENTRIES,
  mcpNodeEntryRequiredPaths,
  runtimeRequiredPathExports,
  createAsarUnpackGlobs,
  createBundledFileSets
}
