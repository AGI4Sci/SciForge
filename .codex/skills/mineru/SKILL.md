---
name: mineru
description: Parse PDFs, Office files, images, and HTML into Markdown/structured outputs with MinerU. Use when SciForge or Codex needs document parsing/OCR for scientific papers, supplementary files, PDFs, scanned documents, tables, formulas, or URL/local-file parsing through MinerU standard or Agent lightweight APIs.
---

# MinerU

Use MinerU to turn PDFs, Office files, images, and HTML into Markdown and structured outputs for downstream research workflows.

## Choose API Mode

- Prefer **standard mode** for scientific papers and reproducible project work. It requires `MINERU_API_KEY`, supports files up to 200 MB / 200 pages, batch upload, `pipeline` / `vlm` / `MinerU-HTML`, tables, formulas, and zip outputs.
- Use **agent mode** for quick, small, non-sensitive parsing. It needs no token, is IP-rate-limited, supports a single file or URL, returns Markdown only, and is intended for lightweight agent workflows.

Do not store API keys in skill files, source code, logs, or committed `.env` files. Read standard API credentials from `MINERU_API_KEY`.

## Quick Commands

Use the bundled CLI:

```bash
python .codex/skills/mineru/scripts/mineru_parse.py standard-file path/to/paper.pdf --output-dir outputs/results/mineru/paper --model-version vlm --extra-format html
python .codex/skills/mineru/scripts/mineru_parse.py standard-url https://example.com/paper.pdf --output-dir outputs/results/mineru/paper --model-version vlm
python .codex/skills/mineru/scripts/mineru_parse.py agent-file path/to/small.pdf --output-dir /tmp/mineru-small
python .codex/skills/mineru/scripts/mineru_parse.py agent-url https://example.com/small.pdf --output-dir /tmp/mineru-small
```

For local files in standard mode, the CLI requests a signed upload URL, uploads the file, polls the batch result, downloads the result zip, and extracts it.

For standard URL mode, the CLI submits the URL task, polls it, downloads the result zip, and extracts it.

For agent mode, the CLI downloads the returned Markdown file.

## Recommended Defaults

- Use `--model-version vlm` for scientific papers with formulas, tables, and figures.
- Use `--model-version MinerU-HTML` only for HTML source files.
- Use `--pages` to limit expensive or slow parses during tests.
- Keep raw PDFs and downloaded zips in ignored local folders; commit only extracted, reviewed Markdown/metadata when appropriate.

## Resources

- `scripts/mineru_parse.py`: deterministic CLI wrapper for MinerU API calls.
- `references/api.md`: concise API reference extracted from the local MinerU HTML documentation.
