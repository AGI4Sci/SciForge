/**
 * Maps a sandboxed domain package's `requestedPermissions` (the real, existing
 * contract in `@sciforge/domain-sdk/contract` — `domainPackageRequestedPermissionSchema`)
 * onto:
 *
 *  1. concrete fs paths / net domains the runtime host should enforce
 *     (`resolvePluginFsPermissions`, `resolvePluginNetDomains`), and
 *  2. the existing Capability Broker `effect`/`approval` vocabulary
 *     (`capabilityEffectSchema`/`capabilityApprovalModeSchema` in
 *     `src/shared/capability-broker.ts`) via `derivePermissionCapabilityDefaults`.
 *
 * This deliberately does NOT introduce a new permission taxonomy for plugins.
 * `openspec/changes/add-plugin-runtime-isolation/design.md` §5 explains why:
 * plugin permission declarations should inherit the approval-grant machinery
 * that `src/main/capabilities/broker.ts` already runs in production, rather than
 * needing a second, plugin-specific confirmation UI.
 *
 * Permission ID convention used by this module (namespaced, matches
 * `domainPackagePermissionIdSchema`'s `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$`):
 *
 *  - `fs.read`  — parameters: `{ paths: string[] }` (relative to the extension's
 *                 install directory)
 *  - `fs.write` — parameters: `{ paths: string[] }`
 *  - `net.fetch` — parameters: `{ domains: string[] }`
 */

import type { DomainPackageRequestedPermission } from '@sciforge/domain-sdk/contract'
import type { CapabilityApprovalMode, CapabilityEffect } from '../../../shared/capability-broker'

export const PLUGIN_PERMISSION_IDS = Object.freeze({
  FS_READ: 'fs.read',
  FS_WRITE: 'fs.write',
  NET_FETCH: 'net.fetch'
} as const)

export type PluginPermissionId =
  typeof PLUGIN_PERMISSION_IDS[keyof typeof PLUGIN_PERMISSION_IDS]

export type ResolvedPluginFsPermissions = Readonly<{
  read: readonly string[]
  write: readonly string[]
}>

function readStringArrayParameter(
  permission: DomainPackageRequestedPermission,
  key: string
): readonly string[] {
  const value = permission.parameters?.[key]
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(
      `Permission ${permission.id}: parameters.${key} must be a non-empty string array.`
    )
  }
  return value as readonly string[]
}

/** Gathers `fs.read`/`fs.write` declarations into the shape `buildPermissionFlags` expects. */
export function resolvePluginFsPermissions(
  permissions: readonly DomainPackageRequestedPermission[]
): ResolvedPluginFsPermissions {
  const read: string[] = []
  const write: string[] = []
  for (const permission of permissions) {
    if (permission.id === PLUGIN_PERMISSION_IDS.FS_READ) {
      read.push(...readStringArrayParameter(permission, 'paths'))
    } else if (permission.id === PLUGIN_PERMISSION_IDS.FS_WRITE) {
      write.push(...readStringArrayParameter(permission, 'paths'))
    }
  }
  return Object.freeze({ read: Object.freeze(read), write: Object.freeze(write) })
}

/** Gathers `net.fetch` declarations into the domain allow-list `createPluginFetchGate` expects. */
export function resolvePluginNetDomains(
  permissions: readonly DomainPackageRequestedPermission[]
): ReadonlySet<string> {
  const domains = new Set<string>()
  for (const permission of permissions) {
    if (permission.id !== PLUGIN_PERMISSION_IDS.NET_FETCH) continue
    for (const domain of readStringArrayParameter(permission, 'domains')) {
      domains.add(domain)
    }
  }
  return domains
}

export type PermissionCapabilityDefaults = Readonly<{
  effect: CapabilityEffect
  approval: CapabilityApprovalMode
}>

/**
 * Default `{ effect, approval }` for a plugin permission, expressed entirely in
 * terms of the existing `capabilityEffectSchema`/`capabilityApprovalModeSchema`.
 * These are starting defaults for whoever wires a plugin permission into an
 * agent-facing capability descriptor — not a runtime enforcement decision by
 * themselves. `net.fetch` and `fs.write` default to requiring confirmation
 * because they can affect state or data outside the plugin's own sandbox;
 * `fs.read` defaults to no extra approval because Node's `--allow-fs-read`
 * already bounds it to the declared paths before this ever runs.
 */
export function derivePermissionCapabilityDefaults(
  permission: DomainPackageRequestedPermission
): PermissionCapabilityDefaults {
  switch (permission.id) {
    case PLUGIN_PERMISSION_IDS.FS_READ:
      return { effect: 'read', approval: 'none' }
    case PLUGIN_PERMISSION_IDS.FS_WRITE:
      return { effect: 'workspace-write', approval: 'confirmation' }
    case PLUGIN_PERMISSION_IDS.NET_FETCH:
      return { effect: 'external-write', approval: 'confirmation' }
    default:
      // Unknown permission IDs are not fs/net — this module only maps the three
      // it knows about. Callers should fall back to their own default for
      // anything else rather than treat this as exhaustive.
      return { effect: 'compute', approval: 'confirmation' }
  }
}
