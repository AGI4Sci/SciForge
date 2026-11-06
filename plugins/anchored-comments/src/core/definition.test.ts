import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }
import {
  ANCHORED_COMMENTS_PLUGIN_PACKAGE_NAME,
  ANCHORED_COMMENTS_PLUGIN_VERSION
} from './definition'

describe('Anchored Comments plugin identity', () => {
  it('uses the installed plugin package identity and version', () => {
    expect(ANCHORED_COMMENTS_PLUGIN_PACKAGE_NAME).toBe('@sciforge/plugin-anchored-comments')
    expect(ANCHORED_COMMENTS_PLUGIN_PACKAGE_NAME).toBe(packageJson.name)
    expect(ANCHORED_COMMENTS_PLUGIN_VERSION).toBe(packageJson.version)
  })
})
