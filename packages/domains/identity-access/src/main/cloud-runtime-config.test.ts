import { describe, expect, it } from 'vitest'
import {
  inspectDesktopIdentityConfiguration,
  resolveDesktopIdentityRuntimeConfig
} from './cloud-runtime-config.js'

describe('Desktop Cloud configuration', () => {
  it('resolves both endpoints from package settings when the environment is empty', () => {
    expect(resolveDesktopIdentityRuntimeConfig({
      settings: {
        oidcIssuer: 'https://identity.example.test/realms/SciForge',
        cloudBaseUrl: 'https://cloud.example.test'
      }
    })).toEqual({
      mode: 'http',
      issuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test'
    })
  })

  it('lets an explicit saved setting override only its matching environment value', () => {
    const status = inspectDesktopIdentityConfiguration({
      oidcIssuer: 'https://environment.example.test/realms/SciForge',
      cloudBaseUrl: 'https://cloud.example.test',
      settings: { oidcIssuer: 'https://saved.example.test/realms/SciForge' }
    })

    expect(status.oidcIssuer).toBe('https://saved.example.test/realms/SciForge')
    expect(status.cloudBaseUrl).toBe('https://cloud.example.test')
    expect(status.source).toEqual({
      oidcIssuer: 'settings',
      cloudBaseUrl: 'environment'
    })
    expect(status.missing).toEqual([])
    expect(status.invalid).toEqual([])
    expect(status.error).toBeNull()
  })

  it('names the missing endpoints and both configuration routes', () => {
    const status = inspectDesktopIdentityConfiguration({})
    expect(status.missing).toEqual(['oidcIssuer', 'cloudBaseUrl'])
    expect(status.error).toContain('the OIDC issuer')
    expect(status.error).toContain('the SciForge Cloud service address')
    expect(status.error).toContain('Account settings')
    expect(status.error).toContain('SCIFORGE_OIDC_ISSUER')
    expect(status.error).toContain('SCIFORGE_CLOUD_BASE_URL')
  })

  it('names only the endpoint that is still missing', () => {
    const status = inspectDesktopIdentityConfiguration({
      oidcIssuer: 'https://identity.example.test/realms/SciForge'
    })
    expect(status.missing).toEqual(['cloudBaseUrl'])
    expect(status.error).toContain('the SciForge Cloud service address')
    expect(status.error).not.toContain('the OIDC issuer')
    expect(status.error).toContain('SCIFORGE_CLOUD_BASE_URL')
    expect(status.error).not.toContain('SCIFORGE_OIDC_ISSUER')
  })

  it('fails closed on a non-loopback HTTP origin and keeps the invalid field named', () => {
    const status = inspectDesktopIdentityConfiguration({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'http://cloud.example.test'
    })
    expect(status.invalid).toEqual(['cloudBaseUrl'])
    expect(status.error).toContain('must use HTTPS')
    expect(resolveDesktopIdentityRuntimeConfig({
      oidcIssuer: 'https://identity.example.test/realms/SciForge',
      cloudBaseUrl: 'http://cloud.example.test'
    })).toMatchObject({
      mode: 'disabled',
      issuer: null
    })
  })

  it('allows loopback HTTP for local development settings', () => {
    expect(resolveDesktopIdentityRuntimeConfig({
      settings: {
        oidcIssuer: 'http://127.0.0.1:8080/realms/SciForge',
        cloudBaseUrl: 'http://localhost:8787'
      }
    })).toEqual({
      mode: 'http',
      issuer: 'http://127.0.0.1:8080/realms/SciForge',
      cloudBaseUrl: 'http://localhost:8787'
    })
  })
})
