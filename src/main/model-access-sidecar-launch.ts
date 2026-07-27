import { join } from 'node:path'
import {
  ELECTRON_RUN_AS_NODE_ENV,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath
} from './managed-gui-mcp-config'

export type ModelAccessSidecarWorker = 'model-router' | 'plan-gateway'

type ModelAccessSidecarWorkerDefinition = {
  workspace: string
  nodeEntry: string
}

const WORKERS: Record<ModelAccessSidecarWorker, ModelAccessSidecarWorkerDefinition> = {
  'model-router': {
    workspace: '@sciforge/model-router',
    nodeEntry: 'out/main/model-router-sidecar-node-entry.js'
  },
  'plan-gateway': {
    workspace: '@sciforge/plan-gateway',
    nodeEntry: 'out/main/plan-gateway-sidecar-node-entry.js'
  }
}

export type ModelAccessSidecarProcessLaunch = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export function resolveModelAccessSidecarProcessLaunch(
  worker: ModelAccessSidecarWorker,
  workerArgs: readonly string[],
  options: {
    appRoot?: string
    resourcesPath?: string
    execPath?: string
    isPackaged?: boolean
    npmCommand?: string
    env?: NodeJS.ProcessEnv
  }
): ModelAccessSidecarProcessLaunch {
  const definition = WORKERS[worker]
  const env = { ...(options.env ?? process.env) }
  if (!options.isPackaged) {
    return {
      command: options.npmCommand ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm'),
      args: ['--workspace', definition.workspace, 'run', 'start', '--', ...workerArgs],
      cwd: options.appRoot ?? process.cwd(),
      env
    }
  }

  const unpackedAppRoot = join(
    options.resourcesPath ?? process.resourcesPath,
    'app.asar.unpacked'
  )
  const launch = {
    appPath: unpackedAppRoot,
    execPath: options.execPath ?? process.execPath,
    isPackaged: true
  }
  return {
    command: resolveManagedGuiMcpCommand(launch),
    args: [resolveManagedGuiMcpNodeEntryPath(launch, definition.nodeEntry), ...workerArgs],
    cwd: unpackedAppRoot,
    env: {
      ...env,
      ...ELECTRON_RUN_AS_NODE_ENV
    }
  }
}
