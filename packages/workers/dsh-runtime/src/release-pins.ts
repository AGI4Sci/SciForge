import type { DshDeploymentPin } from './trusted-deployment.js'
import { DSH_DARWIN_ARM64_PIN } from './release-darwin-arm64.js'

/** Release authority, bundled into the application, NOT an editable runtime profile.
 * The generated pin is produced only by the offline closure review and binds the
 * complete self-contained artifact, composed config, entry ids and plugin names. */
export const DSH_RELEASE_PINS: readonly Readonly<{
  platform: string
  arch: string
  pin: DshDeploymentPin
}>[] = Object.freeze([{ platform: 'darwin', arch: 'arm64', pin: DSH_DARWIN_ARM64_PIN }])
