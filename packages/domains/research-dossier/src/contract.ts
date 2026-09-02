import { z } from 'zod'

import type { DomainWorkbenchRightPanelActivation } from '@sciforge/domain-sdk/host'

export const RESEARCH_DOSSIER_RIGHT_PANEL_CONTRIBUTION_ID =
  'research-dossier.workbench-right-panel' as const

export const researchDossierPageSchema = z.enum([
  'overview',
  'versions',
  'reproduction'
])

export const researchDossierTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('artifact-version'),
    versionId: z.string().trim().min(1).max(512)
  }).strict(),
  z.object({
    kind: z.literal('compute-run'),
    runId: z.string().trim().min(1).max(512)
  }).strict()
])

export const researchDossierActivationPayloadV1Schema = z.object({
  contractVersion: z.literal(1),
  target: researchDossierTargetV1Schema,
  page: researchDossierPageSchema.default('overview'),
  expectedDigest: z.string().trim().toLowerCase()
    .regex(/^sha256:[0-9a-f]{64}$/u)
    .optional()
}).strict()

export type ResearchDossierPage = z.infer<typeof researchDossierPageSchema>
export type ResearchDossierTargetV1 = z.infer<typeof researchDossierTargetV1Schema>
export type ResearchDossierActivationPayloadV1 = z.infer<
  typeof researchDossierActivationPayloadV1Schema
>

export function createResearchDossierActivation(
  target: ResearchDossierTargetV1,
  options: Readonly<{
    page?: ResearchDossierPage
    expectedDigest?: string
    revision?: number
  }> = {}
): DomainWorkbenchRightPanelActivation {
  const payload = researchDossierActivationPayloadV1Schema.parse({
    contractVersion: 1,
    target,
    page: options.page ?? 'overview',
    ...(options.expectedDigest ? { expectedDigest: options.expectedDigest } : {})
  })
  return Object.freeze({
    contributionId: RESEARCH_DOSSIER_RIGHT_PANEL_CONTRIBUTION_ID,
    revision: options.revision ?? 1,
    payload
  })
}

export function moveResearchDossierActivationToPage(
  current: ResearchDossierActivationPayloadV1,
  page: ResearchDossierPage,
  revision: number
): DomainWorkbenchRightPanelActivation {
  const parsed = researchDossierActivationPayloadV1Schema.parse(current)
  return createResearchDossierActivation(parsed.target, {
    page,
    revision,
    ...(parsed.expectedDigest ? { expectedDigest: parsed.expectedDigest } : {})
  })
}
