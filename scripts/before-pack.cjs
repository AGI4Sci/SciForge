const nativeRuntimeDependencies = require('./native-runtime-dependencies.cjs')

async function beforePack(context) {
  nativeRuntimeDependencies.ensureNativeRuntimeDependencies({
    projectDir: context.packager?.projectDir || process.cwd(),
    platform: context.electronPlatformName,
    arch: context.arch
  })
}

exports.default = beforePack
exports._internals = { beforePack }
