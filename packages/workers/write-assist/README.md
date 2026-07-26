# @sciforge/write-assist

Writing support worker for SciForge.

This package owns the agent-facing MCP facade for bounded writing-context
retrieval and PDF text extraction.

- `gui_pdf_extract_text` is text-only. Its output is not evidence for figures,
  charts, equations, or page layout.
