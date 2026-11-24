import {z} from 'zod'
export const DOCUMENT_SHARES_ROUTE='/v1/document-shares'
export const DOCUMENT_COMMENTS_READ_ROUTE='/v1/document-comments/read'
export const DOCUMENT_COMMENTS_MUTATE_ROUTE='/v1/document-comments/mutate'
export const documentShareIdSchema=z.string().regex(/^dsh_[a-f0-9]{32}$/u)
export const documentIdSchema=z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
export const documentSourceSchema=z.object({spaceId:z.string().regex(/^spc_[a-f0-9]{32}$/u),documentId:documentIdSchema}).strict()
export const documentSharePermissionSchema=z.enum(['comment','edit'])
const revision=z.string().regex(/^[a-f0-9]{64}$/u)
const idem=z.string().min(8).max(256)
const recordId=z.string().min(1).max(256)
const text=z.string().trim().min(1).max(32000)
export const documentShareSchema=z.object({shareId:documentShareIdSchema,source:documentSourceSchema,permission:documentSharePermissionSchema,status:z.enum(['active','revoked']),revision:z.number().int().positive(),createdAt:z.iso.datetime(),revokedAt:z.iso.datetime().nullable()}).strict()
export const documentShareCreateRequestSchema=z.object({source:documentSourceSchema,permission:documentSharePermissionSchema,idempotencyKey:idem}).strict()
export const documentShareLookupRequestSchema=z.object({source:documentSourceSchema}).strict()
export const documentShareRevokeRequestSchema=z.object({source:documentSourceSchema,shareId:documentShareIdSchema,expectedRevision:z.number().int().positive(),idempotencyKey:idem}).strict()
const shareUrl=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&/^\/share\/dsh_[a-f0-9]{32}$/u.test(u.pathname)&&/^#key=[A-Za-z0-9_-]{43}$/u.test(u.hash)},'Invalid public share link')
export const documentShareManageResponseSchema=z.object({share:documentShareSchema.nullable(),shareUrl:shareUrl.nullable()}).strict().refine(v=>(v.share===null)===(v.shareUrl===null),'Share link metadata must match')
export const documentShareJoinRequestSchema=z.object({secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),idempotencyKey:idem}).strict()
export const documentShareAccessSchema=z.object({share:documentShareSchema,canManage:z.boolean(),user:z.object({userId:z.string().min(1),displayName:z.string().min(1)}).strict()}).strict()
export const documentBlockSchema=z.object({blockId:documentIdSchema,markdown:z.string().max(1000000),editable:z.boolean(),kind:z.string().min(1).max(100)}).strict()
export const commentReplySchema=z.object({parent:recordId,replyTo:z.union([z.literal(''),recordId]).optional(),author:z.string(),authorId:z.string().optional(),text:z.string(),createdAt:z.number(),updatedAt:z.number().optional()}).strict()
export const documentCommentSchema=z.object({blockId:documentIdSchema,author:z.string(),authorId:z.string().optional(),text:z.string(),quote:z.string(),createdAt:z.number(),updatedAt:z.number().optional(),replies:z.record(z.string(),commentReplySchema),resolution:z.object({by:z.string(),byId:z.string().optional(),at:z.number()}).strict().nullable().optional()}).strict()
export const documentCommentStoreSchema=z.object({v:z.literal(1),comments:z.record(z.string(),documentCommentSchema)}).strict()
export const documentSnapshotSchema=z.object({documentId:documentIdSchema,title:z.string(),revision,blocks:z.array(documentBlockSchema),anchorBlockIds:z.array(documentIdSchema),comments:documentCommentStoreSchema.nullable()}).strict()
export const documentCommentMutationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('create'),blockId:documentIdSchema,text,quote:z.string().max(32000)}).strict(),
 z.object({kind:z.literal('update'),commentId:recordId,text}).strict(),
 z.object({kind:z.literal('delete'),commentId:recordId}).strict(),
 z.object({kind:z.literal('reply.create'),commentId:recordId,replyTo:recordId.optional(),text}).strict(),
 z.object({kind:z.literal('reply.update'),commentId:recordId,replyId:recordId,text}).strict(),
 z.object({kind:z.literal('reply.delete'),commentId:recordId,replyId:recordId}).strict(),
 z.object({kind:z.literal('resolve'),commentId:recordId,resolved:z.boolean()}).strict()
])
export const documentCommentReadRequestSchema=z.object({source:documentSourceSchema}).strict()
export const documentCommentMutateRequestSchema=z.object({source:documentSourceSchema,expectedRevision:revision,mutation:documentCommentMutationSchema,idempotencyKey:idem}).strict()
export const documentShareCommentMutateRequestSchema=documentCommentMutateRequestSchema.omit({source:true})
export const documentCommentResponseSchema=z.object({revision,store:documentCommentStoreSchema}).strict()
export type DocumentSource=z.infer<typeof documentSourceSchema>
export type DocumentShare=z.infer<typeof documentShareSchema>
export type DocumentSnapshot=z.infer<typeof documentSnapshotSchema>
export type DocumentCommentStore=z.infer<typeof documentCommentStoreSchema>
export type DocumentCommentMutation=z.infer<typeof documentCommentMutationSchema>
export type DocumentShareCreateRequest=z.infer<typeof documentShareCreateRequestSchema>
export type DocumentShareLookupRequest=z.infer<typeof documentShareLookupRequestSchema>
export type DocumentShareRevokeRequest=z.infer<typeof documentShareRevokeRequestSchema>
export type DocumentShareManageResponse=z.infer<typeof documentShareManageResponseSchema>
export type DocumentCommentReadRequest=z.infer<typeof documentCommentReadRequestSchema>
export type DocumentCommentMutateRequest=z.infer<typeof documentCommentMutateRequestSchema>
export type DocumentCommentResponse=z.infer<typeof documentCommentResponseSchema>
export const documentCommentMutateResponseSchema=documentCommentResponseSchema.extend({result:z.object({commentId:recordId,replyId:recordId.nullable()}).strict()})
export type DocumentCommentMutateResponse=z.infer<typeof documentCommentMutateResponseSchema>
