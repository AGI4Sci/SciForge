import { z } from 'zod'
import { principalIdentityVersionSchema } from '@sciforge/domain-sdk/principal'

export const IDENTITY_CAPABILITY_IDS = Object.freeze({
  inspect: 'identity.local.inspect',
  listAccounts: 'identity.local.list-accounts',
  createAccount: 'identity.local.create-account',
  selectAccount: 'identity.local.select-account',
  renameAccount: 'identity.local.rename-account',
  exitAccount: 'identity.local.exit-account',
  dismissFirstPrompt: 'identity.local.dismiss-first-prompt',
  backupAndReset: 'identity.local.backup-and-reset'
} as const)

export const IDENTITY_RESET_CONFIRMATION = 'RESET LOCAL IDENTITY' as const
export const IDENTITY_PRINCIPAL_AUTHORITY = 'sciforge.identity-access' as const
export const IDENTITY_ACCOUNT_COMMAND_ID = 'identity-access.open-account' as const
export const IDENTITY_ACCOUNT_OVERLAY_ID = 'identity-access.account-overlay' as const
export const MAX_LOCAL_ACCOUNTS = 1_024

const cloudOpaqueSuffix = '[A-Za-z0-9](?:[A-Za-z0-9_]{10,62}[A-Za-z0-9])'
const cloudOpaqueId = (prefix: string): z.ZodString =>
  z.string().regex(new RegExp(`^${prefix}_${cloudOpaqueSuffix}$`, 'u'))

export const localCloudIdentityLinkSchema = z.object({
  cloudUserId: cloudOpaqueId('usr'),
  oidcIdentityId: cloudOpaqueId('oid'),
  issuer: z.string().url().max(2_048),
  subject: z.string().min(1).max(512),
  deviceId: cloudOpaqueId('dev').optional(),
  deviceStatus: z.enum(['active', 'revoked']).optional()
}).strict().readonly()

export const localAccountSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(1).max(64),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  cloudIdentity: localCloudIdentityLinkSchema.optional()
}).strict().readonly()

export const identityUnavailableReasonSchema = z.enum([
  'open-failed',
  'integrity-failed',
  'migration-failed'
])

export const identityAvailableStateSchema = z.object({
  status: z.literal('available'),
  identityVersion: principalIdentityVersionSchema,
  currentAccount: localAccountSchema.nullable(),
  accountCount: z.number().int().nonnegative().max(MAX_LOCAL_ACCOUNTS),
  firstPromptDismissed: z.boolean()
}).strict().readonly()

export const identityUnavailableStateSchema = z.object({
  status: z.literal('unavailable'),
  reason: identityUnavailableReasonSchema,
  recoveryAvailable: z.boolean()
}).strict().readonly()

export const identityUiStateSchema = z.discriminatedUnion('status', [
  identityAvailableStateSchema,
  identityUnavailableStateSchema
])

export const identityListAccountsOutputSchema = z.object({
  state: identityUiStateSchema,
  accounts: z.array(localAccountSchema).max(MAX_LOCAL_ACCOUNTS)
}).strict().readonly()

export const usernameInputSchema = z.object({
  username: z.string().max(512)
}).strict()

export const accountSelectionInputSchema = z.object({
  userId: z.string().uuid()
}).strict()

export const accountRenameInputSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().max(512)
}).strict()

export const emptyIdentityInputSchema = z.object({}).strict()

export const identityBackupAndResetInputSchema = z.object({
  secondConfirmation: z.literal(IDENTITY_RESET_CONFIRMATION)
}).strict()

export const identityBackupAndResetOutputSchema = z.object({
  state: identityAvailableStateSchema,
  backupPath: z.string().min(1).max(4_096)
}).strict().readonly()

export type LocalAccount = z.infer<typeof localAccountSchema>
export type LocalCloudIdentityLink = z.infer<typeof localCloudIdentityLinkSchema>
export type IdentityAvailableState = z.infer<typeof identityAvailableStateSchema>
export type IdentityUnavailableState = z.infer<typeof identityUnavailableStateSchema>
export type IdentityUiState = z.infer<typeof identityUiStateSchema>
export type IdentityListAccountsOutput = z.infer<typeof identityListAccountsOutputSchema>

export type NormalizedUsername = Readonly<{
  username: string
  usernameKey: string
}>

export class IdentityValidationError extends Error {
  readonly code: 'invalid-username' | 'username-conflict' | 'account-not-found' |
    'account-capacity-exceeded' | 'identity-version-exhausted' |
    'identity-unavailable' | 'reset-not-confirmed' | 'backup-failed'

  constructor(code: IdentityValidationError['code'], message: string) {
    super(message)
    this.name = 'IdentityValidationError'
    this.code = code
  }
}

export function normalizeUsername(rawUsername: string): NormalizedUsername {
  const username = rawUsername.normalize('NFC').trim()
  const length = Array.from(username).length
  if (length < 1 || length > 64 || !/^[\p{L}\p{N} _-]+$/u.test(username)) {
    throw new IdentityValidationError(
      'invalid-username',
      'Username must contain 1-64 letters, numbers, spaces, hyphens, or underscores.'
    )
  }
  return Object.freeze({
    username,
    usernameKey: username.toLowerCase().normalize('NFC')
  })
}
