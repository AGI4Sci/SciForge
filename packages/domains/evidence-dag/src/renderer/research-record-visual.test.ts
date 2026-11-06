import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchRecordNode } from '../research-record-contract'
import { recordOperation, recordReviewTone, recordVisualState } from './research-record-visual'
const node = (status: string, kind: ResearchRecordNode['kind'] = 'round'): ResearchRecordNode => ({ id:'r',parentId:'root',kind,status,title:'固定对照',summary:'',origin:'system',createdAt:'2026-11-04',updatedAt:'2026-11-04' })
test('colors describe actual execution, not synthesis readiness or scientific verification', () => {
 assert.equal(recordVisualState(node('running')).label, '推进中')
 assert.equal(recordVisualState(node('completed')).label, '本轮完成')
 assert.equal(recordVisualState(node('success','event')).tone, 'done')
 assert.equal(recordVisualState({...node('unknown','phase'),synthesisStatus:'ready'}).tone,'neutral')
 assert.equal(recordVisualState(node('complete','step')).tone,'neutral')
 assert.equal(recordVisualState(node('pending')).tone,'neutral')
 assert.match(recordVisualState(node('completed')).reason, /不代表科研结论/)
})
test('unresolved or failed evidence takes precedence over a successful outer round without mutation', () => {
 const value={...node('completed'),synthesis:{revision:1,updatedAt:'2026-11-04',summaryLimited:false,entries:[{id:'e',kind:'open' as const,text:'还需独立对照',sourceIds:['s'],status:'active' as const}]}}
 const before=structuredClone(value)
 assert.equal(recordVisualState(value).label,'待核查')
 assert.equal(recordVisualState({...node('completed'),behaviorCounts:{total:3,failed:1,cancelled:0}}).tone,'check')
 assert.deepEqual(value,before)
 for(const status of ['failed','error','cancelled','canceled','aborted','interrupted']) assert.equal(recordVisualState(node(status)).tone,'check')
})
test('operation icons distinguish attribution and source types without inventing capabilities', () => {
 assert.equal(recordOperation({...node('complete','capability'),title:'Skill · review'}),'capability')
 assert.equal(recordOperation({...node('complete','capability'),title:'command_execution'}),'terminal')
 assert.equal(recordOperation({...node('complete','capability'),title:'user_message'}),'message')
 assert.equal(recordOperation({...node('complete','capability'),title:'Skill · guessed',origin:'model'}),'source')
 assert.equal(recordReviewTone({kind:'model-organization'}),'neutral')
 assert.equal(recordReviewTone({kind:'open'}),'check')
})
