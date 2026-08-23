import { z } from 'zod'

import { OpenContentConnectorError } from '../contract.js'
import { openContentFolderIdSchema } from '../team-administration-contract.js'

const OPENCONTENT_FOLDER_INFO_PATH =
  '/flatsdk/api/services/DocList/GetFolderInfoById' as const

const providerEnvelopeSchema = z.object({
  result: z.number().int(),
  msg: z.string().max(2048).nullable().optional(),
  data: z.unknown().optional()
}).passthrough()

const providerFolderInfoSchema = z.object({
  id: openContentFolderIdSchema,
  folderGuid: z.string().trim().min(1).max(256),
  parentFolderId: z.number().int().nonnegative().safe(),
  folderType: z.number().int(),
  teamId: z.number().int().nonnegative().safe(),
  permission: z.number().int(),
  childFolderCount: z.number().int().nonnegative().safe(),
  childFileCount: z.number().int().nonnegative().safe()
}).passthrough()

type FolderInfoRequest = Readonly<{
  path: typeof OPENCONTENT_FOLDER_INFO_PATH
  body: Readonly<{
    token: string
    folderId: number
  }>
  signal?: AbortSignal
}>

export async function readOpenContentFolderInfo(input: Readonly<{
  token: string
  folderId: number
  signal?: AbortSignal
  request(input: FolderInfoRequest): Promise<unknown>
}>): Promise<Readonly<{
  result: number
  folder?: z.infer<typeof providerFolderInfoSchema>
}>> {
  const rawEnvelope = await input.request(Object.freeze({
    path: OPENCONTENT_FOLDER_INFO_PATH,
    body: Object.freeze({ token: input.token, folderId: input.folderId }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }))
  const envelope = parseProvider(providerEnvelopeSchema, rawEnvelope)
  if (envelope.result !== 0) return Object.freeze({ result: envelope.result })
  return Object.freeze({
    result: envelope.result,
    folder: parseProvider(providerFolderInfoSchema, envelope.data)
  })
}

function parseProvider<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new OpenContentConnectorError(
      'provider_contract_violation',
      'OpenContent returned an unsupported folder-info response.'
    )
  }
  return parsed.data
}
