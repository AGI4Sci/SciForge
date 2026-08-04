import {
  readWorkspaceHostArtifactManifest,
  resolveWorkspaceHostArtifactDirectory,
  verifyWorkspaceHostArtifact
} from '@sciforge/workspace-host/artifact'
import {
  workspaceHostArtifactManifestSchema,
  type WorkspaceHostArtifact
} from '@sciforge/domain-sdk/workspace-host'
import { resolve } from 'node:path'

export type ApplicationWorkspaceHostArtifactResolverOptions = Readonly<{
  baseDirectory: string
}>

export type ApplicationWorkspaceHostArtifactBaseOptions = Readonly<{
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}>

export function resolveApplicationWorkspaceHostArtifactBaseDirectory(
  options: ApplicationWorkspaceHostArtifactBaseOptions
): string {
  return options.isPackaged
    ? resolve(options.resourcesPath)
    : resolve(options.appPath, 'packages/workers/workspace-host/artifacts')
}

/**
 * Resolves and verifies the desktop cohort's public Workspace Host artifact.
 *
 * Packaging/source layout selection happens once in application composition;
 * domain packages receive only this public artifact contract.
 */
export async function resolveApplicationWorkspaceHostArtifact(
  options: ApplicationWorkspaceHostArtifactResolverOptions
): Promise<WorkspaceHostArtifact> {
  const baseDirectory = options.baseDirectory.trim()
  if (!baseDirectory) throw new Error('Workspace Host artifact base directory is required.')
  const directory = resolveWorkspaceHostArtifactDirectory(baseDirectory)
  const manifest = await readWorkspaceHostArtifactManifest(directory)
  await verifyWorkspaceHostArtifact({ directory, manifest })
  return Object.freeze({
    directory,
    manifest: workspaceHostArtifactManifestSchema.parse(manifest)
  })
}
