/**
 * Service factory equivalent to the static module's `serviceFor`/`statusService`
 * wiring in `packages/domains/scientific-plotting/src/main.ts`: one dependency-free
 * status service, and one workspace-bound service per workspace root (created
 * lazily, cached). When a capability invoker is supplied, workspace services get
 * the artifact version commit/read ports built from it — the same construction
 * the static host performs with `host.capabilities`.
 */
import {
  createArtifactVersionCommitPortV1,
  createArtifactVersionReadPortV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  createScientificPlottingService,
  type ScientificPlottingService
} from '@sciforge/scientific-plotting/service'
import type { ScientificPlottingCapabilitiesPort } from '../ports/capabilities.js'

export type ScientificPlottingServiceFactory = Readonly<{
  statusService: ScientificPlottingService
  serviceFor: (workspaceRoot: string) => ScientificPlottingService
}>

export function createScientificPlottingServiceFactory(
  capabilities?: ScientificPlottingCapabilitiesPort
): ScientificPlottingServiceFactory {
  const services = new Map<string, ScientificPlottingService>()
  return Object.freeze({
    statusService: createScientificPlottingService(),
    serviceFor: (workspaceRoot: string) => {
      let service = services.get(workspaceRoot)
      if (!service) {
        service = capabilities
          ? createScientificPlottingService({
              artifactVersionCommitPort: createArtifactVersionCommitPortV1(capabilities, workspaceRoot),
              artifactVersionReadPort: createArtifactVersionReadPortV1(capabilities, workspaceRoot)
            })
          : createScientificPlottingService()
        services.set(workspaceRoot, service)
      }
      return service
    }
  })
}
