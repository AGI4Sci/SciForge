"""Artifact renderers for package-owned target-bound Computer Use probes."""

from __future__ import annotations

import json
import hashlib
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from xml.sax.saxutils import escape
import xml.etree.ElementTree as ET


_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def render_target_artifact(
    path: Path,
    *,
    document_lines: Sequence[str],
    scenario: Mapping[str, Any],
) -> dict[str, Any]:
    """Render a target-window artifact from generic typed document state.

    The renderer is selected by artifact spec or file extension. It is used by
    the package-owned target-bound host when a generic save action is executed;
    callers still need current visual/file evidence before claiming completion.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    artifact_spec = _artifact_spec(scenario)
    kind = _artifact_kind(path, artifact_spec)
    renderer = _ARTIFACT_RENDERERS.get(kind, _render_text_artifact)
    return renderer(path, document_lines=document_lines, artifact_spec=artifact_spec, scenario=scenario)


def _render_slide_deck_artifact(
    path: Path,
    *,
    document_lines: Sequence[str],
    artifact_spec: Mapping[str, Any],
    scenario: Mapping[str, Any],
) -> dict[str, Any]:
    slides = _slide_deck_content(document_lines, artifact_spec)
    _write_slide_deck_pptx(path, slides=slides)
    validation_ref = path.with_suffix(path.suffix + ".validation.json")
    validation = validate_pptx_artifact(path, expected_slide_count=len(slides))
    validation_ref.write_text(f"{json.dumps(validation, indent=2, sort_keys=True)}\n", encoding="utf8")
    return {
        "artifactKind": "slide-deck",
        "artifactFormat": "pptx",
        "slideCount": len(slides),
        "title": slides[0]["title"],
        "titles": [slide["title"] for slide in slides],
        "bulletCount": sum(len(slide["bullets"]) for slide in slides),
        "artifactValidationRef": str(validation_ref.resolve()),
        "pptxValidationRef": str(validation_ref.resolve()),
        "pptxValidation": {
            "ok": validation["ok"],
            "slideCount": validation["slideCount"],
            "sizeBytes": validation["sizeBytes"],
            "sha256": validation["sha256"],
        },
    }


def _render_word_document_artifact(
    path: Path,
    *,
    document_lines: Sequence[str],
    artifact_spec: Mapping[str, Any],
    scenario: Mapping[str, Any],
) -> dict[str, Any]:
    blocks = _word_document_content(document_lines, artifact_spec)
    _write_word_document_docx(path, blocks=blocks)
    validation_ref = path.with_suffix(path.suffix + ".validation.json")
    validation = validate_docx_artifact(path)
    validation_ref.write_text(f"{json.dumps(validation, indent=2, sort_keys=True)}\n", encoding="utf8")
    return {
        "artifactKind": "word-document",
        "artifactFormat": "docx",
        "paragraphCount": validation["paragraphCount"],
        "nonEmptyParagraphCount": validation["nonEmptyParagraphCount"],
        "tableCount": validation["tableCount"],
        "headingParagraphCount": validation["headingParagraphCount"],
        "bulletParagraphCount": validation["bulletParagraphCount"],
        "artifactValidationRef": str(validation_ref.resolve()),
        "docxValidationRef": str(validation_ref.resolve()),
        "docxValidation": {
            "ok": validation["ok"],
            "paragraphCount": validation["paragraphCount"],
            "tableCount": validation["tableCount"],
            "sizeBytes": validation["sizeBytes"],
            "sha256": validation["sha256"],
        },
    }


def _render_text_artifact(
    path: Path,
    *,
    document_lines: Sequence[str],
    artifact_spec: Mapping[str, Any],
    scenario: Mapping[str, Any],
) -> dict[str, Any]:
    text = "\n".join(document_lines).rstrip() + "\n"
    path.write_text(text, encoding="utf8")
    return {
        "artifactKind": "document",
        "artifactFormat": path.suffix.lower().lstrip(".") or "txt",
        "lineCount": len(document_lines),
    }


_ARTIFACT_RENDERERS = {
    "slide-deck": _render_slide_deck_artifact,
    "word-document": _render_word_document_artifact,
}


def validate_pptx_artifact(path: Path, *, expected_slide_count: int = 1) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    expected_slide_count = max(1, int(expected_slide_count))
    required_parts = {
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
        *{f"ppt/slides/slide{index}.xml" for index in range(1, expected_slide_count + 1)},
    }
    names: set[str] = set()
    slide_count = 0
    text_runs: list[str] = []
    if not path.is_file():
        errors.append("pptx file does not exist")
        size_bytes = 0
        sha256 = ""
    else:
        size_bytes = path.stat().st_size
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.is_file() and not zipfile.is_zipfile(path):
        errors.append("pptx is not a valid zip package")
    if path.is_file() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            for name in names:
                if name.startswith("/") or ".." in Path(name).parts:
                    errors.append(f"unsafe zip path: {name}")
                if name.lower().endswith((".bin", ".vba", "vbaproject.bin")):
                    errors.append(f"macro payload is forbidden: {name}")
            missing = sorted(required_parts - names)
            if missing:
                errors.append("missing required pptx part(s): " + ", ".join(missing))
            for name in sorted(item for item in names if item.endswith((".xml", ".rels"))):
                try:
                    ET.fromstring(archive.read(name))
                except ET.ParseError as exc:
                    errors.append(f"xml parse failed for {name}: {exc}")
            if "ppt/presentation.xml" in names:
                try:
                    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
                    slide_count = len(presentation.findall(".//{http://schemas.openxmlformats.org/presentationml/2006/main}sldId"))
                except ET.ParseError:
                    slide_count = 0
            for slide_name in sorted(name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")):
                slide = parsed_xml_or_none(archive.read(slide_name))
                if slide is not None:
                    text_runs.extend(_pptx_text_runs(slide))
            if "ppt/_rels/presentation.xml.rels" in names:
                try:
                    rels = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
                    slide_targets = [
                        rel.attrib.get("Target")
                        for rel in rels.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship")
                        if rel.attrib.get("Type", "").endswith("/slide")
                    ]
                    for target in slide_targets:
                        if target and f"ppt/{target}" not in names:
                            errors.append(f"slide relationship target missing: {target}")
                except ET.ParseError:
                    pass
    normalized_text = _normalize_artifact_text(" ".join(text_runs))
    if size_bytes <= 0:
        errors.append("pptx file is empty")
    if slide_count != expected_slide_count:
        errors.append(f"pptx slideCount must be {expected_slide_count}, got {slide_count}")
    return {
        "schemaVersion": "sciforge.computer-use.pptx-validation.v1",
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "path": str(path.resolve()),
        "sizeBytes": size_bytes,
        "sha256": sha256,
        "slideCount": slide_count,
        "expectedSlideCount": expected_slide_count,
        "textRuns": text_runs,
        "textRunCount": len(text_runs),
        "textCharCount": len("".join(text_runs)),
        "normalizedTextSha256": hashlib.sha256(normalized_text.encode("utf8")).hexdigest() if normalized_text else "",
        "requiredParts": sorted(required_parts),
        "packageParts": sorted(names),
        "macrosForbidden": True,
    }


def validate_docx_artifact(path: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    required_parts = {
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "word/document.xml",
    }
    names: set[str] = set()
    parsed_parts: dict[str, ET.Element] = {}
    paragraph_count = 0
    non_empty_paragraph_count = 0
    table_count = 0
    table_row_count = 0
    table_cell_count = 0
    heading_paragraph_count = 0
    title_paragraph_count = 0
    list_paragraph_count = 0
    bullet_paragraph_count = 0
    numbered_paragraph_count = 0
    unknown_list_paragraph_count = 0
    heading_style_counts: dict[str, int] = {}
    numbering_id_counts: dict[str, int] = {}
    table_dimensions: list[dict[str, int]] = []
    text_runs: list[str] = []
    if not path.is_file():
        errors.append("docx file does not exist")
        size_bytes = 0
        sha256 = ""
    else:
        size_bytes = path.stat().st_size
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.is_file() and not zipfile.is_zipfile(path):
        errors.append("docx is not a valid zip package")
    if path.is_file() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            for name in names:
                if name.startswith("/") or "\\" in name or ".." in Path(name).parts:
                    errors.append(f"unsafe zip path: {name}")
                if _is_forbidden_macro_part(name):
                    errors.append(f"macro payload is forbidden: {name}")
            missing = sorted(required_parts - names)
            if missing:
                errors.append("missing required docx part(s): " + ", ".join(missing))
            for name in sorted(item for item in names if item.endswith((".xml", ".rels"))):
                try:
                    parsed_parts[name] = ET.fromstring(archive.read(name))
                except ET.ParseError as exc:
                    errors.append(f"xml parse failed for {name}: {exc}")
            _validate_docx_content_types(parsed_parts.get("[Content_Types].xml"), errors)
            _validate_docx_root_relationships(parsed_parts.get("_rels/.rels"), names, errors)
            numbering_formats = _word_numbering_formats(parsed_parts.get("word/numbering.xml"))
            document = parsed_parts.get("word/document.xml")
            if document is not None:
                text_runs = _docx_text_runs(document)
                paragraphs = document.findall(f".//{{{_WORD_NS}}}p")
                tables = document.findall(f".//{{{_WORD_NS}}}tbl")
                paragraph_count = len(paragraphs)
                table_count = len(tables)
                for paragraph in paragraphs:
                    if _word_paragraph_has_text(paragraph):
                        non_empty_paragraph_count += 1
                    style = _word_paragraph_style(paragraph)
                    normalized_style = (style or "").lower()
                    if style == "Title":
                        title_paragraph_count += 1
                    if style and _is_heading_style(style):
                        heading_paragraph_count += 1
                        heading_style_counts[style] = heading_style_counts.get(style, 0) + 1
                    num_id = _word_paragraph_num_id(paragraph)
                    if num_id:
                        numbering_id_counts[num_id] = numbering_id_counts.get(num_id, 0) + 1
                    style_declares_bullet = "bullet" in normalized_style
                    style_declares_numbering = "number" in normalized_style
                    if num_id or style_declares_bullet or style_declares_numbering:
                        list_paragraph_count += 1
                        formats = numbering_formats.get(num_id or "", set())
                        if style_declares_bullet or "bullet" in formats:
                            bullet_paragraph_count += 1
                        elif style_declares_numbering or formats:
                            numbered_paragraph_count += 1
                        else:
                            unknown_list_paragraph_count += 1
                for index, table in enumerate(tables, start=1):
                    rows = table.findall(f".//{{{_WORD_NS}}}tr")
                    row_count = len(rows)
                    cell_counts = [len(row.findall(f".//{{{_WORD_NS}}}tc")) for row in rows]
                    cell_count = sum(cell_counts)
                    table_row_count += row_count
                    table_cell_count += cell_count
                    table_dimensions.append(
                        {
                            "index": index,
                            "rowCount": row_count,
                            "cellCount": cell_count,
                            "maxColumnCount": max(cell_counts, default=0),
                        }
                    )
    normalized_text = _normalize_artifact_text(" ".join(text_runs))
    if size_bytes <= 0:
        errors.append("docx file is empty")
    return {
        "schemaVersion": "sciforge.computer-use.docx-validation.v1",
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "path": str(path.resolve()),
        "sizeBytes": size_bytes,
        "sha256": sha256,
        "paragraphCount": paragraph_count,
        "nonEmptyParagraphCount": non_empty_paragraph_count,
        "tableCount": table_count,
        "tableRowCount": table_row_count,
        "tableCellCount": table_cell_count,
        "tableDimensions": table_dimensions,
        "titleParagraphCount": title_paragraph_count,
        "headingParagraphCount": heading_paragraph_count,
        "headingStyleCounts": dict(sorted(heading_style_counts.items())),
        "listParagraphCount": list_paragraph_count,
        "bulletParagraphCount": bullet_paragraph_count,
        "numberedParagraphCount": numbered_paragraph_count,
        "unknownListParagraphCount": unknown_list_paragraph_count,
        "numberingIdCounts": dict(sorted(numbering_id_counts.items())),
        "textRuns": text_runs,
        "textRunCount": len(text_runs),
        "textCharCount": len("".join(text_runs)),
        "normalizedTextSha256": hashlib.sha256(normalized_text.encode("utf8")).hexdigest() if normalized_text else "",
        "requiredParts": sorted(required_parts),
        "packageParts": sorted(names),
        "macrosForbidden": True,
    }


def parsed_xml_or_none(payload: bytes) -> ET.Element | None:
    try:
        return ET.fromstring(payload)
    except ET.ParseError:
        return None


def _pptx_text_runs(slide: ET.Element) -> list[str]:
    return [
        str(node.text or "")
        for node in slide.findall(f".//{{{_DRAWING_NS}}}t")
        if str(node.text or "").strip()
    ]


def _docx_text_runs(document: ET.Element) -> list[str]:
    return [
        str(node.text or "")
        for node in document.findall(f".//{{{_WORD_NS}}}t")
        if str(node.text or "").strip()
    ]


def _normalize_artifact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _artifact_spec(scenario: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in ("artifactSpec", "artifactOutput", "finalArtifact"):
        value = scenario.get(key)
        if isinstance(value, Mapping):
            return value
    return {}


def _artifact_kind(path: Path, artifact_spec: Mapping[str, Any]) -> str:
    kind = str(artifact_spec.get("kind") or artifact_spec.get("type") or "").strip().lower()
    if kind in {"slide-deck", "deck", "presentation", "pptx"}:
        return "slide-deck"
    if kind in {"word-document", "word", "docx"}:
        return "word-document"
    if path.suffix.lower() == ".pptx":
        return "slide-deck"
    if path.suffix.lower() == ".docx":
        return "word-document"
    return "document"


def _slide_content(document_lines: Sequence[str], artifact_spec: Mapping[str, Any]) -> tuple[str, str, list[str]]:
    title = _string_or_none(artifact_spec.get("title"))
    subtitle = _string_or_none(artifact_spec.get("subtitle"))
    bullets = _string_list(artifact_spec.get("bullets"))
    lines = [line.strip() for line in document_lines if str(line).strip()]
    if title is None:
        for line in lines:
            if line.startswith("#"):
                title = line.lstrip("#").strip()
                break
        if title is None and lines:
            title = lines[0]
    if subtitle is None:
        for line in lines:
            if line and not line.startswith("#") and not line.startswith(("-", "*")):
                subtitle = line
                break
    if not bullets:
        for line in lines:
            stripped = line.lstrip("-* ").strip()
            if stripped and stripped not in {title, subtitle}:
                bullets.append(stripped)
    return title or "Untitled Slide", subtitle or "", bullets[:8]


def _slide_deck_content(document_lines: Sequence[str], artifact_spec: Mapping[str, Any]) -> list[dict[str, Any]]:
    spec_slides = artifact_spec.get("slides")
    slides: list[dict[str, Any]] = []
    if isinstance(spec_slides, list):
        for index, value in enumerate(spec_slides, start=1):
            if not isinstance(value, Mapping):
                continue
            title = _string_or_none(value.get("title")) or f"Slide {index}"
            subtitle = _string_or_none(value.get("subtitle")) or ""
            bullets = _string_list(value.get("bullets"))[:8]
            slides.append({"title": title, "subtitle": subtitle, "bullets": bullets})
    if slides:
        return slides
    title, subtitle, bullets = _slide_content(document_lines, artifact_spec)
    return [{"title": title, "subtitle": subtitle, "bullets": bullets}]


def _write_one_slide_pptx(path: Path, *, title: str, subtitle: str, bullets: Sequence[str]) -> None:
    _write_slide_deck_pptx(path, slides=[{"title": title, "subtitle": subtitle, "bullets": list(bullets)}])


def _write_slide_deck_pptx(path: Path, *, slides: Sequence[Mapping[str, Any]]) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    slide_count = max(1, len(slides))
    entries = {
        "[Content_Types].xml": _content_types_xml(slide_count),
        "_rels/.rels": _root_rels_xml(),
        "docProps/core.xml": _core_xml(now),
        "docProps/app.xml": _app_xml(slide_count),
        "ppt/presentation.xml": _presentation_xml(slide_count),
        "ppt/_rels/presentation.xml.rels": _presentation_rels_xml(slide_count),
        "ppt/slideLayouts/slideLayout1.xml": _slide_layout_xml(),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _slide_layout_rels_xml(),
        "ppt/slideMasters/slideMaster1.xml": _slide_master_xml(),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _slide_master_rels_xml(),
        "ppt/theme/theme1.xml": _theme_xml(),
    }
    for index, slide in enumerate(slides, start=1):
        entries[f"ppt/slides/slide{index}.xml"] = _slide_xml(
            str(slide.get("title") or f"Slide {index}"),
            str(slide.get("subtitle") or ""),
            _string_list(slide.get("bullets")),
        )
        entries[f"ppt/slides/_rels/slide{index}.xml.rels"] = _slide_rels_xml()
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)


def _word_document_content(document_lines: Sequence[str], artifact_spec: Mapping[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    title = _string_or_none(artifact_spec.get("title"))
    if title:
        blocks.append({"type": "title", "text": title})
    for heading in _string_list(artifact_spec.get("headings")):
        blocks.append({"type": "heading", "text": heading})
    for paragraph in _string_list(artifact_spec.get("paragraphs")):
        blocks.append({"type": "paragraph", "text": paragraph})
    for bullet in _string_list(artifact_spec.get("bullets")):
        blocks.append({"type": "bullet", "text": bullet})
    table_rows = _table_rows(artifact_spec.get("table") or artifact_spec.get("rows"))
    if table_rows:
        blocks.append({"type": "table", "rows": table_rows})
    if blocks:
        return blocks

    for raw_line in document_lines:
        line = str(raw_line).strip()
        if not line:
            continue
        if line.startswith("#"):
            text = line.lstrip("#").strip()
            blocks.append({"type": "title" if not any(block["type"] == "title" for block in blocks) else "heading", "text": text})
        elif line.startswith(("- ", "* ")):
            blocks.append({"type": "bullet", "text": line[2:].strip()})
        elif "|" in line and line.strip("| "):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if cells and not all(set(cell) <= {"-"} for cell in cells):
                if blocks and blocks[-1]["type"] == "table":
                    blocks[-1]["rows"].append(cells)
                else:
                    blocks.append({"type": "table", "rows": [cells]})
        else:
            blocks.append({"type": "paragraph", "text": line})
    if not blocks:
        blocks.append({"type": "paragraph", "text": "Untitled document"})
    return blocks


def _write_word_document_docx(path: Path, *, blocks: Sequence[Mapping[str, Any]]) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    entries = {
        "[Content_Types].xml": _word_content_types_xml(),
        "_rels/.rels": _word_root_rels_xml(),
        "docProps/core.xml": _core_xml(now),
        "docProps/app.xml": _word_app_xml(blocks),
        "word/document.xml": _word_document_xml(blocks),
        "word/_rels/document.xml.rels": _word_document_rels_xml(),
        "word/styles.xml": _word_styles_xml(),
        "word/numbering.xml": _word_numbering_xml(),
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)


def _word_content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>
"""


def _word_root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def _word_app_xml(blocks: Sequence[Mapping[str, Any]]) -> str:
    paragraph_count = sum(1 for block in blocks if block.get("type") != "table")
    table_count = sum(1 for block in blocks if block.get("type") == "table")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SciForge Computer Use</Application>
  <Pages>1</Pages>
  <Paragraphs>{paragraph_count}</Paragraphs>
  <Tables>{table_count}</Tables>
</Properties>
"""


def _word_document_xml(blocks: Sequence[Mapping[str, Any]]) -> str:
    body = "\n".join(_word_block_xml(block) for block in blocks)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{_WORD_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
{body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>
"""


def _word_block_xml(block: Mapping[str, Any]) -> str:
    block_type = str(block.get("type") or "paragraph")
    if block_type == "table":
        return _word_table_xml(_table_rows(block.get("rows")))
    style = ""
    num_pr = ""
    if block_type == "title":
        style = '<w:pStyle w:val="Title"/>'
    elif block_type == "heading":
        style = '<w:pStyle w:val="Heading1"/>'
    elif block_type == "bullet":
        style = '<w:pStyle w:val="ListParagraph"/>'
        num_pr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    p_pr = f"<w:pPr>{style}{num_pr}</w:pPr>" if style or num_pr else ""
    return f'    <w:p>{p_pr}<w:r><w:t>{escape(str(block.get("text") or ""))}</w:t></w:r></w:p>'


def _word_table_xml(rows: Sequence[Sequence[str]]) -> str:
    row_xml = "\n".join(
        "      <w:tr>"
        + "".join(f"<w:tc><w:p><w:r><w:t>{escape(str(cell))}</w:t></w:r></w:p></w:tc>" for cell in row)
        + "</w:tr>"
        for row in rows
    )
    return f"""    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
{row_xml}
    </w:tbl>"""


def _word_document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""


def _word_styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{_WORD_NS}">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>
"""


def _word_numbering_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{_WORD_NS}">
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>
"""


def _content_types_xml(slide_count: int) -> str:
    slide_overrides = "\n".join(
        f'  <Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
{slide_overrides}
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>
"""


def _root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def _core_xml(timestamp: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>SciForge Computer Use</dc:creator>
  <cp:lastModifiedBy>SciForge Computer Use</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:modified>
</cp:coreProperties>
"""


def _app_xml(slide_count: int) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SciForge Computer Use</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>{slide_count}</Slides>
</Properties>
"""


def _presentation_xml(slide_count: int) -> str:
    slide_ids = "\n".join(
        f'    <p:sldId id="{255 + index}" r:id="rId{index}"/>'
        for index in range(1, slide_count + 1)
    )
    master_rel_id = slide_count + 1
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId{master_rel_id}"/></p:sldMasterIdLst>
  <p:sldIdLst>
{slide_ids}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
"""


def _presentation_rels_xml(slide_count: int) -> str:
    slide_rels = "\n".join(
        f'  <Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{index}.xml"/>'
        for index in range(1, slide_count + 1)
    )
    master_rel_id = slide_count + 1
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{slide_rels}
  <Relationship Id="rId{master_rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>
"""


def _slide_xml(title: str, subtitle: str, bullets: Sequence[str]) -> str:
    bullet_runs = "\n".join(
        f"""        <a:p><a:pPr marL="342900" indent="-171450"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="2600"/><a:t>{escape(item)}</a:t></a:r></a:p>"""
        for item in bullets
    )
    subtitle_block = (
        f"""        <a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>{escape(subtitle)}</a:t></a:r></a:p>"""
        if subtitle
        else ""
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="10820400" cy="914400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4200" b="1"/><a:t>{escape(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="10363200" cy="4343400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>
{subtitle_block}
{bullet_runs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


def _slide_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
"""


def _slide_layout_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="titleAndObj" preserve="1">
  <p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"""


def _slide_layout_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
"""


def _slide_master_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>
"""


def _slide_master_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
"""


def _theme_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SciForge">
  <a:themeElements>
    <a:clrScheme name="SciForge"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="SciForge"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="SciForge"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle/></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>
"""


def _table_rows(value: Any) -> list[list[str]]:
    if isinstance(value, Mapping):
        value = value.get("rows")
    if not isinstance(value, list):
        return []
    rows: list[list[str]] = []
    for row in value:
        if isinstance(row, Mapping):
            row = row.get("cells") or row.get("values")
        if not isinstance(row, list):
            continue
        cells = [str(cell).strip() for cell in row if str(cell).strip()]
        if cells:
            rows.append(cells)
    return rows


def _is_forbidden_macro_part(name: str) -> bool:
    normalized = name.replace("\\", "/").lower()
    return (
        normalized.endswith("vbaproject.bin")
        or "/vba" in normalized
        or normalized.endswith(".vba")
    )


def _validate_docx_content_types(root: ET.Element | None, errors: list[str]) -> None:
    if root is None:
        return
    overrides = {
        item.attrib.get("PartName"): item.attrib.get("ContentType")
        for item in root.findall(f"{{{_CONTENT_TYPES_NS}}}Override")
    }
    document_type = overrides.get("/word/document.xml")
    if document_type != "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml":
        errors.append("docx content types missing word/document.xml main document override")


def _validate_docx_root_relationships(root: ET.Element | None, names: set[str], errors: list[str]) -> None:
    if root is None:
        return
    office_targets = [
        rel.attrib.get("Target")
        for rel in root.findall(f"{{{_REL_NS}}}Relationship")
        if rel.attrib.get("Type", "").endswith("/officeDocument")
    ]
    if "word/document.xml" not in office_targets:
        errors.append("docx root relationships missing officeDocument target word/document.xml")
    for target in office_targets:
        if target and target not in names:
            errors.append(f"docx officeDocument relationship target missing: {target}")


def _word_numbering_formats(root: ET.Element | None) -> dict[str, set[str]]:
    if root is None:
        return {}
    abstract_formats: dict[str, set[str]] = {}
    for abstract in root.findall(f"{{{_WORD_NS}}}abstractNum"):
        abstract_id = abstract.attrib.get(f"{{{_WORD_NS}}}abstractNumId")
        formats = {
            str(num_format.attrib.get(f"{{{_WORD_NS}}}val") or "")
            for num_format in abstract.findall(f".//{{{_WORD_NS}}}numFmt")
            if num_format.attrib.get(f"{{{_WORD_NS}}}val")
        }
        if abstract_id:
            abstract_formats[abstract_id] = formats
    by_num_id: dict[str, set[str]] = {}
    for num in root.findall(f"{{{_WORD_NS}}}num"):
        num_id = num.attrib.get(f"{{{_WORD_NS}}}numId")
        abstract_id_node = num.find(f"{{{_WORD_NS}}}abstractNumId")
        abstract_id = abstract_id_node.attrib.get(f"{{{_WORD_NS}}}val") if abstract_id_node is not None else None
        if num_id:
            by_num_id[num_id] = set(abstract_formats.get(str(abstract_id or ""), set()))
    return by_num_id


def _word_paragraph_has_text(paragraph: ET.Element) -> bool:
    return any((node.text or "").strip() for node in paragraph.findall(f".//{{{_WORD_NS}}}t"))


def _word_paragraph_style(paragraph: ET.Element) -> str | None:
    node = paragraph.find(f"./{{{_WORD_NS}}}pPr/{{{_WORD_NS}}}pStyle")
    if node is None:
        return None
    return node.attrib.get(f"{{{_WORD_NS}}}val")


def _word_paragraph_num_id(paragraph: ET.Element) -> str | None:
    node = paragraph.find(f"./{{{_WORD_NS}}}pPr/{{{_WORD_NS}}}numPr/{{{_WORD_NS}}}numId")
    if node is None:
        return None
    return node.attrib.get(f"{{{_WORD_NS}}}val")


def _is_heading_style(style: str) -> bool:
    normalized = style.strip().lower()
    return normalized == "title" or normalized.startswith("heading")


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [value.strip()]
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return []
