import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as publicServer from './index.js'

describe('collaboration server public boundary', () => {
  it('does not publish raw authentication or OIDC verifier modules', () => {
    expect(Object.keys(publicServer)).not.toEqual(expect.arrayContaining([
      'AuthenticationService',
      'StrictOidcUserResolver',
      'OidcAccessTokenVerifier',
      'createOidcAccessTokenVerifier'
    ]))

    const manifest = JSON.parse(readFileSync(
      new URL('../package.json', import.meta.url),
      'utf8'
    )) as { exports?: Record<string, unknown> }
    expect(Object.keys(manifest.exports ?? {})).not.toEqual(expect.arrayContaining([
      './auth',
      './oidc'
    ]))
  })

  it('keeps raw bearer resolution out of public API and service declarations', () => {
    const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
    const serviceSource = readFileSync(new URL('./service.ts', import.meta.url), 'utf8')

    expect(apiSource).not.toMatch(
      /\bAuthenticationService\b|\bresolveBearer\b|\bresolveProviderActor\b/u
    )
    expect(serviceSource).not.toMatch(
      /import[^\n]+\b(?:AgentActor|AuthContext|HumanEndpointActor|UserActor)\b[^\n]+from ['"]\.\/auth\.js['"]/u
    )
  })

  it('does not leak private authentication or verifier implementations through bootstrap types', () => {
    const bootstrapSource = readFileSync(new URL('./bootstrap.ts', import.meta.url), 'utf8')

    expect(bootstrapSource).not.toMatch(/readonly authentication:\s*AuthenticationService/u)
    expect(bootstrapSource).not.toMatch(/authentication:\s*AuthenticationService/u)
    expect(bootstrapSource).not.toMatch(/OidcAccessTokenVerifierOptions/u)
  })

  it('passes only a non-secret directory into provider-owned runtimes', () => {
    const runtimeSource = readFileSync(new URL('./provider-runtime.ts', import.meta.url), 'utf8')

    expect(runtimeSource).toContain('secretFileDirectory: string')
    expect(runtimeSource).not.toMatch(
      /HumanEndpointProviderSecretReader|HumanEndpointProviderHttp(?:Request|Response)|FileProviderSecretReader|\bproviderHttp\s*\(/u
    )
  })
})
