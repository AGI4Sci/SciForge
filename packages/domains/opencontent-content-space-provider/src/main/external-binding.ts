import {
  contentSpaceExternalBindingAttestationSchema,
  type ContentSpaceExternalBindingAttestation,
  type ContentSpaceProviderOperationContext
} from '@sciforge/domain-content-space/contract'
import { samePrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  OpenContentConnectorError,
  openContentExternalBindingAttestationSchema,
  type OpenContentExternalBindingAttestation
} from '@sciforge/domain-opencontent-connector/contract'

type BindingContext = Pick<
ContentSpaceProviderOperationContext,
'expectedExternalBinding' | 'principal' | 'providerInstanceRef'
>

type ExpectedBindingInput = Readonly<{
  expectedBindingAttestation?: OpenContentExternalBindingAttestation
}>

export function toOpenContentExpectedBinding(
  context: BindingContext
): ExpectedBindingInput {
  if (context.expectedExternalBinding === undefined) return Object.freeze({})
  const contentBinding = contentSpaceExternalBindingAttestationSchema.safeParse(
    context.expectedExternalBinding
  )
  if (!contentBinding.success || !bindingMatchesContext(contentBinding.data, context)) {
    throw bindingContractViolation()
  }
  const connectorBinding = openContentExternalBindingAttestationSchema.safeParse(
    contentBinding.data
  )
  if (!connectorBinding.success) throw bindingContractViolation()
  return Object.freeze({ expectedBindingAttestation: connectorBinding.data })
}

export function fromOpenContentExternalBinding(
  rawBinding: unknown,
  context: BindingContext
): ContentSpaceExternalBindingAttestation {
  const connectorBinding = openContentExternalBindingAttestationSchema.safeParse(rawBinding)
  if (!connectorBinding.success || !bindingMatchesContext(connectorBinding.data, context)) {
    throw bindingContractViolation()
  }
  const contentBinding = contentSpaceExternalBindingAttestationSchema.safeParse(
    connectorBinding.data
  )
  if (!contentBinding.success) throw bindingContractViolation()
  return contentBinding.data
}

function bindingMatchesContext(
  binding: Readonly<{
    providerInstanceRef: string
    principal: ContentSpaceProviderOperationContext['principal']
  }>,
  context: Pick<ContentSpaceProviderOperationContext, 'principal' | 'providerInstanceRef'>
): boolean {
  return binding.providerInstanceRef === context.providerInstanceRef &&
    samePrincipalSnapshot(binding.principal, context.principal)
}

function bindingContractViolation(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'provider_contract_violation',
    'The OpenContent external binding attestation is invalid for this Provider invocation.'
  )
}
