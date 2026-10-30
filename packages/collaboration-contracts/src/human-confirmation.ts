import { z } from 'zod'
import { humanActionConfirmationSchema, workerDeliveryConfirmationTargetSchema } from './scientific-collaboration.js'
import { projectCompletionTargetSchema } from './project-review.js'

/** Typed context for the existing Device signer; the Host must authenticate its human action. */
export const deviceFactHumanConfirmationSchema = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('worker-delivery-review'),
    target: workerDeliveryConfirmationTargetSchema,
    action: humanActionConfirmationSchema
  }).strict(),
  z.object({
    purpose: z.literal('project-completion-approval'),
    target: projectCompletionTargetSchema,
    action: humanActionConfirmationSchema
  }).strict()
])
export type DeviceFactHumanConfirmation = z.infer<typeof deviceFactHumanConfirmationSchema>
