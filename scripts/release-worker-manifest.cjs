const BUNDLED_FILE_FILTER = [
  '**/*',
  '**/.*'
]

const PACKAGE_DEFINITIONS = {
  modelRouter: {
    dir: 'packages/workers/model-router'
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
  'modelRouter',
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
  'modelRouter',
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

const RUNTIME_ENTRIES = [
  {
    id: 'model-router',
    label: 'Model Router',
    packageIds: ['modelRouter'],
    requiredPathsExport: 'MODEL_ROUTER_RUNTIME_REQUIRED_PATHS',
    requiredPaths: packagePaths('modelRouter', [
      'package.json',
      'src/cli.ts',
      'src/router.ts',
      'src/manifest.ts',
      'tools/model-router-trace-audit.ts'
    ])
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
const nonBundledPackageDirs = NON_BUNDLED_PACKAGE_IDS.map(packageDir)
const mcpNodeEntryRequiredPaths = RUNTIME_ENTRIES.flatMap((entry) => entry.mcpNodeEntryPaths || [])
const runtimeRequiredPathExports = Object.fromEntries(
  RUNTIME_ENTRIES.map((entry) => [entry.requiredPathsExport, entry.requiredPaths])
)

function createBundledFileSet(packageDirectory) {
  return {
    from: packageDirectory,
    to: packageDirectory,
    filter: [...BUNDLED_FILE_FILTER]
  }
}

function createBundledFileSets() {
  return bundledPackageDirs.map(createBundledFileSet)
}

function createAsarUnpackGlobs() {
  return bundledPackageDirs.map((packageDirectory) => `**/${packageDirectory}/**/*`)
}

module.exports = {
  BUNDLED_FILE_FILTER,
  PACKAGE_DEFINITIONS,
  workspacePackageDirs,
  bundledPackageDirs,
  nonBundledPackageDirs,
  runtimeEntries: RUNTIME_ENTRIES,
  mcpNodeEntryRequiredPaths,
  runtimeRequiredPathExports,
  createAsarUnpackGlobs,
  createBundledFileSets
}
