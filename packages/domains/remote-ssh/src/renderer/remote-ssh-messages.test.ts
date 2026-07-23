import { describe, expect, it } from 'vitest'
import {
  remoteSshI18nResourceContribution,
  remoteSshMessages
} from './remote-ssh-messages'

describe('Remote SSH messages', () => {
  it('keeps the package-owned English and Chinese catalogs aligned', () => {
    const englishKeys = Object.keys(remoteSshMessages.en).sort()
    const chineseKeys = Object.keys(remoteSshMessages.zh).sort()

    expect(chineseKeys).toEqual(englishKeys)
    expect(englishKeys).toContain('rightPanelRemoteSsh')
    expect(englishKeys).not.toContain('rightPanelCollapse')
  })

  it('exposes translations as immutable data without registration side effects', () => {
    expect(remoteSshI18nResourceContribution.namespace).toBe('common')
    expect(remoteSshI18nResourceContribution.resources.en.remoteSshTitle).toBe('Remote Targets')
    expect(Object.isFrozen(remoteSshMessages)).toBe(true)
    expect(Object.isFrozen(remoteSshMessages.en)).toBe(true)
  })

  it('keeps VirtualBox as the guided default and Docker as an advanced option', () => {
    expect(remoteSshMessages.en.remoteSshEnvironmentProviderVm).toContain('recommended')
    expect(remoteSshMessages.en.remoteSshEnvironmentProviderDocker).toContain('advanced')
    expect(remoteSshMessages.zh.remoteSshVmRequirements).toContain('OpenSSH server')
    expect(remoteSshMessages.zh.remoteSshOnboardingVpnBody).toContain('VM')
  })
})
