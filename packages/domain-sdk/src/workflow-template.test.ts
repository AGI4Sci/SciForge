import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DOMAIN_WORKFLOW_TEMPLATE_CONTRACT_VERSION,
  defineDomainWorkflowExecutionReceiptProvider,
  domainWorkflowTemplateBundleSchema
} from './workflow-template.js'

describe('workflow template and execution receipt contracts', () => {
  it('requires the root workflow to be present in the formal bundle', () => {
    const bundle = domainWorkflowTemplateBundleSchema.parse({
      contractVersion: DOMAIN_WORKFLOW_TEMPLATE_CONTRACT_VERSION,
      templateId: 'fixture.template',
      rootWorkflowId: 'root',
      workflows: [{ id: 'root', nodes: [], connections: [] }],
      initialInput: { objective: 'test' }
    })
    assert.equal(bundle.rootWorkflowId, 'root')
    assert.throws(() => domainWorkflowTemplateBundleSchema.parse({
      ...bundle,
      rootWorkflowId: 'missing'
    }))
  })

  it('defines one package-owned execution receipt adapter boundary', () => {
    const provider = defineDomainWorkflowExecutionReceiptProvider({
      id: 'fixture.receipts',
      matches: (workflow) => workflow === 'fixture'
    })
    assert.equal(provider.matches('fixture'), true)
    assert.equal(Object.isFrozen(provider), true)
  })
})
