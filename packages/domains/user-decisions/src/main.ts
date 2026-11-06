import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { DomainUserInputRequest } from '@sciforge/domain-sdk/user-input'
import { domainPackageDefinition } from './definition.js'
import { REQUEST_USER_DECISION, userInputRequestSchema, userInputResultSchema } from './contract.js'

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  return {
    definition: domainPackageDefinition,
    contributions: [{
      kind: 'main.capability-factory', id: 'user-decisions.capabilities',
      value: {
        moduleId: domainPackageDefinition.module.id,
        policy: { id: 'user-decisions', title: 'User Decisions', directTransportPrefixes: [], allowedDirectTransports: [] },
        createDefinitions: () => [host.defineCapability({
          id: REQUEST_USER_DECISION, version: '1.0.0',
          title: 'Ask the user to decide',
          description: 'Ask 1–3 structured questions and wait for the user to answer in a popup. Prefer 2–4 options, with descriptions and an optional recommendation. Every question allows Other/free text. Use this for missing preferences or requirements on any runtime. The tool returns the submitted answers or explicit cancellation; never infer approval or select a default. Do not use for permission to execute external writes.',
          audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
          concurrency: { revision: 'none', idempotency: 'none' },
          tags: ['question', 'questionnaire', 'user', 'input', 'decision', 'clarification', '问卷', '选择', '提问'],
          inputSchema: userInputRequestSchema, outputSchema: userInputResultSchema,
          handler: async (input: DomainUserInputRequest) => {
            if (!host.userInput) throw new Error('Host user input is unavailable.')
            return { output: await host.userInput.request(input), changed: false }
          }
        })]
      }
    }, { kind: 'main.agent-routing', id: 'user-decisions.agent-routing', value: null,
      contract: domainPackageDefinition.contributionContracts['user-decisions.agent-routing'] }]
  }
}
