import { join } from 'node:path'
import {
  ELECTRON_RUN_AS_NODE_ENV,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath
} from './managed-gui-mcp-config'

export type ModelAccessSidecarWorker = 'model-router' | 'plan-gateway'

type ModelAccessSidecarWorkerDefinition = {
  nodeEntry: string
}

const WORKERS: Record<ModelAccessSidecarWorker, ModelAccessSidecarWorkerDefinition> = {
  'model-router': {
    nodeEntry: 'out/main/model-router-sidecar-node-entry.js'
  },
  'plan-gateway': {
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
    nodeExecPath?: string
    env?: NodeJS.ProcessEnv
  }
): ModelAccessSidecarProcessLaunch {
  const definition = WORKERS[worker]
  const env = { ...(options.env ?? process.env) }
  if (!options.isPackaged) {
    const appRoot = options.appRoot ?? process.cwd()
    const nodeExecPath = options.nodeExecPath?.trim()
    const launch = {
      appPath: appRoot,
      execPath: options.execPath ?? process.execPath,
      isPackaged: false,
      ...(nodeExecPath ? { nodeExecPath } : {})
    }
    return {
      command: resolveManagedGuiMcpCommand(launch),
      args: [
        '--env-file-if-exists=.env',
        resolveManagedGuiMcpNodeEntryPath(launch, definition.nodeEntry),
        ...workerArgs
      ],
      cwd: appRoot,
      env: nodeExecPath ? env : { ...env, ...ELECTRON_RUN_AS_NODE_ENV }
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
