import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionListInputV1Schema,
  artifactVersionListResultV1Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeResultV1Schema,
  artifactVersionReadInputV1Schema,
  artifactVersionReadResultV1Schema,
  type ArtifactVersionListInputV1,
  type ArtifactVersionListV1,
  type ArtifactVersionMaterializeInputV1,
  type ArtifactVersionMaterializeReceiptV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadV1,
  type ArtifactVersionResultV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  SCIENTIFIC_PLOTTING_COMPARE_CONTRACT,
  SCIENTIFIC_PLOTTING_RERUN_CONTRACT,
  type ScientificPlottingCompareInput,
  type ScientificPlottingCompareResult,
  type ScientificPlottingRerunInput,
  type ScientificPlottingRerunResult
} from '../contract.js'

export const scientificPlottingRendererCapabilityContracts = Object.freeze({
  listArtifacts: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
    effect: 'read' as const,
    inputSchema: artifactVersionListInputV1Schema,
    outputSchema: artifactVersionListResultV1Schema
  },
  readArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
    effect: 'read' as const,
    inputSchema: artifactVersionReadInputV1Schema,
    outputSchema: artifactVersionReadResultV1Schema
  },
  materializeArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionMaterializeInputV1Schema,
    outputSchema: artifactVersionMaterializeResultV1Schema
  },
  rerun: SCIENTIFIC_PLOTTING_RERUN_CONTRACT,
  compare: SCIENTIFIC_PLOTTING_COMPARE_CONTRACT
})

export type ScientificPlottingCapabilityClient = Readonly<{
  listArtifactVersions(
    workspaceRoot: string,
    input?: ArtifactVersionListInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionListV1>>
  readArtifactVersion(
    workspaceRoot: string,
    input: ArtifactVersionReadInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionReadV1>>
  materializeArtifactVersion(
    workspaceRoot: string,
    input: ArtifactVersionMaterializeInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionMaterializeReceiptV1>>
  rerun(
    workspaceRoot: string,
    input: ScientificPlottingRerunInput
  ): Promise<ScientificPlottingRerunResult>
  compare(
    workspaceRoot: string,
    input: ScientificPlottingCompareInput
  ): Promise<ScientificPlottingCompareResult>
}>

export function createScientificPlottingCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ScientificPlottingCapabilityClient {
  return Object.freeze({
    listArtifactVersions: (workspaceRoot, input = {}) => invoker.invoke(
      scientificPlottingRendererCapabilityContracts.listArtifacts,
      input,
      { workspaceId: workspaceRoot }
    ),
    readArtifactVersion: (workspaceRoot, input) => invoker.invoke(
      scientificPlottingRendererCapabilityContracts.readArtifact,
      input,
      { workspaceId: workspaceRoot }
    ),
    materializeArtifactVersion: (workspaceRoot, input) => invoker.invoke(
      scientificPlottingRendererCapabilityContracts.materializeArtifact,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    rerun: (workspaceRoot, input) => invoker.invoke(
      scientificPlottingRendererCapabilityContracts.rerun,
      input,
      { workspaceId: workspaceRoot }
    ),
    compare: (workspaceRoot, input) => invoker.invoke(
      scientificPlottingRendererCapabilityContracts.compare,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}
