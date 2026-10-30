import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSciforgeWorkerFrame, sciforgeWorkerResponseSchema } from './contract.js'

test('parses canonical request and event frames', () => {
  assert.equal(parseSciforgeWorkerFrame({type:'request', id:'1', method:'workspace.fs.list', params:{path:'/tmp'}}).type, 'request')
  assert.equal(parseSciforgeWorkerFrame({type:'event', event:'workspace.fs.changed', sequence:1}).type, 'event')
})

test('enforces response success/error invariants', () => {
  assert.equal(sciforgeWorkerResponseSchema.safeParse({type:'response',id:'1',ok:true,error:{code:'x',message:'bad'}}).success, false)
  assert.equal(sciforgeWorkerResponseSchema.safeParse({type:'response',id:'1',ok:false}).success, false)
})
