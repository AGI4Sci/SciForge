import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { defineTrustedRendererDomainPackageEntry } from '@sciforge/domain-sdk/renderer'
import type { DomainUserInputPresentation } from '@sciforge/domain-sdk/user-input'
import type { ReactElement } from 'react'
import { domainPackageDefinition, USER_DECISIONS_RENDERER_I18N_CONTRIBUTION } from '../definition.js'
import { userDecisionsI18nResourceContribution, type UserDecisionsI18nResourceContribution } from './messages.js'
import { DecisionQuestionnaire } from './questionnaire.js'

type UserDecisionsRendererContribution =
  | DomainUserInputPresentation<ReactElement>
  | UserDecisionsI18nResourceContribution

export function createDomainRendererEntry(_host: DomainRendererHost) {
  return defineTrustedRendererDomainPackageEntry<UserDecisionsRendererContribution>({
    definition: domainPackageDefinition,
    contributions: [
      {
        kind: 'renderer.extension',
        id: 'user-decisions.presentation',
        contract: domainPackageDefinition.contributionContracts['user-decisions.presentation'],
        value: { render: (context) => <DecisionQuestionnaire key={context.requestId} {...context} /> }
      },
      {
        ...USER_DECISIONS_RENDERER_I18N_CONTRIBUTION,
        value: userDecisionsI18nResourceContribution
      }
    ]
  })
}
