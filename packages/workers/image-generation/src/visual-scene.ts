export const VISUAL_SCENE_VERSION = 1 as const

export type VisualSceneOwner = 'code' | 'model'

export type VisualScenePoint = {
  x: number
  y: number
}

export type VisualScenePrimitiveStyle = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
  z?: number
}

export type VisualScenePrimitive = VisualScenePrimitiveStyle & (
  | { id: string; type: 'rectangle' | 'ellipse' | 'triangle'; x: number; y: number; width: number; height: number }
  | { id: string; type: 'circle'; x: number; y: number; radius: number }
  | { id: string; type: 'polygon'; points: VisualScenePoint[] }
  | { id: string; type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | {
      id: string
      type: 'text'
      x: number
      y: number
      text: string
      fontSize?: number
      textColor?: string
      horizontalAlign?: 'left' | 'center' | 'right'
      verticalAlign?: 'top' | 'center' | 'bottom'
    }
  | {
      id: string
      type: 'image'
      x: number
      y: number
      width: number
      height: number
      prompt: string
      sourceArtifact?: string
    }
)

export type VisualSceneLayer = {
  id: string
  owner: VisualSceneOwner
  z?: number
  primitives: VisualScenePrimitive[]
}

export type VisualScene = {
  version: typeof VISUAL_SCENE_VERSION
  coordinateSystem: 'normalized'
  canvas: {
    width: number
    height: number
    background?: string
  }
  layers: VisualSceneLayer[]
}

const MAX_SCENE_LAYERS = 64
const MAX_SCENE_PRIMITIVES = 500

export function normalizeVisualScene(value: unknown): VisualScene {
  const scene = recordValue(value)
  if (scene.version !== VISUAL_SCENE_VERSION || scene.coordinateSystem !== 'normalized') {
    throw new Error('scene must use version=1 and coordinateSystem="normalized".')
  }
  const canvas = recordValue(scene.canvas)
  const width = positiveFinite(canvas.width, 'scene.canvas.width')
  const height = positiveFinite(canvas.height, 'scene.canvas.height')
  const rawLayers = arrayValue(scene.layers)
  if (rawLayers.length === 0 || rawLayers.length > MAX_SCENE_LAYERS) {
    throw new Error(`scene.layers must contain between 1 and ${MAX_SCENE_LAYERS} layers.`)
  }

  const ids = new Set<string>()
  let primitiveCount = 0
  const layers = rawLayers.map((rawLayer, layerIndex): VisualSceneLayer => {
    const layer = recordValue(rawLayer)
    const id = uniqueId(layer.id, `scene.layers[${layerIndex}].id`, ids)
    const owner = layer.owner
    if (owner !== 'code' && owner !== 'model') {
      throw new Error(`scene.layers[${layerIndex}].owner must be code or model.`)
    }
    const rawPrimitives = arrayValue(layer.primitives)
    primitiveCount += rawPrimitives.length
    if (primitiveCount > MAX_SCENE_PRIMITIVES) {
      throw new Error(`scene may contain at most ${MAX_SCENE_PRIMITIVES} primitives.`)
    }
    const primitives = rawPrimitives.map((primitive, primitiveIndex) => (
      normalizePrimitive(primitive, owner, `scene.layers[${layerIndex}].primitives[${primitiveIndex}]`, ids)
    ))
    return {
      id,
      owner,
      ...(layer.z === undefined ? {} : { z: finiteNumber(layer.z, `scene.layers[${layerIndex}].z`) }),
      primitives
    }
  })
  if (primitiveCount === 0) throw new Error('scene must contain at least one primitive.')

  return {
    version: VISUAL_SCENE_VERSION,
    coordinateSystem: 'normalized',
    canvas: {
      width,
      height,
      ...(stringValue(canvas.background) ? { background: stringValue(canvas.background) } : {})
    },
    layers
  }
}

export function visualSceneOwners(scene: VisualScene): Set<VisualSceneOwner> {
  return new Set(scene.layers.map((layer) => layer.owner))
}

export function visualSceneToScientificData(scene: VisualScene): { primitives: Array<Record<string, unknown>> } {
  const primitives = scene.layers
    .filter((layer) => layer.owner === 'code')
    .flatMap((layer) => layer.primitives.flatMap((primitive) => {
      if (primitive.type === 'image') return []
      return [{
        ...primitive,
        z: (layer.z ?? 0) + (primitive.z ?? 0)
      }]
    }))
  if (primitives.length === 0) throw new Error('A code or hybrid scene requires at least one code-owned vector primitive.')
  return { primitives }
}

export function visualSceneModelPrompt(scene: VisualScene): string {
  const layers = scene.layers.filter((layer) => layer.owner === 'model')
  if (layers.length === 0) return ''
  return [
    'Render only the model-owned layers from this normalized visual scene.',
    'Preserve the declared canvas composition. Do not add, rewrite, or imitate code-owned truth elements.',
    JSON.stringify({ canvas: scene.canvas, layers })
  ].join('\n')
}

function normalizePrimitive(
  value: unknown,
  owner: VisualSceneOwner,
  path: string,
  ids: Set<string>
): VisualScenePrimitive {
  const primitive = recordValue(value)
  const id = uniqueId(primitive.id, `${path}.id`, ids)
  const type = stringValue(primitive.type)
  const style = normalizeStyle(primitive, path)
  if (type === 'text') {
    const text = stringValue(primitive.text)
    if (!text) throw new Error(`${path}.text is required.`)
    return {
      id,
      type,
      x: ratio(primitive.x, `${path}.x`),
      y: ratio(primitive.y, `${path}.y`),
      text,
      ...(primitive.fontSize === undefined ? {} : { fontSize: positiveFinite(primitive.fontSize, `${path}.fontSize`) }),
      ...(stringValue(primitive.textColor) ? { textColor: stringValue(primitive.textColor) } : {}),
      ...(horizontalAlign(primitive.horizontalAlign) ? { horizontalAlign: horizontalAlign(primitive.horizontalAlign) } : {}),
      ...(verticalAlign(primitive.verticalAlign) ? { verticalAlign: verticalAlign(primitive.verticalAlign) } : {}),
      ...style
    }
  }
  if (type === 'line' || type === 'arrow') {
    return {
      id,
      type,
      x1: ratio(primitive.x1, `${path}.x1`),
      y1: ratio(primitive.y1, `${path}.y1`),
      x2: ratio(primitive.x2, `${path}.x2`),
      y2: ratio(primitive.y2, `${path}.y2`),
      ...style
    }
  }
  if (type === 'polygon') {
    const points = arrayValue(primitive.points)
    if (points.length < 3 || points.length > 256) throw new Error(`${path}.points must contain 3 to 256 points.`)
    return {
      id,
      type,
      points: points.map((point, index) => {
        const record = recordValue(point)
        return { x: ratio(record.x, `${path}.points[${index}].x`), y: ratio(record.y, `${path}.points[${index}].y`) }
      }),
      ...style
    }
  }
  if (type === 'circle') {
    return {
      id,
      type,
      x: ratio(primitive.x, `${path}.x`),
      y: ratio(primitive.y, `${path}.y`),
      radius: positiveRatio(primitive.radius, `${path}.radius`),
      ...style
    }
  }
  if (type === 'rectangle' || type === 'ellipse' || type === 'triangle') {
    return {
      id,
      type,
      x: ratio(primitive.x, `${path}.x`),
      y: ratio(primitive.y, `${path}.y`),
      width: positiveRatio(primitive.width, `${path}.width`),
      height: positiveRatio(primitive.height, `${path}.height`),
      ...style
    }
  }
  if (type === 'image') {
    if (owner !== 'model') throw new Error(`${path}: image primitives must be model-owned.`)
    const prompt = stringValue(primitive.prompt)
    if (!prompt) throw new Error(`${path}.prompt is required.`)
    return {
      id,
      type,
      x: ratio(primitive.x, `${path}.x`),
      y: ratio(primitive.y, `${path}.y`),
      width: positiveRatio(primitive.width, `${path}.width`),
      height: positiveRatio(primitive.height, `${path}.height`),
      prompt,
      ...(stringValue(primitive.sourceArtifact) ? { sourceArtifact: stringValue(primitive.sourceArtifact) } : {}),
      ...style
    }
  }
  throw new Error(`${path}.type is unsupported.`)
}

function normalizeStyle(value: Record<string, unknown>, path: string): VisualScenePrimitiveStyle {
  return {
    ...(stringValue(value.fill) ? { fill: stringValue(value.fill) } : {}),
    ...(stringValue(value.stroke) ? { stroke: stringValue(value.stroke) } : {}),
    ...(value.strokeWidth === undefined ? {} : { strokeWidth: nonNegativeFinite(value.strokeWidth, `${path}.strokeWidth`) }),
    ...(value.opacity === undefined ? {} : { opacity: ratio(value.opacity, `${path}.opacity`) }),
    ...(value.z === undefined ? {} : { z: finiteNumber(value.z, `${path}.z`) })
  }
}

function uniqueId(value: unknown, path: string, ids: Set<string>): string {
  const id = stringValue(value)
  if (!id) throw new Error(`${path} is required.`)
  if (ids.has(id)) throw new Error(`${path} must be unique; duplicate id ${id}.`)
  ids.add(id)
  return id
}

function ratio(value: unknown, path: string): number {
  const number = finiteNumber(value, path)
  if (number < 0 || number > 1) throw new Error(`${path} must be between 0 and 1.`)
  return number
}

function positiveRatio(value: unknown, path: string): number {
  const number = ratio(value, path)
  if (number <= 0) throw new Error(`${path} must be greater than 0.`)
  return number
}

function positiveFinite(value: unknown, path: string): number {
  const number = finiteNumber(value, path)
  if (number <= 0) throw new Error(`${path} must be greater than 0.`)
  return number
}

function nonNegativeFinite(value: unknown, path: string): number {
  const number = finiteNumber(value, path)
  if (number < 0) throw new Error(`${path} must be non-negative.`)
  return number
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`)
  return value
}

function horizontalAlign(value: unknown): 'left' | 'center' | 'right' | undefined {
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined
}

function verticalAlign(value: unknown): 'top' | 'center' | 'bottom' | undefined {
  return value === 'top' || value === 'center' || value === 'bottom' ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
