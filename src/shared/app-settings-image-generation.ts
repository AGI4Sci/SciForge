import type { AppSettingsV1, ImageGenerationSettingsPatchV1, ImageGenerationSettingsV1 } from './app-settings-types'

export function defaultImageGenerationSettings(): ImageGenerationSettingsV1 {
  return {
    componentSegmentationRunnerPath: '',
    componentSegmentationModelPath: ''
  }
}

export function normalizeImageGenerationSettings(
  input: ImageGenerationSettingsPatchV1 | undefined
): ImageGenerationSettingsV1 {
  const defaults = defaultImageGenerationSettings()
  return {
    componentSegmentationRunnerPath:
      optionalString(input?.componentSegmentationRunnerPath) ||
      optionalString(input?.fastSamRunnerPath) ||
      defaults.componentSegmentationRunnerPath,
    componentSegmentationModelPath:
      optionalString(input?.componentSegmentationModelPath) ||
      optionalString(input?.fastSamModelPath) ||
      defaults.componentSegmentationModelPath
  }
}

export function mergeImageGenerationSettings(
  current: ImageGenerationSettingsV1 | undefined,
  patch: ImageGenerationSettingsPatchV1 | undefined
): ImageGenerationSettingsV1 {
  const normalizedCurrent = normalizeImageGenerationSettings(current)
  if (!patch) return normalizedCurrent
  return {
    componentSegmentationRunnerPath:
      'componentSegmentationRunnerPath' in patch || 'fastSamRunnerPath' in patch
        ? optionalString(patch.componentSegmentationRunnerPath) ||
          optionalString(patch.fastSamRunnerPath)
        : normalizedCurrent.componentSegmentationRunnerPath,
    componentSegmentationModelPath:
      'componentSegmentationModelPath' in patch || 'fastSamModelPath' in patch
        ? optionalString(patch.componentSegmentationModelPath) ||
          optionalString(patch.fastSamModelPath)
        : normalizedCurrent.componentSegmentationModelPath
  }
}

export function getImageGenerationSettings(settings: AppSettingsV1): ImageGenerationSettingsV1 {
  return normalizeImageGenerationSettings(
    (settings as { imageGeneration?: ImageGenerationSettingsPatchV1 }).imageGeneration
  )
}

export function imageGenerationSettingsPatch(
  patch: ImageGenerationSettingsPatchV1 | undefined
): { imageGeneration?: ImageGenerationSettingsPatchV1 } {
  return patch ? { imageGeneration: patch } : {}
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
