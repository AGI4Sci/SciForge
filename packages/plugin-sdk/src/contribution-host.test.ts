import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContributionHost } from './contribution-host.js'

test('owner transfer preserves exact old contributions through Host policy reads and after-register exceptions', async () => {
  type Input = Parameters<ContributionHost['register']>[0]
  let previous: ReturnType<ContributionHost['list']> = []
  let fail = true
  let calls = 0
  class PolicyHost extends ContributionHost {
    override register(input: Input) {
      if (previous.length) {
        assert.deepEqual(this.list(), previous)
        this.list().forEach((item, i) => assert.equal(item, previous[i]))
      }
      const result = super.register(input)
      if (previous.length) {
        assert.deepEqual(this.list(), previous)
        this.list().forEach((item, i) => assert.equal(item, previous[i]))
        if (++calls === 2 && fail) throw new Error('after-register policy failure')
      }
      return result
    }
  }
  const host = new PolicyHost()
  for (const id of ['a', 'b']) host.register({ pluginId: 'p', generation: 1, kind: 'capability', id, value: {} })
  previous = host.list()
  const next = previous.map(item => ({ ...item, generation: 2 }))
  assert.throws(() => host.replaceOwned(previous, next), /after-register policy failure/)
  host.list().forEach((item, i) => assert.equal(item, previous[i]))
  fail = false
  host.replaceOwned(previous, next)
  assert.deepEqual(host.list().map(item => item.generation), [2, 2])
  assert.notEqual(host.list()[0], previous[0])
  previous = []
  await host.unregisterPlugin('p', 2)
  assert.deepEqual(host.list(), [])
})

test('reentrant owner transfer rejects nested mutation and never revokes a previously successful independent owner', () => {
  type Input = Parameters<ContributionHost['register']>[0]
  let checking = false
  class PolicyHost extends ContributionHost {
    override register(input: Input) {
      const result = super.register(input)
      if (checking) {
        assert.throws(() => this.replaceOwned([], [{ ...input, id: 'nested' }]), /Reentrant/)
        assert.throws(() => super.register({ ...input, id: 'nested' }), /Reentrant/)
        throw new Error('outer policy failure')
      }
      return result
    }
  }
  const host = new PolicyHost()
  const original = host.register({ pluginId: 'p', generation: 1, kind: 'capability', id: 'a', value: {} })
  const independent = host.register({ pluginId: 'q', generation: 1, kind: 'capability', id: 'independent', value: {} })
  checking = true
  assert.throws(() => host.replaceOwned([original], [{ ...original, generation: 2 }]), /outer policy failure/)
  assert.equal(host.list()[0], original)
  assert.equal(host.list()[1], independent)
  checking = false
  host.replaceOwned([original], [{ ...original, generation: 2 }])
  assert.equal(host.list().find(item => item.id === 'independent'), independent)
})

test('plugin disposal never clears a replacement owner when asynchronous cleanup fails', async()=>{
 const host = new ContributionHost()
 let entered!: () => void
 let release!: () => void
 const started = new Promise<void>(resolve=>{entered=resolve})
 const barrier = new Promise<void>(resolve=>{release=resolve})
 host.register({pluginId:'p',generation:1,kind:'capability',id:'one',value:{},unregister:async()=>{entered();await barrier;throw new Error('async cleanup failure')}})
 const disposing = host.unregisterPlugin('p',1)
 const rejected = assert.rejects(disposing,/cleanup failure/)
 await started
 try {
  const replacement = host.register({pluginId:'p',generation:2,kind:'capability',id:'one',value:{}})
  release()
  await rejected
  assert.equal(host.list()[0],replacement)
 } finally {release();await rejected}
})

test('plugin disposal attempts every contribution and retains only failed cleanup for retry', async()=>{
 const host = new ContributionHost()
 const removed: string[] = []
 host.register({pluginId:'p',generation:1,kind:'capability',id:'good',value:{},unregister:()=>{removed.push('good')}})
 let attempts=0
 const failed=host.register({pluginId:'p',generation:1,kind:'capability',id:'bad',value:{},unregister:()=>{if(++attempts===1) throw new Error('cleanup failure')}})
 await assert.rejects(host.unregisterPlugin('p',1),/cleanup failure/)
 assert.deepEqual(removed,['good'])
 assert.deepEqual(host.list(),[failed])
 await host.unregisterPlugin('p',1)
 assert.deepEqual(host.list(),[])
})

test('failed single-item disposal retains ownership for cleanup retry', async()=>{
 const host=new ContributionHost()
 let attempts=0
 const contribution=host.register({pluginId:'p',generation:1,kind:'capability',id:'one',value:{},unregister:()=>{
  if(++attempts===1) throw new Error('synthetic cleanup failure')
 }})
 await assert.rejects(host.unregisterContribution('p','capability','one',1), /cleanup failure/)
 assert.equal(host.list()[0],contribution)
 await host.unregisterContribution('p','capability','one',1)
 assert.equal(host.list().length,0)
 assert.equal(attempts,2)
})

test('single contribution removal is generation fenced and preserves peers', async()=>{
 const host=new ContributionHost()
 const removed:string[]=[]
 for(const id of ['one','two']) host.register({pluginId:'p',generation:2,kind:'capability',id,value:{},unregister:()=>{removed.push(id)}})
 await host.unregisterContribution('p','capability','one',1)
 assert.equal(host.list().length,2)
 await host.unregisterContribution('p','capability','one',2)
 assert.deepEqual(host.list().map(c=>c.id),['two'])
 assert.deepEqual(removed,['one'])
})

test('contribution host scopes registrations by plugin generation and disposes them', async () => {
  const host = new ContributionHost()
  const disposed: string[] = []
  host.register({
    pluginId: 'fixture.unitverse',
    generation: 1,
    kind: 'capability',
    id: 'unitverse.convert',
    value: { ok: true },
    unregister: () => { disposed.push('unitverse.convert') }
  })
  assert.equal(host.has('fixture.unitverse', 'capability', 'unitverse.convert', 1), true)
  assert.throws(() => host.register({
    pluginId: 'fixture.unitverse',
    generation: 1,
    kind: 'capability',
    id: 'unitverse.convert',
    value: {}
  }), /Duplicate/)
  await host.unregisterPlugin('fixture.unitverse', 1)
  assert.deepEqual(disposed, ['unitverse.convert'])
  assert.equal(host.list().length, 0)
})
