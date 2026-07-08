import { posix as pathPosix } from 'node:path'

import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

import {
  WORKSPACE_DECK_ACTIONS,
  WORKSPACE_DECK_CONTRACT_VERSION,
  WORKSPACE_DECK_MAX_NOTES_PREVIEW_CHARS,
  WORKSPACE_DECK_MAX_OBSERVATION_TEXT_ELEMENTS,
  WORKSPACE_DECK_MAX_SELECTION_ITEMS,
  WORKSPACE_DECK_MAX_SLIDE_TEXT_SNIPPET_CHARS,
  WORKSPACE_DECK_MAX_SLIDES,
  WORKSPACE_DECK_MAX_SLIDE_PREVIEWS,
  WORKSPACE_DECK_MAX_SLIDE_PREVIEW_TEXT_BOXES,
  WORKSPACE_DECK_MAX_COMMENTS,
  WORKSPACE_DECK_MAX_COMMENT_TEXT_CHARS,
  WORKSPACE_DECK_MAX_ANNOTATIONS,
  WORKSPACE_DECK_MAX_TEXT_CHARS,
  WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS,
  WORKSPACE_DECK_MAX_TEXT_ELEMENTS,
  WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_DECK_MAX_WARNINGS,
  WORKSPACE_DECK_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspaceDeckSlideSelectionInputSchema,
  workspaceDeckSlideSelectionResultSchema,
  workspaceDeckTextSelectionInputSchema,
  workspaceDeckTextSelectionResultSchema,
  workspaceDeckPptxTextElementUpdateInputSchema,
  workspaceDeckPptxTextElementUpdateResultSchema,
  type NormalizedWorkspaceDeckPptxTextElementUpdateInput,
  workspaceDeckPreviewInputSchema,
  workspaceDeckPreviewResultSchema,
  type NormalizedWorkspaceDeckSlideSelectionInput,
  type NormalizedWorkspaceDeckTextSelectionInput,
  type NormalizedWorkspaceDeckPreviewInput,
  type NormalizedWorkspaceDeckPptxPreviewInput,
  type WorkspaceDeckObservationTextElementSummary,
  type WorkspaceDeckObservationSlide,
  type WorkspaceDeckComment,
  type WorkspaceDeckCommentAuthor,
  type WorkspaceDeckPreviewResult,
  type WorkspaceDeckSelection,
  type WorkspaceDeckSlidePreview,
  type WorkspaceDeckSlidePreviewTextBox,
  type WorkspaceDeckSlideSelectionInput,
  type WorkspaceDeckSlideSelectionResult,
  type WorkspaceDeckTextElementKind,
  type WorkspaceDeckTextElementSummary,
  type WorkspaceDeckPptxTextElementUpdateInput,
  type WorkspaceDeckPptxTextElementUpdateResult,
  type WorkspaceDeckTextSelectionInput,
  type WorkspaceDeckTextSelectionResult
} from './contract.js'

type XmlRecord = Record<string, unknown>

type Relationship = {
  id: string
  type: string
  targetPath: string
}

type ParsedPptxSlide = {
  id: string
  index: number
  path: string
  title?: string
  text?: string
  notes?: string
  elements: WorkspaceDeckTextElementSummary[]
  preview: WorkspaceDeckSlidePreview
  comments: WorkspaceDeckComment[]
}

type ParsedPptxSummary = {
  slides: ParsedPptxSlide[]
  comments: WorkspaceDeckComment[]
  slideCount: number
  notesCount: number
  elementCount: number
  commentCount: number
  textCharacterCount: number
  warnings: string[]
}

type BuildOptions = {
  slideCount?: number
  notesCount?: number
  elementCount?: number
  textCharacterCount?: number
  comments?: WorkspaceDeckComment[]
  commentCount?: number
  warnings?: string[]
  slidePreviews?: WorkspaceDeckSlidePreview[]
}

const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PPTX_DEFAULT_SLIDE_WIDTH_EMU = 12_192_000
const PPTX_DEFAULT_SLIDE_HEIGHT_EMU = 6_858_000
const TITLE_PLACEHOLDER_TYPES = new Set(['title', 'ctrTitle'])
const NOTES_PLACEHOLDER_TYPES = new Set(['body'])
const SUBTITLE_PLACEHOLDER_TYPES = new Set(['subTitle', 'subtitle'])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false
})

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: false
})

export function createWorkspaceDeckPreview(
  input: NormalizedWorkspaceDeckPreviewInput
): WorkspaceDeckPreviewResult {
  return buildWorkspaceDeckPreview(input)
}

export async function createWorkspaceDeckPptxPreview(
  input: NormalizedWorkspaceDeckPptxPreviewInput
): Promise<WorkspaceDeckPreviewResult> {
  const parsed = await parsePptxSummary(input.bytes)
  const boundedSlides = parsed.slides.slice(0, WORKSPACE_DECK_MAX_SLIDES)
  const slidesWithBoundedElements = boundSlideElements(boundedSlides)
  const comments = parsed.comments.slice(0, WORKSPACE_DECK_MAX_COMMENTS)
  const warnings = boundedWarnings([
    ...parsed.warnings,
    ...(parsed.slideCount > WORKSPACE_DECK_MAX_SLIDES
      ? [`Observation includes ${WORKSPACE_DECK_MAX_SLIDES} of ${parsed.slideCount} slides.`]
      : []),
    ...(parsed.elementCount > WORKSPACE_DECK_MAX_TEXT_ELEMENTS
      ? [`Element summary includes ${WORKSPACE_DECK_MAX_TEXT_ELEMENTS} of ${parsed.elementCount} text elements.`]
      : []),
    ...(parsed.commentCount > WORKSPACE_DECK_MAX_COMMENTS
      ? [`Comment summary includes ${WORKSPACE_DECK_MAX_COMMENTS} of ${parsed.commentCount} comments.`]
      : [])
  ])
  const previewInput = workspaceDeckPreviewInputSchema.parse({
    slides: slidesWithBoundedElements.map((slide) => ({
      id: slide.id,
      index: slide.index,
      ...(slide.title ? { title: slide.title } : {}),
      ...(slide.text ? { text: slide.text } : {}),
      ...(slide.notes ? { notes: slide.notes } : {}),
      ...(slide.elements.length > 0 ? { elements: slide.elements } : {})
    })),
    path: input.path,
    workspaceRoot: input.workspaceRoot,
    mimeType: input.mimeType ?? PPTX_MIME_TYPE,
    size: input.size ?? input.bytes.byteLength,
    mtimeMs: input.mtimeMs
  })

  return buildWorkspaceDeckPreview(previewInput, {
    slideCount: parsed.slideCount,
    notesCount: parsed.notesCount,
    elementCount: parsed.elementCount,
    textCharacterCount: parsed.textCharacterCount,
    comments,
    commentCount: parsed.commentCount,
    warnings,
    slidePreviews: slidesWithBoundedElements
      .map((slide) => slide.preview)
      .slice(0, WORKSPACE_DECK_MAX_SLIDE_PREVIEWS)
  })
}

export async function updateWorkspaceDeckPptxTextElement(
  input: WorkspaceDeckPptxTextElementUpdateInput
): Promise<WorkspaceDeckPptxTextElementUpdateResult> {
  const normalized = workspaceDeckPptxTextElementUpdateInputSchema.parse(input)
  return updatePptxTextElement(normalized)
}

export function selectWorkspaceDeckSlide(input: WorkspaceDeckSlideSelectionInput): WorkspaceDeckSlideSelectionResult {
  const normalized = workspaceDeckSlideSelectionInputSchema.parse(input)
  const slide = findSlide(normalized)
  if (!slide) {
    throw new RangeError(`Slide not found: ${normalized.slideId ?? normalized.index ?? 'unknown'}`)
  }

  const slideElements = normalized.preview.elements.filter((element) => element.slideId === slide.id)
  const boundedElements = slideElements.slice(0, normalized.maxElements)
  const selection = buildDeckSelection([slide.id], boundedElements)
  const visibleText = buildSlideSelectionVisibleText(slide, boundedElements, slideElements.length)

  return workspaceDeckSlideSelectionResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_DECK_CONTRACT_VERSION,
    slide,
    elementCount: slideElements.length,
    elements: boundedElements,
    truncatedElements: boundedElements.length < slideElements.length,
    selection,
    ...(visibleText ? { visibleText } : {}),
    warnings: []
  })
}

export function selectWorkspaceDeckText(input: WorkspaceDeckTextSelectionInput): WorkspaceDeckTextSelectionResult {
  const normalized = workspaceDeckTextSelectionInputSchema.parse(input)
  const matchingElements = findMatchingTextElements(normalized)
  const boundedElements = matchingElements.slice(0, normalized.maxElements)
  const selection = buildDeckSelection(slideIdsForTextSelection(normalized, matchingElements), boundedElements)
  const visibleText = buildTextSelectionVisibleText(boundedElements, matchingElements.length)

  return workspaceDeckTextSelectionResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_DECK_CONTRACT_VERSION,
    elementCount: matchingElements.length,
    elements: boundedElements,
    truncatedElements: boundedElements.length < matchingElements.length,
    selection,
    ...(visibleText ? { visibleText } : {}),
    warnings: []
  })
}

function buildWorkspaceDeckPreview(
  input: NormalizedWorkspaceDeckPreviewInput,
  options: BuildOptions = {}
): WorkspaceDeckPreviewResult {
  const slides = [...input.slides].sort((left, right) => left.index - right.index)
  const rawElements = textElementsForSlides(slides)
  const elementCount = options.elementCount ?? rawElements.length
  const elements = rawElements.slice(0, WORKSPACE_DECK_MAX_TEXT_ELEMENTS)
  const observationTextElements = elements
    .slice(0, WORKSPACE_DECK_MAX_OBSERVATION_TEXT_ELEMENTS)
    .map(toObservationTextElement)
  const textCharacterCount = options.textCharacterCount ?? slides.reduce((total, slide) =>
    total + (slide.title?.length ?? 0) + (slide.notes?.length ?? 0) + (slide.text?.length ?? 0), 0)
  const notesCount = options.notesCount ?? slides.filter((slide) => isNonEmptyText(slide.notes)).length
  const warnings = boundedWarnings(options.warnings ?? [])
  const comments = (options.comments ?? []).slice(0, WORKSPACE_DECK_MAX_COMMENTS)
  const commentCount = options.commentCount ?? comments.length
  const annotations = buildDeckAnnotations(comments, warnings)
  const visibleText = buildVisibleText(slides)
  const slidePreviews = (options.slidePreviews ?? []).slice(0, WORKSPACE_DECK_MAX_SLIDE_PREVIEWS)
  const deckObservation = elementCount > 0 || slidePreviews.length > 0
    ? {
        ...(elementCount > 0
          ? {
              textElementCount: elementCount,
              truncatedTextElements: observationTextElements.length < elementCount,
              textElements: observationTextElements
            }
          : {}),
        ...(slidePreviews.length > 0 ? { slidePreviews } : {})
      }
    : undefined

  return workspaceDeckPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_DECK_CONTRACT_VERSION,
    slideCount: options.slideCount ?? slides.length,
    textCharacterCount,
    notesCount,
    elementCount,
    elements,
    truncatedElements: elements.length < elementCount,
    commentCount,
    comments,
    truncatedComments: comments.length < commentCount,
    ...(warnings.length > 0 ? { warnings } : {}),
    observation: {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: input.path || 'deck.pptx',
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.mtimeMs !== undefined ? { mtimeMs: input.mtimeMs } : {})
      },
      view: {
        pluginId: WORKSPACE_DECK_PLUGIN_ID,
        modality: 'deck',
        mode: 'preview',
        title: input.path?.split(/[\\/]/).filter(Boolean).at(-1) || 'Deck'
      },
      ...(visibleText ? { visibleText } : {}),
      slides: slides.map((slide) => {
        const notes = observationNotesForSlide(slide)
        return {
          id: slide.id,
          index: slide.index,
          ...(slide.title ? { title: truncateText(slide.title, 256) } : {}),
          ...(notes ? { notes } : {})
        }
      }),
      ...(deckObservation ? { deck: deckObservation } : {}),
      ...(annotations.length > 0 ? { annotations } : {}),
      actions: [...WORKSPACE_DECK_ACTIONS]
    }
  })
}

async function parsePptxSummary(bytes: Uint8Array): Promise<ParsedPptxSummary> {
  const zip = await JSZip.loadAsync(bytes)
  const warnings: string[] = []
  const slidePaths = await readOrderedSlidePaths(zip, warnings)
  const slideSize = await readPresentationSlideSize(zip, warnings)
  const commentAuthors = await readCommentAuthors(zip, warnings)

  const slides: ParsedPptxSlide[] = []
  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index]
    if (!slidePath) continue
    const slide = await parsePptxSlide(zip, slidePath, index, slideSize, commentAuthors, warnings)
    if (slide) slides.push(slide)
  }
  const comments = slides.flatMap((slide) => slide.comments)

  return {
    slides,
    comments,
    slideCount: slidePaths.length,
    notesCount: slides.filter((slide) => isNonEmptyText(slide.notes)).length,
    elementCount: slides.reduce((total, slide) => total + slide.elements.length, 0),
    commentCount: comments.length,
    textCharacterCount: slides.reduce((total, slide) =>
      total + (slide.title?.length ?? 0) + (slide.text?.length ?? 0) + (slide.notes?.length ?? 0), 0),
    warnings: boundedWarnings(warnings)
  }
}

async function readOrderedSlidePaths(zip: JSZip, warnings: string[]): Promise<string[]> {
  const presentation = await readXmlEntry(zip, 'ppt/presentation.xml', warnings, true)
  if (!presentation) {
    throw new Error('PPTX is missing ppt/presentation.xml')
  }

  const presentationRelationships = await readXmlEntry(zip, 'ppt/_rels/presentation.xml.rels', warnings, true)
  if (!presentationRelationships) {
    throw new Error('PPTX is missing ppt/_rels/presentation.xml.rels')
  }

  const relationshipById = new Map(
    parseRelationships(presentationRelationships, 'ppt/presentation.xml').map((relationship) => [
      relationship.id,
      relationship
    ])
  )
  const slidePathsFromPresentation = extractSlideRelationshipIds(presentation)
    .map((relationshipId) => relationshipById.get(relationshipId))
    .filter((relationship): relationship is Relationship => Boolean(relationship))
    .filter((relationship) => isSlideRelationship(relationship))
    .map((relationship) => relationship.targetPath)
  const slidePaths = uniquePreservingOrder(
    slidePathsFromPresentation.length > 0 ? slidePathsFromPresentation : listSlidePaths(zip)
  )
  return slidePaths
}

async function readPresentationSlideSize(
  zip: JSZip,
  warnings: string[]
): Promise<{ width: number, height: number }> {
  const presentation = await readXmlEntry(zip, 'ppt/presentation.xml', warnings, false)
  const root = firstChildByLocalName(presentation, 'presentation') ?? presentation
  const slideSize = firstChildByLocalName(root, 'sldSz')
  const width = parsePositiveNumber(attributeValue(slideSize, 'cx')) ?? PPTX_DEFAULT_SLIDE_WIDTH_EMU
  const height = parsePositiveNumber(attributeValue(slideSize, 'cy')) ?? PPTX_DEFAULT_SLIDE_HEIGHT_EMU
  return { width, height }
}

async function updatePptxTextElement(
  input: NormalizedWorkspaceDeckPptxTextElementUpdateInput
): Promise<WorkspaceDeckPptxTextElementUpdateResult> {
  const zip = await JSZip.loadAsync(input.bytes)
  const warnings: string[] = []
  const slidePaths = await readOrderedSlidePaths(zip, warnings)
  const slidePath = slidePaths.find((path, index) => slideIdForPath(path, index) === input.slideId)
  if (!slidePath) {
    throw new RangeError(`Slide not found: ${input.slideId}`)
  }

  const slideXml = await readXmlEntry(zip, slidePath, warnings, true)
  if (!slideXml) {
    throw new Error(`PPTX is missing ${slidePath}`)
  }

  const slideTarget = findTextElementTarget({
    root: slideXml,
    slideId: input.slideId,
    source: 'slide',
    elementId: input.elementId,
    partPath: slidePath
  })
  let target = slideTarget

  if (!target) {
    const notesPath = await findNotesSlidePath(zip, slidePath, warnings)
    const notesXml = notesPath ? await readXmlEntry(zip, notesPath, warnings, true) : undefined
    target = notesPath && notesXml
      ? findTextElementTarget({
          root: notesXml,
          slideId: input.slideId,
          source: 'notes',
          elementId: input.elementId,
          partPath: notesPath
        })
      : undefined
  }

  if (!target) {
    throw new RangeError(`Text element not found: ${input.elementId}`)
  }

  replaceTextElementRuns(target.textRuns, input.text)
  zip.file(target.partPath, xmlBuilder.build(target.root))
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))

  return workspaceDeckPptxTextElementUpdateResultSchema.parse({
    bytes,
    slideId: input.slideId,
    elementId: input.elementId,
    source: target.source,
    partPath: target.partPath,
    beforeText: target.beforeText,
    afterText: input.text
  })
}

async function parsePptxSlide(
  zip: JSZip,
  slidePath: string,
  index: number,
  slideSize: { width: number, height: number },
  commentAuthors: Map<string, WorkspaceDeckCommentAuthor>,
  warnings: string[]
): Promise<ParsedPptxSlide | undefined> {
  const slideXml = await readXmlEntry(zip, slidePath, warnings, true)
  if (!slideXml) return undefined

  const id = slideIdForPath(slidePath, index)
  const slideElements = extractTextElements(slideXml, id, 'slide')
  const allText = mergeTextRuns(extractTextRuns(slideXml))
  const title = firstNonEmpty([
    ...extractPlaceholderTexts(slideXml, TITLE_PLACEHOLDER_TYPES),
    ...extractTextRuns(slideXml)
  ])
  const text = buildSlideTextSnippet(allText, title)
  const notesPath = await findNotesSlidePath(zip, slidePath, warnings)
  const notesSummary = notesPath ? await parseNotesSummary(zip, notesPath, id, warnings) : undefined
  const commentPaths = await findSlideCommentsPaths(zip, slidePath, warnings)
  const comments = (await Promise.all(
    commentPaths.map((commentPath) => parseCommentsSummary(zip, commentPath, id, index, commentAuthors, warnings))
  )).flat()

  return {
    id,
    index,
    path: slidePath,
    ...(title ? { title: truncateText(title, 256) } : {}),
    ...(text ? { text } : {}),
    ...(notesSummary?.notes ? { notes: notesSummary.notes } : {}),
    elements: [...slideElements, ...(notesSummary?.elements ?? [])],
    preview: buildSlidePreview(slideXml, id, index, slideSize),
    comments
  }
}

async function parseNotesSummary(
  zip: JSZip,
  notesPath: string,
  slideId: string,
  warnings: string[]
): Promise<{ notes?: string, elements: WorkspaceDeckTextElementSummary[] } | undefined> {
  const notesXml = await readXmlEntry(zip, notesPath, warnings, true)
  if (!notesXml) return undefined

  const placeholderText = firstNonEmpty(extractPlaceholderTexts(notesXml, NOTES_PLACEHOLDER_TYPES))
  const text = placeholderText ?? mergeTextRuns(extractTextRuns(notesXml))
  return {
    ...(text ? { notes: truncateText(text, WORKSPACE_DECK_MAX_NOTES_PREVIEW_CHARS) } : {}),
    elements: extractTextElements(notesXml, slideId, 'notes')
  }
}

async function readCommentAuthors(
  zip: JSZip,
  warnings: string[]
): Promise<Map<string, WorkspaceDeckCommentAuthor>> {
  const presentationRelationships = await readXmlEntry(zip, 'ppt/_rels/presentation.xml.rels', warnings, false)
  const relationshipPaths = presentationRelationships
    ? parseRelationships(presentationRelationships, 'ppt/presentation.xml')
      .filter((relationship) => isCommentAuthorsRelationship(relationship))
      .map((relationship) => relationship.targetPath)
    : []
  const authorPaths = uniquePreservingOrder([...relationshipPaths, 'ppt/commentAuthors.xml'])
  const authors = new Map<string, WorkspaceDeckCommentAuthor>()

  for (const authorPath of authorPaths) {
    const root = await readXmlEntry(zip, authorPath, warnings, false)
    if (!root) continue
    for (const author of parseCommentAuthors(root)) {
      if (!authors.has(author.id)) authors.set(author.id, author)
    }
  }

  return authors
}

function parseCommentAuthors(root: unknown): WorkspaceDeckCommentAuthor[] {
  const authorsRoot = firstChildByLocalName(root, 'cmAuthorLst') ?? root
  return childrenByLocalName(authorsRoot, 'cmAuthor')
    .map((author) => {
      const id = sanitizeIdToken(attributeValue(author, 'id') ?? '')
      if (!id) return undefined
      const name = normalizeText(attributeValue(author, 'name') ?? '')
      const initials = normalizeText(attributeValue(author, 'initials') ?? '')
      return {
        id,
        ...(name ? { name: truncateText(name, 256) } : {}),
        ...(initials ? { initials: truncateText(initials, 32) } : {})
      }
    })
    .filter((author): author is WorkspaceDeckCommentAuthor => Boolean(author))
}

async function parseCommentsSummary(
  zip: JSZip,
  commentsPath: string,
  slideId: string,
  slideIndex: number,
  authors: Map<string, WorkspaceDeckCommentAuthor>,
  warnings: string[]
): Promise<WorkspaceDeckComment[]> {
  const commentsXml = await readXmlEntry(zip, commentsPath, warnings, true)
  if (!commentsXml) return []

  const commentsRoot = firstChildByLocalName(commentsXml, 'cmLst') ?? commentsXml
  const usedIds = new Set<string>()
  const comments: WorkspaceDeckComment[] = []
  for (const comment of childrenByLocalName(commentsRoot, 'cm')) {
    const text = extractCommentText(comment)
    if (!text) continue

    const authorId = sanitizeIdToken(attributeValue(comment, 'authorId') ?? '')
    const author = authorId ? authors.get(authorId) : undefined
    const commentIndex = parseNonNegativeInteger(attributeValue(comment, 'idx'))
    const createdAt = normalizeText(attributeValue(comment, 'dt') ?? '')
    const position = commentPosition(comment)
    const id = uniqueCommentId(
      commentIdForSlide(slideId, authorId, commentIndex ?? comments.length + 1),
      usedIds
    )

    comments.push({
      id,
      slideId,
      slideIndex,
      partPath: commentsPath,
      ...(authorId ? { authorId } : {}),
      ...(author?.name ? { authorName: author.name } : {}),
      ...(author?.initials ? { initials: author.initials } : {}),
      ...(commentIndex !== undefined ? { index: commentIndex } : {}),
      ...(createdAt ? { createdAt: truncateText(createdAt, 128) } : {}),
      text,
      ...(position ? { position } : {})
    })
  }

  return comments
}

function extractCommentText(comment: unknown): string | undefined {
  const text = firstNonEmpty([
    textValue(firstChildByLocalName(comment, 'text')),
    mergeTextRuns(extractTextRuns(comment))
  ])
  return text ? truncateText(text, WORKSPACE_DECK_MAX_COMMENT_TEXT_CHARS) : undefined
}

function commentPosition(comment: unknown): WorkspaceDeckComment['position'] | undefined {
  const position = firstChildByLocalName(comment, 'pos')
  const x = parseFiniteNumber(attributeValue(position, 'x'))
  const y = parseFiniteNumber(attributeValue(position, 'y'))
  return x === undefined || y === undefined ? undefined : { x, y }
}

async function findNotesSlidePath(
  zip: JSZip,
  slidePath: string,
  warnings: string[]
): Promise<string | undefined> {
  const relationshipsPath = relationshipsPathForPart(slidePath)
  const relationshipsXml = await readXmlEntry(zip, relationshipsPath, warnings, false)
  if (!relationshipsXml) return undefined

  const notesRelationship = parseRelationships(relationshipsXml, slidePath)
    .find((relationship) => isNotesSlideRelationship(relationship))
  return notesRelationship?.targetPath
}

async function findSlideCommentsPaths(
  zip: JSZip,
  slidePath: string,
  warnings: string[]
): Promise<string[]> {
  const relationshipsPath = relationshipsPathForPart(slidePath)
  const relationshipsXml = await readXmlEntry(zip, relationshipsPath, warnings, false)
  if (!relationshipsXml) return []

  return uniquePreservingOrder(
    parseRelationships(relationshipsXml, slidePath)
      .filter((relationship) => isCommentsRelationship(relationship))
      .map((relationship) => relationship.targetPath)
  )
}

async function readXmlEntry(
  zip: JSZip,
  path: string,
  warnings: string[],
  required: boolean
): Promise<unknown | undefined> {
  const entry = zip.file(path)
  if (!entry) {
    if (required) warnings.push(`Missing PPTX part: ${path}`)
    return undefined
  }

  try {
    return xmlParser.parse(await entry.async('string')) as unknown
  } catch (error) {
    warnings.push(`Could not parse PPTX XML part ${path}: ${errorMessage(error)}`)
    return undefined
  }
}

function parseRelationships(root: unknown, sourcePath: string): Relationship[] {
  const relationshipsRoot = firstChildByLocalName(root, 'Relationships') ?? root
  return childrenByLocalName(relationshipsRoot, 'Relationship')
    .map((relationship) => {
      const id = attributeValue(relationship, 'Id')
      const type = attributeValue(relationship, 'Type')
      const target = attributeValue(relationship, 'Target')
      if (!id || !type || !target) return undefined
      return {
        id,
        type,
        targetPath: resolveZipTarget(sourcePath, target)
      }
    })
    .filter((relationship): relationship is Relationship => Boolean(relationship))
}

function extractSlideRelationshipIds(root: unknown): string[] {
  const presentation = firstChildByLocalName(root, 'presentation') ?? root
  const slideIdList = firstChildByLocalName(presentation, 'sldIdLst')
  return childrenByLocalName(slideIdList, 'sldId')
    .map((slideId) => attributeValue(slideId, 'r:id'))
    .filter((relationshipId): relationshipId is string => Boolean(relationshipId))
}

function extractPlaceholderTexts(root: unknown, placeholderTypes: Set<string>): string[] {
  const texts: string[] = []

  function visit(value: unknown, tagName?: string): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, tagName)
      return
    }
    if (!isRecord(value)) return

    if (tagName && localName(tagName) === 'sp') {
      const placeholderType = shapePlaceholderType(value)
      if (placeholderType && placeholderTypes.has(placeholderType)) {
        const text = mergeTextRuns(extractTextRuns(value))
        if (text) texts.push(text)
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key)
    }
  }

  visit(root)
  return texts
}

function extractTextRuns(root: unknown): string[] {
  const runs: string[] = []

  function visit(value: unknown, tagName?: string): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, tagName)
      return
    }

    if (tagName && localName(tagName) === 't') {
      const text = textValue(value)
      if (text) runs.push(text)
      return
    }

    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key)
    }
  }

  visit(root)
  return runs
}

function extractTextElements(
  root: unknown,
  slideId: string,
  source: 'slide' | 'notes'
): WorkspaceDeckTextElementSummary[] {
  const elements: WorkspaceDeckTextElementSummary[] = []
  const usedIds = new Set<string>()

  function visit(value: unknown, tagName?: string): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, tagName)
      return
    }
    if (!isRecord(value)) return

    if (tagName && localName(tagName) === 'sp') {
      const text = truncateText(mergeTextRuns(extractTextRuns(value)), WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS)
      if (text) {
        const baseId = textElementIdForShape(slideId, source, value, elements.length)
        const id = uniqueTextElementId(baseId, usedIds)
        elements.push({
          id,
          slideId,
          text,
          kind: textElementKindForShape(value, source)
        })
      }
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key)
    }
  }

  visit(root)
  return elements
}

function buildSlidePreview(
  root: unknown,
  slideId: string,
  index: number,
  slideSize: { width: number, height: number }
): WorkspaceDeckSlidePreview {
  const allTextBoxes = extractSlidePreviewTextBoxes(root, slideId)
  const textBoxes = allTextBoxes.slice(0, WORKSPACE_DECK_MAX_SLIDE_PREVIEW_TEXT_BOXES)
  return {
    slideId,
    index,
    width: slideSize.width,
    height: slideSize.height,
    ...(textBoxes.length > 0 ? { textBoxes } : {}),
    ...(textBoxes.length < allTextBoxes.length ? { truncatedTextBoxes: true } : {})
  }
}

function extractSlidePreviewTextBoxes(
  root: unknown,
  slideId: string
): WorkspaceDeckSlidePreviewTextBox[] {
  const textBoxes: WorkspaceDeckSlidePreviewTextBox[] = []
  const usedIds = new Set<string>()

  function visit(value: unknown, tagName?: string): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, tagName)
      return
    }
    if (!isRecord(value)) return

    if (tagName && localName(tagName) === 'sp') {
      const text = truncateText(mergeTextRuns(extractTextRuns(value)), WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS)
      if (text) {
        const baseId = textElementIdForShape(slideId, 'slide', value, textBoxes.length)
        const elementId = uniqueTextElementId(baseId, usedIds)
        textBoxes.push({
          elementId,
          text,
          kind: textElementKindForShape(value, 'slide'),
          ...shapeBounds(value)
        })
      }
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key)
    }
  }

  visit(root)
  return textBoxes
}

function shapeBounds(
  shape: XmlRecord
): Pick<WorkspaceDeckSlidePreviewTextBox, 'x' | 'y' | 'width' | 'height'> {
  const shapeProperties = firstChildByLocalName(shape, 'spPr')
  const transform = firstChildByLocalName(shapeProperties, 'xfrm')
  const offset = firstChildByLocalName(transform, 'off')
  const extents = firstChildByLocalName(transform, 'ext')
  const x = parseFiniteNumber(attributeValue(offset, 'x'))
  const y = parseFiniteNumber(attributeValue(offset, 'y'))
  const width = parsePositiveNumber(attributeValue(extents, 'cx'))
  const height = parsePositiveNumber(attributeValue(extents, 'cy'))
  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {})
  }
}

type TextNodeRef = {
  text: string
  setText: (text: string) => void
}

type TextElementTarget = {
  root: unknown
  partPath: string
  source: 'slide' | 'notes'
  beforeText: string
  textRuns: TextNodeRef[]
}

function findTextElementTarget(input: {
  root: unknown
  slideId: string
  source: 'slide' | 'notes'
  elementId: string
  partPath: string
}): TextElementTarget | undefined {
  const usedIds = new Set<string>()
  let textElementIndex = 0

  function visit(value: unknown, tagName?: string): TextElementTarget | undefined {
    if (Array.isArray(value)) {
      for (const item of value) {
        const target = visit(item, tagName)
        if (target) return target
      }
      return undefined
    }
    if (!isRecord(value)) return undefined

    if (tagName && localName(tagName) === 'sp') {
      const beforeText = truncateText(mergeTextRuns(extractTextRuns(value)), WORKSPACE_DECK_MAX_TEXT_ELEMENT_CHARS)
      if (!beforeText) return undefined

      const baseId = textElementIdForShape(input.slideId, input.source, value, textElementIndex)
      const id = uniqueTextElementId(baseId, usedIds)
      textElementIndex += 1
      if (id !== input.elementId) return undefined

      return {
        root: input.root,
        partPath: input.partPath,
        source: input.source,
        beforeText,
        textRuns: collectTextNodeRefs(value)
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      const target = visit(child, key)
      if (target) return target
    }
    return undefined
  }

  return visit(input.root)
}

function collectTextNodeRefs(root: unknown): TextNodeRef[] {
  const refs: TextNodeRef[] = []

  function visit(value: unknown, tagName: string | undefined, setValue: (next: unknown) => void): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, tagName, (next) => {
          value[index] = next
        })
      })
      return
    }

    if (tagName && localName(tagName) === 't') {
      refs.push({
        text: textValue(value) ?? '',
        setText: (text) => {
          setValue(textNodeValue(value, text))
        }
      })
      return
    }

    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key, (next) => {
        value[key] = next
      })
    }
  }

  visit(root, undefined, () => {})
  return refs
}

function replaceTextElementRuns(textRuns: TextNodeRef[], text: string): void {
  if (textRuns.length === 0) {
    throw new Error('Text element has no XML text runs to update.')
  }

  textRuns[0]?.setText(text)
  for (const run of textRuns.slice(1)) {
    run.setText('')
  }
}

function textNodeValue(current: unknown, text: string): unknown {
  if (!isRecord(current)) {
    return needsXmlSpacePreserve(text)
      ? { '#text': text, '@_xml:space': 'preserve' }
      : text
  }

  current['#text'] = text
  if (needsXmlSpacePreserve(text)) {
    current['@_xml:space'] = 'preserve'
  }
  return current
}

function needsXmlSpacePreserve(text: string): boolean {
  return text.length > 0 && text.trim() !== text
}

function shapePlaceholderType(shape: XmlRecord): string | undefined {
  const nonVisualShapeProperties = firstChildByLocalName(shape, 'nvSpPr')
  const nonVisualProperties = firstChildByLocalName(nonVisualShapeProperties, 'nvPr')
  const placeholder = firstChildByLocalName(nonVisualProperties, 'ph')
  return normalizeText(attributeValue(placeholder, 'type') ?? '')
}

function textElementKindForShape(shape: XmlRecord, source: 'slide' | 'notes'): WorkspaceDeckTextElementKind {
  if (source === 'notes') return 'notes'

  const placeholderType = shapePlaceholderType(shape)
  if (TITLE_PLACEHOLDER_TYPES.has(placeholderType ?? '')) return 'title'
  if (SUBTITLE_PLACEHOLDER_TYPES.has(placeholderType ?? '')) return 'subtitle'
  if (placeholderType === 'body') return 'body'
  if (placeholderType) return 'placeholder'
  return 'text'
}

function textElementIdForShape(
  slideId: string,
  source: 'slide' | 'notes',
  shape: XmlRecord,
  fallbackIndex: number
): string {
  const nonVisualShapeProperties = firstChildByLocalName(shape, 'nvSpPr')
  const nonVisualDrawingProperties = firstChildByLocalName(nonVisualShapeProperties, 'cNvPr')
  const shapeId = sanitizeIdToken(attributeValue(nonVisualDrawingProperties, 'id') ?? '')
  const shapeName = sanitizeIdToken(attributeValue(nonVisualDrawingProperties, 'name') ?? '')
  const stableId = shapeId || shapeName || `text-${fallbackIndex + 1}`
  return truncateId(`${slideId}:${source}-${stableId}`)
}

function uniqueTextElementId(id: string, usedIds: Set<string>): string {
  if (!usedIds.has(id)) {
    usedIds.add(id)
    return id
  }

  let suffix = 2
  let candidate = idWithSuffix(id, suffix)
  while (usedIds.has(candidate)) {
    suffix += 1
    candidate = idWithSuffix(id, suffix)
  }
  usedIds.add(candidate)
  return candidate
}

function idWithSuffix(id: string, suffix: number): string {
  const suffixText = `-${suffix}`
  return `${id.slice(0, Math.max(0, 256 - suffixText.length))}${suffixText}`
}

function buildSlideTextSnippet(text: string, title: string | undefined): string | undefined {
  const bodyText = title && text.startsWith(title)
    ? normalizeText(text.slice(title.length))
    : text
  return bodyText ? truncateText(bodyText, WORKSPACE_DECK_MAX_SLIDE_TEXT_SNIPPET_CHARS) : undefined
}

function observationNotesForSlide(slide: NormalizedWorkspaceDeckPreviewInput['slides'][number]): string | undefined {
  const text = slide.text ? truncateText(slide.text, WORKSPACE_DECK_MAX_SLIDE_TEXT_SNIPPET_CHARS) : undefined
  const notes = slide.notes
  const combined = text && notes
    ? `Text: ${text}\nSpeaker notes: ${notes}`
    : text
      ? `Text: ${text}`
      : notes
  return combined ? truncateText(combined, WORKSPACE_DECK_MAX_TEXT_CHARS) : undefined
}

function buildVisibleText(slides: NormalizedWorkspaceDeckPreviewInput['slides']): string | undefined {
  const lines: string[] = []
  for (const slide of slides) {
    const title = slide.title ? `: ${slide.title}` : ''
    lines.push(`Slide ${slide.index + 1}${title}`)
    if (slide.text) lines.push(`Text: ${slide.text}`)
    if (slide.notes) lines.push(`Notes: ${slide.notes}`)
  }
  const text = lines.join('\n').trim()
  return text ? truncateText(text, WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS) : undefined
}

function buildDeckAnnotations(
  comments: WorkspaceDeckComment[],
  warnings: string[]
): NonNullable<WorkspaceDeckPreviewResult['observation']['annotations']> {
  return [
    ...comments.map((comment) => ({
      id: comment.id,
      kind: 'pptx-comment',
      summary: formatCommentAnnotationSummary(comment)
    })),
    ...warnings.map((warning, index) => ({
      id: `warning-${index + 1}`,
      kind: 'warning',
      summary: warning
    }))
  ].slice(0, WORKSPACE_DECK_MAX_ANNOTATIONS)
}

function formatCommentAnnotationSummary(comment: WorkspaceDeckComment): string {
  const author = comment.authorName || comment.initials || (comment.authorId ? `author ${comment.authorId}` : 'unknown author')
  const createdAt = comment.createdAt ? `, ${comment.createdAt}` : ''
  const position = comment.position ? `, x=${comment.position.x}, y=${comment.position.y}` : ''
  return truncateText(
    `Slide ${comment.slideIndex + 1}, ${author}${createdAt}${position}: ${truncateText(comment.text, 760)}`,
    1000
  )
}

function boundSlideElements(slides: ParsedPptxSlide[]): ParsedPptxSlide[] {
  let remaining = WORKSPACE_DECK_MAX_TEXT_ELEMENTS
  return slides.map((slide) => {
    const elements = slide.elements.slice(0, remaining)
    remaining = Math.max(0, remaining - elements.length)
    return { ...slide, elements }
  })
}

function textElementsForSlides(slides: NormalizedWorkspaceDeckPreviewInput['slides']): WorkspaceDeckTextElementSummary[] {
  return slides.flatMap((slide) => slide.elements ?? [])
}

function toObservationTextElement(
  element: WorkspaceDeckTextElementSummary
): WorkspaceDeckObservationTextElementSummary {
  return {
    slideId: element.slideId,
    elementId: element.id,
    kind: element.kind,
    text: element.text
  }
}

function findSlide(input: NormalizedWorkspaceDeckSlideSelectionInput): WorkspaceDeckObservationSlide | undefined {
  if (input.slideId) {
    return input.preview.observation.slides.find((slide) => slide.id === input.slideId)
  }
  return input.preview.observation.slides.find((slide) => slide.index === input.index)
}

function findMatchingTextElements(input: NormalizedWorkspaceDeckTextSelectionInput): WorkspaceDeckTextElementSummary[] {
  if (input.elementId) {
    const element = input.preview.elements.find((candidate) => candidate.id === input.elementId)
    if (!element) throw new RangeError(`Text element not found: ${input.elementId}`)
  }

  const query = normalizeText(input.query ?? '').toLocaleLowerCase()
  return input.preview.elements.filter((element) => {
    if (input.slideId && element.slideId !== input.slideId) return false
    if (input.elementId && element.id !== input.elementId) return false
    if (input.kind && element.kind !== input.kind) return false
    if (query && !element.text.toLocaleLowerCase().includes(query)) return false
    return true
  })
}

function buildDeckSelection(
  slideIds: string[],
  elements: WorkspaceDeckTextElementSummary[]
): WorkspaceDeckSelection {
  return {
    kind: 'deck',
    slideIds: slideIds.slice(0, WORKSPACE_DECK_MAX_SELECTION_ITEMS),
    ...(elements.length > 0 ? { elementIds: elements.slice(0, WORKSPACE_DECK_MAX_SELECTION_ITEMS).map((element) => element.id) } : {})
  }
}

function slideIdsForTextSelection(
  input: NormalizedWorkspaceDeckTextSelectionInput,
  elements: WorkspaceDeckTextElementSummary[]
): string[] {
  const elementSlideIds = uniquePreservingOrder(elements.map((element) => element.slideId))
  if (elementSlideIds.length > 0) return elementSlideIds
  if (input.slideId && input.preview.observation.slides.some((slide) => slide.id === input.slideId)) return [input.slideId]
  return []
}

function buildSlideSelectionVisibleText(
  slide: WorkspaceDeckObservationSlide,
  elements: WorkspaceDeckTextElementSummary[],
  elementCount: number
): string | undefined {
  const lines = [
    `Selected slide ${slide.index + 1}${slide.title ? `: ${slide.title}` : ''}.`,
    `Text elements: ${elements.length}${elementCount > elements.length ? ` of ${elementCount}` : ''}.`,
    ...elements.map((element) => `${element.kind}: ${element.text}`)
  ]
  const text = lines.join('\n').trim()
  return text ? truncateText(text, WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS) : undefined
}

function buildTextSelectionVisibleText(
  elements: WorkspaceDeckTextElementSummary[],
  elementCount: number
): string | undefined {
  const lines = [
    `Selected text elements: ${elements.length}${elementCount > elements.length ? ` of ${elementCount}` : ''}.`,
    ...elements.map((element) => `${element.slideId}/${element.kind}: ${element.text}`)
  ]
  const text = lines.join('\n').trim()
  return text ? truncateText(text, WORKSPACE_DECK_MAX_VISIBLE_TEXT_CHARS) : undefined
}

function listSlidePaths(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipPath(entry.name))
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort(compareSlidePaths)
}

function compareSlidePaths(left: string, right: string): number {
  return slideNumberForPath(left) - slideNumberForPath(right) || left.localeCompare(right)
}

function slideNumberForPath(path: string): number {
  const match = /\/slide(\d+)\.xml$/i.exec(path)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function slideIdForPath(path: string, index: number): string {
  const match = /\/(slide\d+)\.xml$/i.exec(path)
  return match?.[1] ?? `slide-${index + 1}`
}

function relationshipsPathForPart(partPath: string): string {
  const normalized = normalizeZipPath(partPath)
  return pathPosix.join(pathPosix.dirname(normalized), '_rels', `${pathPosix.basename(normalized)}.rels`)
}

function resolveZipTarget(sourcePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, '/')
  if (normalizedTarget.startsWith('/')) return normalizeZipPath(normalizedTarget.slice(1))
  return normalizeZipPath(pathPosix.join(pathPosix.dirname(sourcePath), normalizedTarget))
}

function normalizeZipPath(path: string): string {
  return pathPosix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '')
}

function isSlideRelationship(relationship: Relationship): boolean {
  return relationship.type.endsWith('/slide') || /^ppt\/slides\/slide\d+\.xml$/i.test(relationship.targetPath)
}

function isNotesSlideRelationship(relationship: Relationship): boolean {
  return relationship.type.endsWith('/notesSlide') || /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(relationship.targetPath)
}

function isCommentsRelationship(relationship: Relationship): boolean {
  return relationship.type.endsWith('/comments') || /^ppt\/comments\/comment\d+\.xml$/i.test(relationship.targetPath)
}

function isCommentAuthorsRelationship(relationship: Relationship): boolean {
  return relationship.type.endsWith('/commentAuthors') || relationship.targetPath === 'ppt/commentAuthors.xml'
}

function childrenByLocalName(value: unknown, name: string): unknown[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) => {
    if (isAttributeKey(key) || localName(key) !== name) return []
    return Array.isArray(child) ? child : [child]
  })
}

function firstChildByLocalName(value: unknown, name: string): unknown | undefined {
  return childrenByLocalName(value, name)[0]
}

function attributeValue(value: unknown, name: string): string | undefined {
  if (!isRecord(value)) return undefined
  const exact = value[`@_${name}`]
  if (typeof exact === 'string') return exact
  if (name.includes(':')) return undefined

  const match = Object.entries(value).find(([key]) => isAttributeKey(key) && localName(key) === name)
  return typeof match?.[1] === 'string' ? match[1] : undefined
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return normalizeText(String(value))
  if (!isRecord(value)) return undefined

  const textNode = value['#text']
  if (typeof textNode === 'string') return normalizeText(textNode)
  if (typeof textNode === 'number' || typeof textNode === 'boolean') return normalizeText(String(textNode))
  return undefined
}

function mergeTextRuns(runs: string[]): string {
  return normalizeText(runs.filter(isNonEmptyText).join(' '))
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => normalizeText(value ?? '')).find(isNonEmptyText)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeIdToken(value: string): string {
  return normalizeText(value)
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._:-]/g, '')
}

function commentIdForSlide(slideId: string, authorId: string | undefined, commentIndex: number): string {
  const authorToken = sanitizeIdToken(authorId ?? '') || 'unknown'
  return truncateId(`${slideId}:comment-${authorToken}-${commentIndex}`)
}

function uniqueCommentId(id: string, usedIds: Set<string>): string {
  if (!usedIds.has(id)) {
    usedIds.add(id)
    return id
  }

  let suffix = 2
  let candidate = idWithSuffix(id, suffix)
  while (usedIds.has(candidate)) {
    suffix += 1
    candidate = idWithSuffix(id, suffix)
  }
  usedIds.add(candidate)
  return candidate
}

function truncateId(value: string): string {
  return value.length <= 256 ? value : value.slice(0, 256)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function isNonEmptyText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function boundedWarnings(warnings: string[]): string[] {
  return uniquePreservingOrder(warnings.map((warning) => warning.trim()).filter(isNonEmptyText))
    .slice(0, WORKSPACE_DECK_MAX_WARNINGS)
}

function uniquePreservingOrder<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function localName(name: string): string {
  return name.replace(/^@_/, '').split(':').at(-1) ?? name
}

function isAttributeKey(key: string): boolean {
  return key.startsWith('@_')
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
