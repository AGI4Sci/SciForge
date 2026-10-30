export const SDD_VERIFY_INTRO =
  'SciForge is asking you to verify an implemented SDD requirement draft against its acceptance criteria.'

export function buildSddVerifyPrompt(options: {
  workspaceRoot: string
  draftRelativePath: string
  planRelativePath: string
}): string {
  return [
    SDD_VERIFY_INTRO,
    `Workspace: ${options.workspaceRoot}`,
    `Requirement file: ${options.draftRelativePath}`,
    `Implementation plan: ${options.planRelativePath}`,
    '',
    'The requirement file contains structured requirement blocks: level-3 headings like `### R-1: title {status}` followed by a description and an acceptance checklist (`- [ ]` lines).',
    '',
    'For each requirement block:',
    '1. Verify every acceptance criterion against the actual code/behavior in this workspace. Prefer concrete evidence: run the relevant tests, inspect the implementation, or execute the app where feasible.',
    '2. Edit the requirement file in place: change `- [ ]` to `- [x]` for every criterion you verified as satisfied. Leave unsatisfied criteria unchecked.',
    '3. Update the status token on the requirement heading: set `{verified}` only when all of its criteria passed. Otherwise keep the existing status token; never downgrade it.',
    '4. Do not rewrite descriptions or titles; only update checkboxes and status tokens.',
    '5. Do not edit the implementation plan or unrelated implementation files during this verification turn unless the user explicitly asks for fixes.',
    '',
    'Finish with a concise report: which requirements are verified, which criteria failed and why, and the smallest follow-up needed to close the gaps.'
  ].join('\n')
}

export function isSddVerifyPrompt(text: string): boolean {
  return text.trim().includes(SDD_VERIFY_INTRO)
}
