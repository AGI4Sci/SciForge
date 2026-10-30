import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { workspaceObservationSchema, workspaceStructuredSelectionSchema } from '../../../../src/shared/workspace-preview/index.js'
import { workspaceDeckPptxPreviewInputSchema, workspaceDeckPreviewInputSchema } from './contract.js'
import {
  createWorkspaceDeckPptxPreview,
  createWorkspaceDeckPreview,
  updateWorkspaceDeckPptxTextElement
} from './workspace-deck-engine.js'
import { WorkspaceDeckService } from './service.js'

describe('workspace deck engine', () => {
  it('summarizes bounded slide metadata into a deck observation', () => {
    const preview = createWorkspaceDeckPreview(workspaceDeckPreviewInputSchema.parse({
      path: 'talk.pptx',
      slides: [
        { id: 's2', index: 1, title: 'Results', notes: 'Check assay result.' },
        { id: 's1', index: 0, title: 'Title' }
      ]
    }))

    assert.equal(preview.slideCount, 2)
    assert.equal(preview.elementCount, 0)
    assert.deepEqual(preview.elements, [])
    assert.equal(preview.observation.slides[0]?.id, 's1')
    assert.equal(workspaceObservationSchema.parse(preview.observation).view.pluginId, 'deck')
  })

  it('extracts a lightweight pptx summary from OpenXML zip parts', async () => {
    const bytes = await createMinimalPptxBytes()
    const preview = await createWorkspaceDeckPptxPreview(workspaceDeckPptxPreviewInputSchema.parse({
      path: 'talk.pptx',
      bytes
    }))

    assert.equal(preview.slideCount, 2)
    assert.equal(preview.notesCount, 1)
    assert.equal(preview.elementCount, 5)
    assert.equal(preview.commentCount, 1)
    assert.equal(preview.truncatedComments, false)
    assert.equal(preview.observation.file.mimeType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    assert.equal(preview.observation.slides[0]?.title, 'Methods')
    assert.match(preview.observation.visibleText ?? '', /Slide 2: Results/)

    const resultsSlide = preview.observation.slides.find((slide) => slide.title === 'Results')
    assert.ok(resultsSlide)
    assert.match(resultsSlide.notes ?? '', /Text: Assay response increased/)
    assert.match(resultsSlide.notes ?? '', /Speaker notes: Mention replicated wells/)
    assert.deepEqual(preview.elements.map((element) => element.kind), ['title', 'body', 'title', 'body', 'notes'])
    assert.ok(preview.elements.find((element) =>
      element.slideId === resultsSlide.id &&
      element.kind === 'body' &&
      element.text === 'Assay response increased after treatment.'
    ))
    assert.ok(preview.elements.find((element) =>
      element.slideId === resultsSlide.id &&
      element.kind === 'notes' &&
      element.text === 'Mention replicated wells and follow-up validation.'
    ))
    assert.equal(preview.observation.deck?.textElementCount, 5)
    assert.equal(preview.observation.deck?.truncatedTextElements, false)
    assert.deepEqual(preview.observation.deck?.slidePreviews?.[0], {
      slideId: 'slide2',
      index: 0,
      width: 12_192_000,
      height: 6_858_000,
      textBoxes: [
        {
          elementId: 'slide2:slide-1',
          kind: 'title',
          text: 'Methods',
          x: 914_400,
          y: 457_200,
          width: 10_363_200,
          height: 914_400
        },
        {
          elementId: 'slide2:slide-2',
          kind: 'body',
          text: 'Cells were profiled with a compact panel.',
          x: 914_400,
          y: 1_828_800,
          width: 10_363_200,
          height: 3_657_600
        }
      ]
    })
    assert.deepEqual(
      preview.observation.deck?.textElements?.map((element) => element.elementId),
      preview.elements.map((element) => element.id)
    )
    assert.deepEqual(preview.observation.deck?.textElements?.[0], {
      slideId: 'slide2',
      elementId: 'slide2:slide-1',
      kind: 'title',
      text: 'Methods'
    })
    assert.deepEqual(preview.comments[0], {
      id: 'slide1:comment-0-1',
      slideId: 'slide1',
      slideIndex: 1,
      partPath: 'ppt/comments/comment1.xml',
      authorId: '0',
      authorName: 'Dr Reviewer',
      initials: 'DR',
      index: 1,
      createdAt: '2026-07-08T00:00:00Z',
      text: 'Check assay interpretation.',
      position: { x: 10, y: 20 }
    })
    assert.ok(preview.observation.annotations?.find((annotation) =>
      annotation.id === 'slide1:comment-0-1' &&
      annotation.kind === 'pptx-comment' &&
      annotation.summary?.includes('Slide 2, Dr Reviewer') &&
      annotation.summary.includes('Check assay interpretation.')
    ))
    const parsedObservation = workspaceObservationSchema.parse(preview.observation)
    assert.equal(parsedObservation.slides?.length, 2)
    assert.equal(parsedObservation.deck?.textElements?.length, 5)
  })

  it('selects slides and text elements from the bounded preview result without file IO', async () => {
    const service = new WorkspaceDeckService()
    const preview = await service.previewPptx({
      path: 'talk.pptx',
      bytes: await createMinimalPptxBytes()
    })
    const resultsSlide = preview.observation.slides.find((slide) => slide.title === 'Results')
    assert.ok(resultsSlide)

    const slideSelection = service.selectSlide({
      preview,
      slideId: resultsSlide.id,
      maxElements: 2
    })

    assert.equal(slideSelection.slide.id, resultsSlide.id)
    assert.equal(slideSelection.elementCount, 3)
    assert.equal(slideSelection.elements.length, 2)
    assert.equal(slideSelection.truncatedElements, true)
    assert.equal(slideSelection.selection.kind, 'deck')
    assert.deepEqual(slideSelection.selection.slideIds, [resultsSlide.id])
    assert.deepEqual(slideSelection.selection.elementIds, slideSelection.elements.map((element) => element.id))
    assert.equal('slideId' in slideSelection.selection, false)
    assert.equal('slideIndex' in slideSelection.selection, false)
    assert.deepEqual(workspaceStructuredSelectionSchema.parse(slideSelection.selection), slideSelection.selection)
    assert.match(slideSelection.visibleText ?? '', /Selected slide 2: Results/)

    const noteSelection = service.selectText({
      preview,
      query: 'replicated wells',
      kind: 'notes'
    })

    assert.equal(noteSelection.elementCount, 1)
    assert.equal(noteSelection.elements[0]?.kind, 'notes')
    assert.deepEqual(noteSelection.selection.slideIds, [resultsSlide.id])
    assert.deepEqual(workspaceStructuredSelectionSchema.parse(noteSelection.selection), noteSelection.selection)
    assert.match(noteSelection.visibleText ?? '', /replicated wells/)

    const titleSelection = service.selectText({
      preview,
      kind: 'title'
    })
    assert.deepEqual(titleSelection.selection.slideIds, preview.observation.slides.map((slide) => slide.id))
    assert.deepEqual(workspaceStructuredSelectionSchema.parse(titleSelection.selection), titleSelection.selection)

    const indexSelection = service.selectSlide({
      preview,
      index: 0
    })
    assert.equal(indexSelection.slide.title, 'Methods')
  })

  it('updates one pptx text element in memory and observes the new bounded text', async () => {
    const bytes = await createMinimalPptxBytes()
    const preview = await createWorkspaceDeckPptxPreview(workspaceDeckPptxPreviewInputSchema.parse({
      path: 'talk.pptx',
      bytes
    }))
    const target = preview.elements.find((element) =>
      element.slideId === 'slide1' &&
      element.kind === 'body' &&
      element.text === 'Assay response increased after treatment.'
    )
    assert.ok(target)

    const updated = await updateWorkspaceDeckPptxTextElement({
      bytes,
      slideId: target.slideId,
      elementId: target.id,
      text: 'Assay response remained stable after washout.'
    })
    const updatedZip = await JSZip.loadAsync(updated.bytes)
    const observed = await createWorkspaceDeckPptxPreview(workspaceDeckPptxPreviewInputSchema.parse({
      path: 'talk.pptx',
      bytes: updated.bytes
    }))

    assert.equal(updated.source, 'slide')
    assert.equal(updated.partPath, 'ppt/slides/slide1.xml')
    assert.ok(updatedZip.file('[Content_Types].xml'))
    assert.ok(updatedZip.file('ppt/notesSlides/notesSlide1.xml'))
    assert.ok(observed.elements.find((element) =>
      element.slideId === target.slideId &&
      element.id === target.id &&
      element.text === 'Assay response remained stable after washout.'
    ))
    assert.equal(
      observed.elements.find((element) => element.id === 'slide1:notes-3')?.text,
      'Mention replicated wells and follow-up validation.'
    )
  })
})

async function createMinimalPptxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rIdAuthors" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/>
</Relationships>`)
  zip.file('ppt/commentAuthors.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cmAuthor id="0" name="Dr Reviewer" initials="DR" lastIdx="1" clrIdx="0"/>
</p:cmAuthorLst>`)
  zip.file('ppt/slides/slide1.xml', slideXml('Results', 'Assay response increased after treatment.'))
  zip.file('ppt/slides/slide2.xml', slideXml('Methods', 'Cells were profiled with a compact panel.'))
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  <Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>
</Relationships>`)
  zip.file('ppt/notesSlides/notesSlide1.xml', notesXml('Mention replicated wells and follow-up validation.'))
  zip.file('ppt/comments/comment1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cm authorId="0" dt="2026-07-08T00:00:00Z" idx="1">
    <p:pos x="10" y="20"/>
    <p:text>Check assay interpretation.</p:text>
  </p:cm>
</p:cmLst>`)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

function slideXml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="1" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10363200" cy="914400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="10363200" cy="3657600"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function notesXml(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${notes}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
}
