import { isAbsolute, join, resolve } from 'node:path'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitResultV1,
  ArtifactVersionReadInputV1,
  ArtifactVersionReadResultV1
} from '@sciforge/domain-artifact-versions/contract'
import { VISUAL_REVIEW_CAPABILITY_IDS } from './contract.js'
import {
  createVisualReviewCapabilityFactory,
  createVisualReviewService,
  type VisualReviewCapabilityOptions
} from './main.js'

export type VisualReviewArtifactPort = Readonly<{
  commit(input: ArtifactVersionCommitInputV1, workspaceRoot: string): Promise<ArtifactVersionCommitResultV1>
  read(input: ArtifactVersionReadInputV1, workspaceRoot: string): Promise<ArtifactVersionReadResultV1>
}>
export type VisualReviewCapabilityDefinition = VisualReviewCapabilityOptions
export type VisualReviewOperations = Readonly<{
  capabilityIds: readonly string[]
  definitions(): readonly VisualReviewCapabilityDefinition[]
  dataRoot(workspaceRoot: string): string
  invoke(capabilityId: string, input: unknown, workspaceRoot: string): Promise<unknown>
}>

/** Validates an already host-bound caller workspace; never resolves child cwd. */
export function visualReviewWorkspaceRoot(workspaceRoot: string): string {
  if (typeof workspaceRoot !== 'string') throw new Error('workspaceRoot must be a string.')
  const value = workspaceRoot.trim()
  if (!value) throw new Error('workspaceRoot is required.')
  if (value.length > 4_096) throw new Error('workspaceRoot is too long.')
  if (value.includes('\0')) throw new Error('workspaceRoot must not contain NUL bytes.')
  if (!isAbsolute(value)) throw new Error('workspaceRoot must be an absolute path.')
  return resolve(value)
}
export function visualReviewDataRoot(workspaceRoot: string): string {
  return join(visualReviewWorkspaceRoot(workspaceRoot), '.sciforge')
}
export function visualReviewDocumentsRoot(workspaceRoot: string): string {
  return join(visualReviewDataRoot(workspaceRoot), 'visual-documents')
}

/** One parse → canonical handler → output parse path for review tools. */
export function createVisualReviewOperations(
  options: Readonly<{ artifacts?: VisualReviewArtifactPort }> = {}
): VisualReviewOperations {
  const service = createVisualReviewService()
  const artifacts = options.artifacts
  const definitions = createVisualReviewCapabilityFactory({
    defineCapability: (definition) => definition,
    getService: () => service,
    ...(artifacts ? {
      commitArtifactVersion: artifacts.commit,
      readArtifactVersion: artifacts.read
    } : {})
  }).createDefinitions()
  return Object.freeze({
    capabilityIds: Object.freeze(Object.values(VISUAL_REVIEW_CAPABILITY_IDS)),
    definitions: () => definitions,
    dataRoot: visualReviewDataRoot,
    async invoke(capabilityId: string, input: unknown, workspaceRoot: string): Promise<unknown> {
      const callerWorkspaceId = visualReviewWorkspaceRoot(workspaceRoot)
      const definition = definitions.find((candidate) => candidate.id === capabilityId)
      if (!definition) throw new Error(`Unknown Visual Review capability: ${capabilityId}`)
      const parsed = definition.inputSchema.parse(input)
      const result = await definition.handler(parsed, { caller: { workspaceId: callerWorkspaceId } })
      return definition.outputSchema.parse(result.output)
    }
  })
}
