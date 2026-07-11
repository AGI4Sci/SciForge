# Change: Add anchored comments and GitHub feedback

## Why

SciForge users cannot precisely refer to visible research content or application UI when collaborating with AI or reporting product problems. They must describe targets manually, which loses provenance, makes AI edits ambiguous, and makes product feedback hard to reproduce after the UI changes.

## What Changes

- Add a global comment mode that can target first-party research objects and SciForge UI elements.
- Persist comments with semantic anchors, DOM recovery hints, environment metadata, and immutable visual evidence.
- Let users explicitly select comments and attach them to the active AI conversation before asking for changes.
- Add a product-feedback action that captures a full-window annotated screenshot plus a focused crop, lets users choose which diagnostic fields to include, and automatically submits a GitHub Issue.
- Add a narrow feedback gateway boundary so GitHub App secrets and durable screenshot upload credentials never ship in the desktop application.
- Track the linked GitHub Issue and its submission state from the local comment.

## Impact

- Affected renderer areas: workbench shell, composer, global overlay, comment management UI.
- Affected main-process areas: screenshot capture, local persistence, feedback submission IPC.
- Affected shared contracts: anchors, comment threads, context references, feedback packets and gateway responses.
- New deployable boundary: a minimal feedback gateway with idempotent GitHub Issue creation and durable image hosting.
- Existing PDF, scientific-object, Canvas and visible-context contracts remain compatible and become anchor sources rather than parallel comment systems.

