import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'

// Renderer tests run in Node, while PDF.js initializes against browser geometry
// primitives at module load time. Use the existing native canvas implementation
// so tests exercise real geometry objects instead of feature-specific stubs.
Object.assign(globalThis, {
  DOMMatrix: globalThis.DOMMatrix ?? DOMMatrix,
  ImageData: globalThis.ImageData ?? ImageData,
  Path2D: globalThis.Path2D ?? Path2D
})
