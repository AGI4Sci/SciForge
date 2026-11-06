import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { pluginExactVersionSchema, pluginPackageNameSchema } from '@sciforge/plugin-sdk'

export const PLUGIN_CONTRACT_PINS_FILE_NAME = 'plugin-contract-pins.json'

const exactPackageVersionSchema = z.string().max(280).refine((key) => {
  const separator = key.lastIndexOf('@')
  return separator > 0
    && pluginPackageNameSchema.safeParse(key.slice(0, separator)).success
    && pluginExactVersionSchema.safeParse(key.slice(separator + 1)).success
}, 'Use an exact canonical package@version identity.')

const identifierSchema = z.string().min(1).max(192).refine(value => value.trim() === value)
const pinSchema = z.object({
  hostServices: z.array(identifierSchema).max(64),
  dshConfig: z.record(z.string(), z.json()).optional(),
  uiCapabilities: z.array(identifierSchema).max(64).optional(),
  uiResourceKinds: z.array(identifierSchema).max(32).optional()
}).strict()
const policySchema = z.object({
  schemaVersion: z.literal(1),
  pins: z.record(exactPackageVersionSchema, pinSchema)
}).strict()

export type PluginContractPin = Readonly<{
  hostServices: readonly string[]
  dshConfig?: Readonly<Record<string, unknown>>
  uiCapabilities?: readonly string[]
  uiResourceKinds?: readonly string[]
}>
export type PluginContractPins = Readonly<Record<string, PluginContractPin>>
export type PluginContractPinsLoadOptions = Readonly<{
  appPath: string
  resourcesPath: string
  isPackaged: boolean
}>

/** Release-owned reviewed policy, using the same resource layout as official keys.
 * Never read plugin declarations, profile approvals or development overrides here.
 */
export function resolvePluginContractPinsPath(options: PluginContractPinsLoadOptions): string {
  return resolve(
    options.isPackaged ? options.resourcesPath : resolve(options.appPath, 'resources'),
    'extensions',
    PLUGIN_CONTRACT_PINS_FILE_NAME
  )
}

export async function loadPluginContractPins(options: PluginContractPinsLoadOptions): Promise<PluginContractPins> {
  const path = resolvePluginContractPinsPath(options)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`Could not read the Host plugin contract policy at ${path}.`, { cause: error })
  }
  try {
    // Missing/invalid policy fails closed; it must never fall back to package data.
    const policy = policySchema.parse(JSON.parse(raw))
    return freezeJson(policy.pins)
  } catch (error) {
    throw new Error(`The Host plugin contract policy at ${path} is invalid.`, { cause: error })
  }
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}
