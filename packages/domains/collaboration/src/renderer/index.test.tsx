import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'

import {
  COLLABORATION_CHAT_MESSAGE_CONTRIBUTION,
  COLLABORATION_CHAT_MESSAGE_CONTRACT,
  COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION,
  COLLABORATION_I18N_CONTRIBUTION,
  COLLABORATION_MAIN_AREA_CONTRACT,
  COLLABORATION_MAIN_AREA_CONTRIBUTION
} from '../definition.js'
import {
  createCollaborationMainAreaContribution,
  createDomainRendererEntry
} from './index.js'

test('renderer entry contributes Collaboration as one generic main-area page', () => {
  const entry = createDomainRendererEntry(rendererHost())
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ kind, id }) => ({ kind, id })),
    [
      COLLABORATION_I18N_CONTRIBUTION,
      COLLABORATION_MAIN_AREA_CONTRIBUTION,
      COLLABORATION_COMPOSER_CONTEXT_CONTRIBUTION,
      COLLABORATION_CHAT_MESSAGE_CONTRIBUTION
    ].map(({ kind, id }) => ({ kind, id }))
  )
  assert.equal(
    entry.contributions.some(({ kind }) => kind === 'renderer.workbench-right-panel'),
    false
  )
  assert.equal(entry.contributions.some(({ kind }) => kind === 'renderer.command'), false)
  const page = entry.contributions.find(({ id }) => id === COLLABORATION_MAIN_AREA_CONTRIBUTION.id)!
  assert.deepEqual(page.contract, COLLABORATION_MAIN_AREA_CONTRACT)
  assert.equal(typeof (page.value as { render: unknown }).render, 'function')
})

test('renderer entry declares the read-only task message body through its manifest', () => {
  const entry = createDomainRendererEntry(rendererHost())
  const body = entry.contributions.find(({ id }) => id === COLLABORATION_CHAT_MESSAGE_CONTRIBUTION.id)!
  assert.equal(body.kind, 'renderer.chat-message')
  assert.deepEqual(body.contract, COLLABORATION_CHAT_MESSAGE_CONTRACT)
  assert.deepEqual(body.contract, { contractVersion: '1.0.0' })
  assert.equal(typeof (body.value as { render: unknown }).render, 'function')
})

test('main-area contribution renders directly and reserves Host Session dock for private work', () => {
  const page = createCollaborationMainAreaContribution(rendererHost())
  let dockCalls = 0
  const rendered = page.render({
    active: true,
    className: 'fixture-main-area',
    renderSessionDock: (next) => {
      dockCalls += 1
      return next.companion
    }
  })
  assert.ok(rendered)
  assert.equal(dockCalls, 0)
})

function rendererHost(): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not observed')
      },
      invoke: async () => {
        throw new Error('not invoked')
      }
    },
    openExternal: () => undefined
  }
}
