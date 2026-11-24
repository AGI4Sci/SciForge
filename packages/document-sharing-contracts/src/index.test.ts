import test from 'node:test'
import assert from 'node:assert/strict'
import {documentShareCreateRequestSchema,documentShareRevokeRequestSchema,documentShareManageResponseSchema,documentCommentMutateRequestSchema,documentCommentStoreSchema} from './index.js'
const source={spaceId:`spc_${'a'.repeat(32)}`,documentId:'20261110000000-abcdefg'}
const share={shareId:`dsh_${'b'.repeat(32)}`,source,permission:'edit',status:'active',revision:1,createdAt:'2026-11-10T00:00:00.000Z',revokedAt:null}
test('owner commands preserve exact source and reject client identity or expanded scope',()=>{
 const input={source,permission:'edit',idempotencyKey:'sharing-test-1'}
 assert.deepEqual(documentShareCreateRequestSchema.parse(input),input)
 for(const extra of [{ownerUserId:'usr_fake'},{scope:'space'},{includeChildren:true}])assert.equal(documentShareCreateRequestSchema.safeParse({...input,...extra}).success,false)
 assert.equal(documentShareRevokeRequestSchema.safeParse({shareId:share.shareId,expectedRevision:1,idempotencyKey:'sharing-test-2'}).success,false)
})
test('public links use HTTPS with only an opaque fragment secret',()=>{
 const shareUrl=`https://cloud.example/share/${share.shareId}#key=${'a'.repeat(43)}`
 assert.equal(documentShareManageResponseSchema.safeParse({share,shareUrl}).success,true)
 for(const value of [shareUrl.replace('https:','http:'),shareUrl.replace('#key=','?key='),shareUrl.replace('cloud.example','user:pass@cloud.example'),shareUrl+'?extra'])assert.equal(documentShareManageResponseSchema.safeParse({share,shareUrl:value}).success,false)
 assert.equal(documentShareManageResponseSchema.safeParse({share:null,shareUrl}).success,false)
})
test('comment mutation forbids forged authors and arbitrary attribute replacement',()=>{
 const input={source,expectedRevision:'a'.repeat(64),idempotencyKey:'comment-test-1',mutation:{kind:'create',blockId:source.documentId,text:'Hello',quote:''}}
 assert.equal(documentCommentMutateRequestSchema.safeParse(input).success,true)
 assert.equal(documentCommentMutateRequestSchema.safeParse({...input,mutation:{...input.mutation,authorId:'sciforge:other'}}).success,false)
 assert.equal(documentCommentMutateRequestSchema.safeParse({...input,store:{v:1,comments:{}}}).success,false)
})
test('historical comments remain readable without claiming a manual author identity',()=>{
 const legacy={v:1,comments:{old:{blockId:source.documentId,author:'Manual name',text:'Old comment',quote:'',createdAt:1,replies:{}}}}
 assert.deepEqual(documentCommentStoreSchema.parse(legacy),legacy)
})

test('v1 direct replies preserve empty replyTo without accepting an empty mutation target',()=>{
 const value={v:1,comments:{thread:{blockId:source.documentId,author:'Manual',text:'Comment',quote:'',createdAt:1,replies:{reply:{parent:'thread',replyTo:'',author:'Manual',text:'Direct reply',createdAt:2}}}}}
 assert.deepEqual(documentCommentStoreSchema.parse(value),value)
 assert.equal(documentCommentMutateRequestSchema.safeParse({source,expectedRevision:'a'.repeat(64),idempotencyKey:'test-direct-reply',mutation:{kind:'reply.create',commentId:'thread',replyTo:'',text:'New reply'}}).success,false)
})
