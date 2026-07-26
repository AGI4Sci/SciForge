# @sciforge/write-assist

Writing support worker for SciForge.

This package owns the agent-facing MCP facade for bounded writing-context
retrieval, PDF text extraction, and Markdown image-reference validation.

- `gui_pdf_extract_text` is text-only. Its output is not evidence for figures,
  charts, equations, or page layout.
- `gui_markdown_validate_images` checks that references and local files are
  present and workspace-confined. It does not inspect image meaning or crop
  quality.
