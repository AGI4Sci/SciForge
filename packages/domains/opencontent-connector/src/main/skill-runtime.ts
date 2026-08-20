import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  createOpenContentCliRunner,
  type OpenContentCliCommandTransport,
  type OpenContentCliInvocation,
  type OpenContentCliProcessPort
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import type {
  OpenContentSkillBundledAssetLocation
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'
import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'

import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade,
  type OpenContentSkillRuntimeTransport
} from '../contract.js'
import { domainPackageDefinition } from '../definition.js'
import {
  assertOpenContentPrincipalCurrent,
  type OpenContentConnectionService
} from './connection-service.js'

const TRANSPORT_OWNER = Object.freeze({
  role: 'transport-owner' as const,
  moduleId: 'sciforge.opencontent-connector' as const,
  moduleVersion: domainPackageDefinition.module.version
})

const SOURCE_ASSET_PACKAGE_RELATIVE_PATH =
  'internal/opencontent/packages/opencontent-skill-assets' as const

export type OpenContentSkillRuntimeSession = Readonly<{
  useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']>
}>

export function resolveOpenContentSkillRuntimeAssets(
  host: Pick<DomainMainHost, 'getAppRoot' | 'isPackaged'>,
  override?: OpenContentSkillBundledAssetLocation
): OpenContentSkillBundledAssetLocation | undefined {
  if (override) return Object.freeze({ ...override })
  if (host.isPackaged?.() !== true) {
    let assetPackageJson: string | undefined
    try {
      assetPackageJson = createRequire(import.meta.url).resolve(
        '@sciforge-internal/opencontent-skill-assets/package.json'
      )
    } catch (error) {
      if (!isMissingOptionalAssetPackage(error)) throw error
    }
    if (assetPackageJson !== undefined) {
      if (!isAbsolute(assetPackageJson)) throw new Error('Source OpenContent assets are unavailable.')
      return Object.freeze({
        mode: 'source',
        assetRoot: resolve(
          dirname(assetPackageJson),
          'assets',
          OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.version
        )
      })
    }

    const appRoot = host.getAppRoot?.()
    if (appRoot === undefined) return undefined
    if (!isAbsolute(appRoot)) {
      throw new Error('Source OpenContent runtime requires the absolute repository root.')
    }
    const assetPackageRoot = resolve(appRoot, SOURCE_ASSET_PACKAGE_RELATIVE_PATH)
    if (!existsSync(assetPackageRoot)) return undefined
    return Object.freeze({
      mode: 'source',
      assetRoot: resolve(
        assetPackageRoot,
        'assets',
        OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.version
      )
    })
  }
  const appRoot = host.getAppRoot?.()
  if (!appRoot || !isAbsolute(appRoot)) {
    throw new Error('Packaged OpenContent runtime requires the absolute Electron app root.')
  }
  const resourcesPath = dirname(appRoot)
  const packagedRoot = resolve(
    resourcesPath,
    OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath
  )
  if (!existsSync(packagedRoot)) return undefined
  return Object.freeze({ mode: 'packaged', resourcesPath })
}

function isMissingOptionalAssetPackage(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND'
}

/**
 * Owns the only attachment CLI transport. The verified credential is captured
 * only inside one ConnectionService session and is released when the callback
 * settles; Provider adapters receive an allowlisted command transport only.
 */
export function createOpenContentSkillRuntimeSession(options: Readonly<{
  connections: OpenContentConnectionService
  processPort: OpenContentCliProcessPort
  assets: OpenContentSkillBundledAssetLocation
  site: string
}>): OpenContentSkillRuntimeSession {
  return Object.freeze({
    useSkillRuntime: async (input, operation) => {
      if (input.providerInstanceRef !== OPENCONTENT_PROVIDER_INSTANCE_REF) {
        throw new OpenContentConnectorError(
          'invalid_input',
          'The selected OpenContent Provider Instance is unavailable.'
        )
      }
      const assertPrincipalCurrent = () =>
        assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      return options.connections.useCurrentSession({
        principal: input.principal,
        providerInstanceRef: input.providerInstanceRef,
        assertPrincipalCurrent,
        signal: input.signal
      }, async ({ token }) => {
        let runner: OpenContentCliCommandTransport | undefined = createOpenContentCliRunner({
          owner: TRANSPORT_OWNER,
          assets: options.assets,
          execution: {
            providerInstanceRef: input.providerInstanceRef,
            invocationId: input.invocationId,
            deadlineAt: input.deadlineAt,
            signal: input.signal,
            assertPrincipalCurrent
          },
          connectionMaterial: {
            site: options.site,
            systemUserToken: token
          },
          processPort: options.processPort
        })
        const transport: OpenContentSkillRuntimeTransport = Object.freeze({
          invoke: (invocation: OpenContentCliInvocation) => {
            const activeRunner = runner
            if (!activeRunner) {
              throw new OpenContentConnectorError(
                'unauthorized',
                'The verified OpenContent runtime session has expired.'
              )
            }
            return activeRunner.invoke(invocation)
          }
        })
        try {
          return await operation(transport)
        } finally {
          runner = undefined
        }
      })
    }
  })
}
