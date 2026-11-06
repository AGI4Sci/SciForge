import { z } from 'zod'

export const CURRENT_USER_SERVICE_ID = 'sciforge.current-user-profile' as const
export const CURRENT_USER_CONTRACT_VERSION = '1.0.0' as const

/** Display attribution only. This service never supplies authentication material. */
export const currentUserProfileSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signed-out') }).strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
  z.object({ state: z.literal('signed-in'), userId: z.string().min(1).max(256),
    displayName: z.string().min(1).max(512) }).strict()
])
export type CurrentUserProfile = z.infer<typeof currentUserProfileSchema>
export type CurrentUserProfileService = Readonly<{ read(): CurrentUserProfile }>

export function createCurrentUserProfileService(readIdentity: () =>
  { state: 'signed-out' } | { state: 'signed-in'; user: { userId: string; displayName: string } } | undefined
): CurrentUserProfileService {
  return Object.freeze({ read: () => {
    const identity = readIdentity()
    if (!identity) return { state: 'unavailable' as const }
    if (identity.state === 'signed-out') return { state: 'signed-out' as const }
    return currentUserProfileSchema.parse({ state: 'signed-in',
      userId: identity.user.userId, displayName: identity.user.displayName })
  } })
}
