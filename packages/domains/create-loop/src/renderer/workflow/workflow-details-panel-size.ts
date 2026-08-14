export const WORKFLOW_DETAILS_PANEL_DEFAULT_WIDTH = 440
export const WORKFLOW_DETAILS_PANEL_MIN_WIDTH = 360

const WORKFLOW_PALETTE_WIDTH = 196
const WORKFLOW_CANVAS_MIN_WIDTH = 280
const WORKFLOW_DIVIDER_WIDTH = 4

export function fitWorkflowDetailsPanelWidth(
  requestedWidth: number,
  viewportWidth: number
): number {
  const availableWidth = viewportWidth
    - WORKFLOW_PALETTE_WIDTH
    - WORKFLOW_CANVAS_MIN_WIDTH
    - WORKFLOW_DIVIDER_WIDTH
  const maximumWidth = Math.max(WORKFLOW_DETAILS_PANEL_MIN_WIDTH, availableWidth)
  return Math.round(Math.min(
    Math.max(requestedWidth, WORKFLOW_DETAILS_PANEL_MIN_WIDTH),
    maximumWidth
  ))
}
