import { describe, expect, it } from 'vitest'
import type {
  RemoteSshLab,
  RemoteSshTargetProbeResult,
  RemoteSshTarget,
  RemoteSshTargetBinding
} from '../contract'
import {
  REMOTE_SSH_OPENSSH_TEMPLATE,
  groupRemoteSshTargets,
  handlesByTargetId,
  probeDisplay,
  remoteSshGeneratedGatewayAlias,
  remoteSshOnboardingAction
} from './RemoteSshPanel'
import { remoteSshMessages } from './remote-ssh-messages'

const now = '2026-07-22T00:00:00.000Z'
const lab = (id: string, displayName: string): RemoteSshLab => ({
  schemaVersion: 2,
  id,
  displayName,
  environment: {
    provider: 'vm',
    driver: 'virtualbox',
    vmId: `${id}-vm`,
    gatewaySshAlias: `${id}-gateway`
  },
  maxConcurrentExecutions: 8,
  revision: `${id}-r1`,
  createdAt: now,
  updatedAt: now
})
const target = (id: string, labId: string, displayName: string): RemoteSshTarget => ({
  schemaVersion: 2,
  id,
  labId,
  displayName,
  sshAlias: id,
  labels: {},
  capabilities: ['shell'],
  maxConcurrentExecutions: 2,
  revision: `${id}-r1`,
  createdAt: now,
  updatedAt: now
})
const binding = (value: RemoteSshTarget): RemoteSshTargetBinding => ({
  target: {
    id: value.id,
    labId: value.labId,
    displayName: value.displayName,
    labels: value.labels,
    capabilities: value.capabilities,
    maxConcurrentExecutions: value.maxConcurrentExecutions
  },
  resource: {
    token: 'cap_1234567890abcdefghij',
    semanticRevision: value.revision,
    expiresAt: '2026-07-23T00:00:00.000Z'
  }
})
const translate = (key: string): string => key

describe('RemoteSshPanel helpers', () => {
  it('groups and sorts targets by lab while retaining orphaned target records', () => {
    const labs = [lab('lab-z', 'Z Lab'), lab('lab-a', 'A Lab')]
    const targets = [
      target('gpu-z', 'lab-a', 'Z GPU'),
      target('gpu-a', 'lab-a', 'A GPU'),
      target('orphan', 'missing-lab', 'Orphan')
    ]

    const groups = groupRemoteSshTargets(labs, targets)

    expect(groups.map((group) => group.lab?.id ?? null)).toEqual(['lab-a', 'lab-z', null])
    expect(groups[0]?.targets.map((item) => item.id)).toEqual(['gpu-a', 'gpu-z'])
    expect(groups[2]?.targets[0]?.id).toBe('orphan')
  })

  it('merges opaque handles by target ID without using catalog aliases', () => {
    const first = binding(target('gpu-a', 'lab-a', 'GPU A'))

    expect(handlesByTargetId([first])).toEqual({ 'gpu-a': first.resource })
  })

  it('maps probe results to compact user-facing states', () => {
    const reachable: RemoteSshTargetProbeResult = {
      targetId: 'gpu-a',
      target: { status: 'reachable', latencyMs: 12 },
      ready: true,
      checkedAt: now
    }
    const authenticationFailure: RemoteSshTargetProbeResult = {
      targetId: 'gpu-a',
      target: { status: 'auth-failed' },
      ready: false,
      checkedAt: now
    }

    expect(probeDisplay(undefined, translate).label).toBe('remoteSshStatusUnknown')
    expect(probeDisplay(reachable, translate).label).toBe('remoteSshStatusReachable')
    expect(probeDisplay(authenticationFailure, translate).label).toBe('remoteSshStatusAuthRequired')
  })

  it('provides a credential-free target template while SciForge owns the environment proxy', () => {
    expect(REMOTE_SSH_OPENSSH_TEMPLATE).toContain('Host sciforge-lab-target')
    expect(REMOTE_SSH_OPENSSH_TEMPLATE).not.toContain('ProxyJump')
    expect(REMOTE_SSH_OPENSSH_TEMPLATE).not.toContain('ProxyCommand')
    expect(REMOTE_SSH_OPENSSH_TEMPLATE).not.toMatch(/password|token|passphrase/i)
  })

  it('generates a stable collision-resistant SSH gateway alias from the selected VM', () => {
    expect(remoteSshGeneratedGatewayAlias({
      name: 'VPN Windows（AI Lab）',
      uuid: '656fd089-5659-41c7-9f67-963bf059181e'
    })).toBe('sciforge-vpn-windows-ai-lab-656fd089')
    expect(remoteSshGeneratedGatewayAlias({
      name: '实验室',
      uuid: '11111111-2222-4333-8444-555555555555'
    })).toBe('sciforge-vm-11111111')
  })

  it('describes the VM-first onboarding path and keeps Docker advanced', () => {
    const onboardingMessages = [
      remoteSshMessages.en.remoteSshOnboardingIntro,
      remoteSshMessages.en.remoteSshOnboardingVmBody,
      remoteSshMessages.en.remoteSshOnboardingVpnBody,
      remoteSshMessages.en.remoteSshOnboardingSshBody,
      remoteSshMessages.zh.remoteSshOnboardingIntro,
      remoteSshMessages.zh.remoteSshOnboardingVmBody,
      remoteSshMessages.zh.remoteSshOnboardingVpnBody,
      remoteSshMessages.zh.remoteSshOnboardingSshBody
    ].join('\n')

    expect(onboardingMessages).toContain('VirtualBox')
    expect(onboardingMessages).toContain('OpenSSH server')
    expect(onboardingMessages).toContain('inside the VM')
    expect(remoteSshMessages.en.remoteSshEnvironmentProviderDocker).toContain('advanced')
    expect(remoteSshMessages.zh.remoteSshEnvironmentProviderDocker).toContain('高级')
    expect(onboardingMessages).not.toMatch(/sidecar|docker exec|\bnc\b|旁车/i)
    expect(remoteSshMessages.en.remoteSshTemplateHint).toContain('%USERPROFILE%')
    expect(remoteSshMessages.zh.remoteSshTemplateHint).toContain('%USERPROFILE%')
  })

  it('advances onboarding from lab creation through VM login to target registration', () => {
    const firstLab = lab('lab-a', 'A Lab')

    expect(remoteSshOnboardingAction(undefined, undefined)).toBe('create-lab')
    expect(remoteSshOnboardingAction(firstLab, undefined)).toBe('ensure-environment')
    expect(remoteSshOnboardingAction(firstLab, {
      labId: firstLab.id,
      provider: 'vm',
      state: 'starting',
      consoleAvailable: false,
      checkedAt: now
    })).toBe('refresh')
    expect(remoteSshOnboardingAction(firstLab, {
      labId: firstLab.id,
      provider: 'vm',
      state: 'login-required',
      consoleAvailable: true,
      checkedAt: now
    })).toBe('open-console')
    expect(remoteSshOnboardingAction(firstLab, {
      labId: firstLab.id,
      provider: 'vm',
      state: 'ready',
      consoleAvailable: true,
      checkedAt: now
    })).toBe('add-target')
  })
})
