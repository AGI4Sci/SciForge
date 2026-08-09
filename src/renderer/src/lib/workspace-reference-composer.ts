import type { AgentRuntimeWorkspaceReference } from '../../../shared/agent-runtime-contract'
import type { ComposerFileReference } from './composer-file-references'

export function composerReferenceFromWorkspaceReference(
  reference: AgentRuntimeWorkspaceReference
): ComposerFileReference {
  const modelRouterObject = reference.kind === 'image' ||
    reference.kind === 'pdf' ||
    reference.mimeType?.toLocaleLowerCase() === 'application/pdf' ||
    reference.name.toLocaleLowerCase().endsWith('.pdf')
  return {
    path: reference.relativePath,
    relativePath: reference.relativePath,
    name: reference.name,
    workspaceRoot: reference.workspaceRoot,
    kind: reference.kind,
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    ...(modelRouterObject ? { modelRouterObject: true } : {})
  }
}
