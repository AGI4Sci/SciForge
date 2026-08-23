import { lstatSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { verifyInstalledInternalOverlaySync } from '@sciforge/internal-runtime-integrity'
import {
  createOpenContentCliRunner,
  type OpenContentCliProcessPort
} from './cli-runner.js'
import type {
  OpenContentSkillBundledAssetLocation
} from './bundled-assets.js'
import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR
} from './bundled-assets.js'

import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError
} from '../contract.js'
import type {
  OpenContentContentSpaceFacade,
  OpenContentSupplierCommandTransport,
  OpenContentSupplierInvocation
} from '../main-contract.js'
import {
  assertOpenContentPrincipalCurrent,
  type OpenContentConnectionService
} from './connection-service.js'

const SOURCE_OVERLAY = OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.installation
const SOURCE_ASSET_PACKAGE_RELATIVE_PATH =
  `${SOURCE_OVERLAY.overlayRoot}/packages/opencontent-skill-assets`

export type OpenContentSkillRuntimeSession = Readonly<{
  useSupplierTransport: NonNullable<OpenContentContentSpaceFacade['useSupplierTransport']>
}>

export function resolveOpenContentSkillRuntimeAssets(
  host: Pick<DomainMainHost, 'getAppRoot' | 'isPackaged'>
): OpenContentSkillBundledAssetLocation | undefined {
  if (host.isPackaged?.() !== true) {
    const appRoot = host.getAppRoot?.()
    if (appRoot === undefined) return undefined
    if (!isAbsolute(appRoot)) {
      throw new Error('Source OpenContent runtime requires the absolute repository root.')
    }
    const overlayRoot = resolve(appRoot, SOURCE_OVERLAY.overlayRoot)
    const receiptPath = resolve(
      appRoot,
      '.sciforge',
      'internal-overlays',
      `${SOURCE_OVERLAY.overlayId}.json`
    )
    if (!pathEntryExists(overlayRoot) && !pathEntryExists(receiptPath)) return undefined
    const assetPackageRoot = resolve(appRoot, SOURCE_ASSET_PACKAGE_RELATIVE_PATH)
    const verifiedOverlay = verifyInstalledInternalOverlaySync({
      targetRoot: appRoot,
      overlayId: SOURCE_OVERLAY.overlayId,
      overlayRoot: SOURCE_OVERLAY.overlayRoot
    })
    if (verifiedOverlay.version !== SOURCE_OVERLAY.version ||
      verifiedOverlay.archiveSha256 !== SOURCE_OVERLAY.archiveSha256) {
      throw new Error(
        'Source OpenContent runtime receipt does not match package-owned provenance.'
      )
    }
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
  if (!pathEntryExists(packagedRoot)) {
    const [packagedNamespace] =
      OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.packagedResourcesRelativePath.split('/')
    if (packagedNamespace && pathEntryExists(resolve(resourcesPath, packagedNamespace))) {
      throw new TypeError('Bundled OpenContent assets are unavailable or invalid.')
    }
    return undefined
  }
  return Object.freeze({ mode: 'packaged', resourcesPath })
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
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
  assertAssetsCurrent?: () => void
}>): OpenContentSkillRuntimeSession {
  return Object.freeze({
    useSupplierTransport: async (input, operation) => {
      if (input.providerInstanceRef !== OPENCONTENT_PROVIDER_INSTANCE_REF) {
        throw new OpenContentConnectorError(
          'invalid_input',
          'The selected OpenContent Provider Instance is unavailable.'
        )
      }
      options.assertAssetsCurrent?.()
      const assertPrincipalCurrent = () =>
        assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      return options.connections.useCurrentSession({
        principal: input.principal,
        providerInstanceRef: input.providerInstanceRef,
        expectedBindingAttestation: input.expectedBindingAttestation,
        assertPrincipalCurrent,
        signal: input.signal
      }, async ({ token }) => {
        let runner: OpenContentSupplierCommandTransport | undefined = createOpenContentCliRunner({
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
        const transport: OpenContentSupplierCommandTransport = Object.freeze({
          invoke: (invocation: OpenContentSupplierInvocation) => {
            options.assertAssetsCurrent?.()
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
