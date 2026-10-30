import { describe, expect, it } from 'vitest'
import {
  BundledPdfCMapReaderFactory,
  pdfJsRendererOptions
} from './pdfjs-cmap-assets'

describe('bundled PDF.js CMaps', () => {
  it('includes and decodes the packed Chinese Adobe CMap assets', async () => {
    const factory = new BundledPdfCMapReaderFactory()
    const simplifiedChinese = await factory.fetch({ name: 'Adobe-GB1-UCS2' })
    const traditionalChinese = await factory.fetch({ name: 'Adobe-CNS1-UCS2' })

    expect(simplifiedChinese.isCompressed).toBe(true)
    expect(simplifiedChinese.cMapData.byteLength).toBeGreaterThan(100)
    expect(traditionalChinese.isCompressed).toBe(true)
    expect(traditionalChinese.cMapData.byteLength).toBeGreaterThan(100)
  })

  it('configures the canonical renderer source to use the bundled factory', () => {
    expect(pdfJsRendererOptions()).toEqual({
      CMapReaderFactory: BundledPdfCMapReaderFactory,
      cMapPacked: true,
      isEvalSupported: false,
      useSystemFonts: true
    })
  })

  it('rejects CMap names outside the bundled manifest', async () => {
    const factory = new BundledPdfCMapReaderFactory()
    await expect(factory.fetch({ name: '../missing' })).rejects.toThrow(
      'Bundled PDF CMap is unavailable'
    )
  })
})
