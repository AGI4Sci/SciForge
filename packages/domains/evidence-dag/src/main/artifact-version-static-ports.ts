import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { ARTIFACT_VERSION_COMMIT_CONTRACT, ARTIFACT_VERSION_EVENT_LIST_CONTRACT, ARTIFACT_VERSION_READ_CONTRACT, type ArtifactVersionCommitInputV1, type ArtifactVersionCommitPortV1, type ArtifactVersionEventListPortV1, type ArtifactVersionReadInputV1, type ArtifactVersionReadPortV1 } from '@sciforge/domain-artifact-versions/contract'

export function artifactVersionCommitPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionCommitPortV1 {
  return Object.freeze({
    commit: (input: ArtifactVersionCommitInputV1) => context.capabilities.invoke(
      ARTIFACT_VERSION_COMMIT_CONTRACT,
      input,
      {
        workspaceId: workspaceRoot,
        idempotencyKey: input.idempotencyKey
      }
    )
  })
}

export function artifactVersionEventListPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionEventListPortV1 {
  return Object.freeze({
    listEvents: (input) => context.capabilities.invoke(
      ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}

export function artifactVersionReadPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionReadPortV1 {
  return Object.freeze({
    read: (input: ArtifactVersionReadInputV1) => context.capabilities.invoke(
      ARTIFACT_VERSION_READ_CONTRACT,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}
