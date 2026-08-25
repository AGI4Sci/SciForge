import { OpenContentConnectorError } from '../contract.js'
import type { OpenContentSkillRuntimeSession } from './skill-runtime.js'
import type { OpenContentClient } from './opencontent-client.js'
import type { OpenContentTeamAdministration } from './team-administration.js'

export type OpenContentDeploymentRuntime = Readonly<{
  client: OpenContentClient
  teamAdministration: OpenContentTeamAdministration
  skillRuntime?: OpenContentSkillRuntimeSession
}>

export type OpenContentDeploymentRuntimeGetter = () =>
  OpenContentDeploymentRuntime | undefined

export function requireOpenContentDeploymentRuntime<
  Runtime extends Readonly<{ client: OpenContentClient }>
>(getRuntime: () => Runtime | undefined): Runtime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new OpenContentConnectorError(
      'provider_unavailable',
      'The OpenContent Provider deployment is unavailable.'
    )
  }
  return runtime
}
