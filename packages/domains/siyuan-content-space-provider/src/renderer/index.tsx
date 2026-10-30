import type { ReactElement } from 'react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  defineTrustedRendererDomainPackageEntry,
  type DomainRendererWorkbenchMainAreaValue,
  type TrustedRendererDomainPackageEntry
} from '@sciforge/domain-sdk/renderer'

import { domainPackageDefinition } from '../definition.js'
import {
  siyuanEditorContract,
  siyuanEditorPresentContract,
  type SiYuanEditorViewport
} from '../editor-contract.js'
import { SiYuanEditorPage, type SiYuanEditorConfiguration } from './editor-page.js'

type SiYuanMainAreaValue = DomainRendererWorkbenchMainAreaValue<ReactElement | null>

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedRendererDomainPackageEntry<SiYuanMainAreaValue> {
  const open = async (input: SiYuanEditorConfiguration): Promise<string> => {
    const url = input.url.trim()
    const result = await host.capabilityInvoker.invoke(siyuanEditorContract, url ? { url } : {})
    return result.url
  }
  const present = async (
    input: Readonly<{ url: string | null; viewport: SiYuanEditorViewport }>
  ): Promise<unknown> => host.capabilityInvoker.invoke(siyuanEditorPresentContract, input)
  const declaration = domainPackageDefinition.entrypoints
    .find((entry) => entry.process === 'renderer')!.contributions[0]
  return defineTrustedRendererDomainPackageEntry({
    definition: domainPackageDefinition,
    contributions: [{
      ...declaration,
      contract: domainPackageDefinition.contributionContracts[declaration.id],
      value: {
        render: (context) => <SiYuanEditorPage context={context} open={open} present={present} />
      }
    }]
  })
}