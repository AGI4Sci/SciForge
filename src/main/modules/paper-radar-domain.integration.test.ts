import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAPER_RADAR_CAPABILITY_IDS } from '@sciforge/domain-paper-radar/contract'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from '../capabilities/agent-tools'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('installed Paper Radar domain package', () => {
  it('exposes the same package-owned handler through agent discovery and generic invocation', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-paper-radar-domain-'))
    temporaryDirectories.push(userDataDir)
    const catalog = createApplicationDomainCatalog({ getUserDataDir: () => userDataDir })
    const broker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    )
    const agent = createCapabilityAgentToolSurface({
      broker,
      resolveCaller: () => ({ audience: 'agent', callerId: 'paper-radar-domain-test' })
    })
    const context = {
      requestId: 'request-1',
      runtimeId: 'codex',
      threadId: 'thread-1'
    }

    const discovery = await agent.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { tags: ['paper-radar'] },
      context
    })
    expect(discovery.tool).toBe(CAPABILITY_AGENT_TOOL_NAMES.discover)
    if (discovery.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected capability discovery result.')
    }
    expect(discovery.value).toHaveLength(Object.keys(PAPER_RADAR_CAPABILITY_IDS).length)
    const status = discovery.value.find(({ title }) => title === 'Read Paper Radar status')
    expect(status).toBeDefined()

    const invocation = await agent.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: status?.operationRef, input: {} },
      context
    })
    expect(invocation).toMatchObject({
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      value: {
        operationRef: status?.operationRef,
        output: { ok: true, service: 'sciforge.paper-radar' }
      }
    })

    const profilesPath = join(userDataDir, 'paper-radar', 'profiles.json')
    const saveInvocationId = 'paper-radar-save-confirmed-1'
    const saveRequest = {
      actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
      invocationId: saveInvocationId,
      input: {
        name: 'approved-profile',
        keywords: ['protein design'],
        excludeKeywords: [],
        arxivCategories: ['q-bio'],
        biorxivSubjects: []
      }
    }
    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'paper-radar-domain-test-ui'
    }, saveRequest)).rejects.toMatchObject({
      code: 'approval_denied'
    })
    await expect(access(profilesPath)).rejects.toBeDefined()

    await expect(broker.invoke({
      audience: 'ui',
      callerId: 'paper-radar-domain-test-ui',
      approvals: [{
        actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
        invocationId: saveInvocationId,
        mode: 'confirmation'
      }]
    }, saveRequest)).resolves.toMatchObject({
      actionId: PAPER_RADAR_CAPABILITY_IDS.saveProfile,
      invocationId: saveInvocationId,
      output: {
        ok: true,
        data: { profile: { name: 'approved-profile' } }
      }
    })
    await expect(access(profilesPath)).resolves.toBeUndefined()

    catalog.dispose()
  })
})

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}
