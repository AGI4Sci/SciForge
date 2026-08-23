import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'

export async function observeAfterOpenContentTeamMutation<Value>(
  observe: () => Value | Promise<Value>
): Promise<Value> {
  try {
    return await observe()
  } catch {
    throw new OpenContentConnectorError(
      'outcome_unknown',
      'The OpenContent Team mutation outcome cannot be proven.'
    )
  }
}
