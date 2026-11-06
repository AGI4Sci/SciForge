import packageJson from '../../package.json' with { type: 'json' }

/** Backend identity comes from the independently installed plugin package. */
export const ANCHORED_COMMENTS_PLUGIN_PACKAGE_NAME = packageJson.name
export const ANCHORED_COMMENTS_PLUGIN_VERSION = packageJson.version
