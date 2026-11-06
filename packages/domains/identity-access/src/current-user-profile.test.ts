import { describe, expect, it } from 'vitest'
import { createCurrentUserProfileService } from './current-user-profile.js'

describe('current user profile', () => {
  it('reads the live user and projects only the two attribution fields', () => {
    let identity: any = undefined
    const service = createCurrentUserProfileService(() => identity)
    expect(service.read()).toEqual({ state: 'unavailable' })
    identity = { state: 'signed-out' }
    expect(service.read()).toEqual({ state: 'signed-out' })
    identity = { state: 'signed-in', user: { userId: 'user-a', displayName: '同名',
      email: 'private@example.test', accessToken: 'never-export' } }
    expect(service.read()).toEqual({ state: 'signed-in', userId: 'user-a', displayName: '同名' })
    identity = { state: 'signed-in', user: { userId: 'user-b', displayName: '同名' } }
    expect(service.read()).toMatchObject({ userId: 'user-b' })
    identity = { state: 'signed-out' }
    expect(service.read()).toEqual({ state: 'signed-out' })
  })
})
