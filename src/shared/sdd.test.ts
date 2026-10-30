import { describe, expect, it } from 'vitest'
import {
  SDD_DRAFT_FILE_NAME,
  SDD_IMAGE_RELATIVE_DIR,
  buildSddDraftRelativePath,
  isSddDraftRelativePath,
  isSddImageRelativePath,
  normalizeSddRelativePath,
  sddDraftRelativePathForPlanPath,
  sddDraftTraceRelativePath,
  sddUnitImageDir
} from './sdd'

describe('sdd shared paths', () => {
  it('builds a canonical draft requirement path', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(buildSddDraftRelativePath(id)).toBe(`.sciforge/sdd/requirements/${id}/${SDD_DRAFT_FILE_NAME}`)
  })

  it('validates current uuid-backed requirement drafts', () => {
    expect(isSddDraftRelativePath('.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md')).toBe(true)
    expect(isSddDraftRelativePath('.sciforge/sdd/requirements/not-a-uuid/requirement.md')).toBe(false)
    expect(isSddDraftRelativePath('.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/other.md')).toBe(false)
    expect(isSddDraftRelativePath('.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/nested/requirement.md')).toBe(false)
  })

  it('normalizes separators before image validation', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(normalizeSddRelativePath('./.sciforge\\sdd\\requirements\\123e4567-e89b-12d3-a456-426614174000\\img\\wireframe.png')).toBe(`.sciforge/sdd/requirements/${id}/img/wireframe.png`)
    expect(isSddImageRelativePath(`.sciforge/sdd/requirements/${id}/img/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.sciforge/sdd/requirements/${id}/img/nested/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.sciforge/sdd/requirements/${id}/img/../escape.png`)).toBe(false)
    expect(isSddImageRelativePath(`${SDD_IMAGE_RELATIVE_DIR}/wireframe.png`)).toBe(false)
    expect(isSddImageRelativePath('img/wireframe.png')).toBe(false)
  })

  it('derives unit paths for current drafts', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const current = buildSddDraftRelativePath(id)

    expect(sddUnitImageDir(current)).toBe(`.sciforge/sdd/requirements/${id}/img`)
    expect(sddDraftTraceRelativePath(current)).toBe(`.sciforge/sdd/requirements/${id}/trace.json`)
  })

  it('maps current SDD plan paths back to drafts', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(sddDraftRelativePathForPlanPath(`.sciforge/plan/sdd-${id}.md`)).toBe(
      `.sciforge/sdd/requirements/${id}/requirement.md`
    )
    expect(sddDraftRelativePathForPlanPath(`.sciforge/plan/sdd-${id}-2.md`)).toBe(
      `.sciforge/sdd/requirements/${id}/requirement.md`
    )
    expect(sddDraftRelativePathForPlanPath('.sciforge/plan/other.md')).toBeNull()
  })
})
