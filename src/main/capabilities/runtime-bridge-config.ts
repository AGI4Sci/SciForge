import { CAPABILITY_RUNTIME_BRIDGE_SERVER_ID } from '../local-runtime-package-contract'
import type { CapabilityRuntimeBridgeLaunchConfig } from './runtime-bridge'

export { CAPABILITY_RUNTIME_BRIDGE_SERVER_ID }

export function buildCapabilityRuntimeBridgeLocalRuntimeMcpServerConfig(
  launch: CapabilityRuntimeBridgeLaunchConfig
): Record<string, unknown> {
  return {
    enabled: true,
    transport: 'file-bridge',
    rootDir: launch.rootDir,
    authSecret: launch.authSecret,
    trustScope: 'user',
    timeoutMs: launch.timeoutMs
  }
}
