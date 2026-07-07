import { describe, expect, it } from 'vitest'
import {
  extractToolResultImages,
  toolResultTextWithoutImages
} from './tool-result-image'

describe('tool-result image helpers', () => {
  it('extracts direct read-tool images and computer screenshots', () => {
    expect(extractToolResultImages({
      kind: 'image',
      mime_type: 'image/png',
      data_base64: 'AAA',
      width: 10
    })).toEqual([{ mimeType: 'image/png', dataBase64: 'AAA', width: 10 }])

    expect(extractToolResultImages({
      kind: 'computer_screenshot',
      images: [{ mime_type: 'image/jpeg', data_base64: 'BBB', height: 20 }]
    })).toEqual([{ mimeType: 'image/jpeg', dataBase64: 'BBB', height: 20 }])
  })

  it('extracts MCP image content from wrapped computer-use results without textifying base64', () => {
    const output = {
      serverId: 'gui_owl_computer_use',
      toolName: 'computer_use',
      result: {
        content: [
          { type: 'text', text: 'Screenshot is 10x20px.' },
          { type: 'image', data: 'abc123', mimeType: 'image/png' }
        ],
        structuredContent: {
          kind: 'computer_screenshot',
          action: 'screenshot',
          screen: { width: 10, height: 20 },
          images: [{ mime_type: 'image/png', width: 10, height: 20 }]
        }
      }
    }

    expect(extractToolResultImages(output)).toEqual([{
      mimeType: 'image/png',
      dataBase64: 'abc123',
      width: 10,
      height: 20
    }])
    expect(toolResultTextWithoutImages(output)).not.toContain('abc123')
  })
})
