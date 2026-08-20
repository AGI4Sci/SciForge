import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as contract from './contract.js'
import {
  OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID,
  OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID,
  OPENCONTENT_SKILL_SOURCE_ZIP_SHA256,
  admitOpenContentSkillRuntimeOwner,
  openContentSkillErrorSchema,
  openContentSkillExecutionBindingSchema
} from './contract.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('OpenContent skill runtime contract', () => {
  it('is publishable, main-only, and contains no private attachment metadata', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      private?: unknown
      license?: unknown
      exports?: Record<string, unknown>
      files?: string[]
      sciforgeInternal?: unknown
    }

    expect(packageJson.private).toBe(false)
    expect(packageJson.license).toBe('MIT')
    expect(Object.keys(packageJson.exports ?? {})).toEqual([
      './main-contract',
      './main/bundled-assets',
      './main/cli-runner',
      './main/docflow-native-document-adapter',
      './main/native-document-provider-adapter',
      './main/extended-operation-adapter',
      './main/node-cli-process-port'
    ])
    expect(packageJson.files).toEqual(['src', 'README.md'])
    expect(packageJson.sciforgeInternal).toBeUndefined()
  })

  it('admits only the exact Connector transport and Content Space Provider adapter roles', () => {
    expect(admitOpenContentSkillRuntimeOwner({
      role: 'transport-owner',
      moduleId: OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID,
      moduleVersion: '1.0.0'
    })).toEqual({
      role: 'transport-owner',
      moduleId: OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID,
      moduleVersion: '1.0.0'
    })
    expect(admitOpenContentSkillRuntimeOwner({
      role: 'adapter-owner',
      moduleId: OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID,
      moduleVersion: '1.0.0'
    }).role).toBe('adapter-owner')
    for (const rejected of [
      {
        role: 'transport-owner',
        moduleId: OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID,
        moduleVersion: '1.0.0'
      },
      {
        role: 'adapter-owner',
        moduleId: OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID,
        moduleVersion: '1.0.0'
      },
      {
        role: 'adapter-owner',
        moduleId: 'sciforge.content-space',
        moduleVersion: '1.0.0'
      }
    ]) {
      expect(() => admitOpenContentSkillRuntimeOwner(rejected)).toThrow()
    }
  })

  it('exports no parallel authorization, effect, proposal, or apply layer', () => {
    expect(Object.keys(contract).sort()).toEqual([
      'OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID',
      'OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID',
      'OPENCONTENT_SKILL_SOURCE_ZIP_SHA256',
      'admitOpenContentSkillRuntimeOwner',
      'openContentSkillErrorSchema',
      'openContentSkillExecutionBindingSchema',
      'openContentSkillRuntimeOwnerSchema'
    ])
  })

  it('binds execution to the minimal core-issued context', () => {
    const binding = {
      providerInstanceRef: 'provider-instance-a',
      invocationId: 'invocation-a',
      deadlineAt: '2026-08-20T00:05:00.000Z'
    }
    expect(openContentSkillExecutionBindingSchema.parse(binding)).toEqual(binding)
    for (const injected of [
      { token: 'secret' },
      { endpoint: 'https://provider.invalid' },
      { providerFileId: '42' },
      { principalLeaseId: 'invented-lease' },
      { connectionLeaseId: 'invented-lease' },
      { resourceGrantId: 'invented-grant' }
    ]) {
      expect(() => openContentSkillExecutionBindingSchema.parse({
        ...binding,
        ...injected
      })).toThrow()
    }
  })

  it('keeps unknown outcomes permanently non-retryable and pins source provenance', () => {
    expect(openContentSkillErrorSchema.parse({
      code: 'outcome-unknown',
      message: 'The Provider mutation outcome cannot be proven.',
      retry: 'never'
    }).retry).toBe('never')
    expect(() => openContentSkillErrorSchema.parse({
      code: 'outcome-unknown',
      message: 'The Provider mutation outcome cannot be proven.',
      retry: 'same-invocation'
    })).toThrow()
    expect(OPENCONTENT_SKILL_SOURCE_ZIP_SHA256)
      .toBe('2147c0ab8b571fd973575f04f0fd21537fb1918287f117cbe5c1e1959e083ae4')
  })
})
