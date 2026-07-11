# Anchored Comments Requirements

## Requirement: Commentable targets

SciForge SHALL let users enter a global comment mode and select meaningful first-party research content or application UI targets.

### Scenario: Semantic target

- **WHEN** a target exposes a structured resource selection or stable SciForge element identity
- **THEN** the saved anchor SHALL use that identity as its canonical locator
- **AND** SHALL retain a DOM and visual fallback.

### Scenario: Sensitive target

- **WHEN** a target or ancestor is marked sensitive or non-capturable
- **THEN** SciForge SHALL refuse to create a comment on it
- **AND** SHALL redact it from surrounding product-feedback screenshots.

## Requirement: Immutable visual evidence

SciForge SHALL capture a full SciForge-window screenshot and a focused target crop when the first comment is created.

### Scenario: UI changes after capture

- **WHEN** the application layout or target DOM changes after comment creation
- **THEN** the original approved screenshots and environment metadata SHALL remain unchanged and viewable.

## Requirement: Explicit conversation attachment

SciForge SHALL attach comments to an AI conversation only after the user explicitly selects them.

### Scenario: Send selected comments

- **WHEN** the user selects comments and chooses “Add to conversation”
- **THEN** the composer SHALL show context chips for those comments
- **AND** the next message SHALL include bounded target, comment and provenance context
- **AND** unrelated comments SHALL NOT be included.

## Requirement: User-verified resolution

SciForge SHALL NOT automatically resolve a comment because an AI responded or changed content.

### Scenario: AI response

- **WHEN** an attached comment receives an AI response
- **THEN** the comment SHALL remain open or awaiting verification until the user resolves it.

## Requirement: Selective product feedback

SciForge SHALL show a confirmation surface where users choose which feedback fields are disclosed.

### Scenario: Default disclosure

- **WHEN** the product-feedback dialog opens
- **THEN** annotated screenshots and application environment SHALL be selected
- **AND** logs, conversation excerpts, workspace paths and file metadata SHALL be unselected.

## Requirement: Automatic GitHub submission

SciForge SHALL automatically upload approved visual evidence and create a GitHub Issue after one user confirmation.

### Scenario: Successful submission

- **WHEN** an authenticated user confirms product feedback
- **THEN** the gateway SHALL upload approved images, create the Issue, and return its URL and number
- **AND** the local comment SHALL record the submitted linkage.

### Scenario: Retry

- **WHEN** a submission is retried after a timeout
- **THEN** the same idempotency key SHALL return the existing Issue instead of creating a duplicate.

