import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'

/**
 * Presentation-only shape for already materialized legacy formal-compute records.
 *
 * The current Scientific Compute package intentionally does not expose formal
 * run read/list APIs. These types must never be used to parse a controlled
 * script result or to promote an execution to formal provenance.
 */
export type LegacyComputeBreakpointV1 = Readonly<{
  code: string
  blocking: boolean
  message: string
}>

export type LegacyComputeRunRecordV1 = Readonly<{
  runId: string
  specRef: ArtifactVersionRefV1
  receiptRef?: ArtifactVersionRefV1
  state: string
  outcome: string
  control: string
  provenance: string
  replication: string
  evidence: string
  outputs: readonly Readonly<{
    outputId: string
    versionRef: ArtifactVersionRefV1
    quarantined: boolean
  }>[]
  breakpoints: readonly LegacyComputeBreakpointV1[]
  updatedAt: string
}>

export type LegacyComputeRunSpecV1 = Readonly<{
  runId: string
  code: ArtifactVersionRefV1
  environmentVersion: ArtifactVersionRefV1
  inputs: readonly Readonly<{
    name: string
    version: ArtifactVersionRefV1
    mountPath?: string
  }>[]
  parameters: unknown
  randomSeed?: number
  requestedControl: string
  resources: Readonly<Record<string, unknown>>
  eventScope?: Readonly<{ runtimeId: string; threadId: string }>
}>
