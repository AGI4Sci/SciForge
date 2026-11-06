import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { defineTrustedRendererDomainPackageEntry } from '@sciforge/domain-sdk/renderer'
import type { DomainUserInputPresentation } from '@sciforge/domain-sdk/user-input'
import type { ReactElement } from 'react'
import { domainPackageDefinition } from '../definition.js'
import { DecisionQuestionnaire } from './questionnaire.js'
export function createDomainRendererEntry(_host: DomainRendererHost) {
  return defineTrustedRendererDomainPackageEntry<DomainUserInputPresentation<ReactElement>>({
    definition: domainPackageDefinition,
    contributions: [{
      kind: 'renderer.extension', id: 'user-decisions.presentation',
      contract: domainPackageDefinition.contributionContracts['user-decisions.presentation'],
      value: { render: (context) => <DecisionQuestionnaire key={context.requestId} {...context} /> }
    }]
  })
}
