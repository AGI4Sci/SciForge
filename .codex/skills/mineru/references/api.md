# MinerU API Reference

Reference: MinerU document parsing API documentation.

## Standard API

Base URL: `https://mineru.net`

Requires header:

```text
Authorization: Bearer <MINERU_API_KEY>
Content-Type: application/json
```

Limits:

- File size <= 200 MB.
- Page count <= 200 pages.
- Batch submit <= 200 URL files.
- Local upload URL requests <= 50 files per request.
- Supports PDF, images, doc/docx, ppt/pptx, xls/xlsx, and html.

Models:

- `pipeline`: default.
- `vlm`: recommended for complex scientific PDFs.
- `MinerU-HTML`: use for HTML files.

Single URL task:

- `POST /api/v4/extract/task`
- Body includes `url`, optional `model_version`, `is_ocr`, `enable_formula`, `enable_table`, `language`, `data_id`, `extra_formats`, `page_ranges`, `no_cache`, `cache_tolerance`.
- Response data: `task_id`.
- Poll: `GET /api/v4/extract/task/{task_id}`.
- Done response: `data.state == "done"` and `data.full_zip_url`.

Local file upload:

- `POST /api/v4/file-urls/batch`
- Body includes `files: [{name, data_id?, is_ocr?, page_ranges?}]`, optional shared parsing options and `model_version`.
- Response data: `batch_id`, `file_urls`.
- Upload each file with `PUT <file_url>` and raw bytes; do not set `Content-Type`.
- Poll: `GET /api/v4/extract-results/batch/{batch_id}`.
- Done response entries contain `full_zip_url`.

URL batch:

- `POST /api/v4/extract/task/batch`
- Body includes `files: [{url, data_id?, is_ocr?, page_ranges?}]`, optional parsing options and `model_version`.
- Poll with `GET /api/v4/extract-results/batch/{batch_id}`.

Zip contents:

- Non-HTML parse results include `full.md`, content JSON, model/middle/layout JSON variants, and requested extra formats.
- HTML parse results include `full.md` and `main.html`.

## Agent Lightweight API

Base URL: `https://mineru.net/api/v1/agent`

No token. IP-rate-limited. Single file or URL only. Returns Markdown URL.

Limits from the docs:

- File size <= 10 MB.
- Page count <= 20 pages in the comparison table. Error examples may mention 50 pages; treat the published comparison limit as safer.

URL parse:

- `POST /parse/url`
- Body: `url`, optional `language`, `page_range`, `enable_table`, `is_ocr`, `enable_formula`.
- Poll: `GET /parse/{task_id}`.
- Done response: `data.markdown_url`.

File parse:

- `POST /parse/file`
- Body: `file_name`, optional `language`, `page_range`, `enable_table`, `is_ocr`, `enable_formula`.
- Response: `task_id`, signed `file_url`.
- Upload file with `PUT <file_url>` and raw bytes.
- Poll: `GET /parse/{task_id}`.
- Done response: `data.markdown_url`.

Common states:

- `waiting-file`
- `uploading`
- `pending`
- `running`
- `converting`
- `done`
- `failed`

Language default: `ch`.
